/**
 * Local usage statistics for BigModel-routed GLM traffic, aggregated from
 * the DSH session logs on this machine.
 *
 * The BigModel API exposes no account-usage endpoint (probed candidates all
 * 404), but every recorded session turn carries the resolved `usage` +
 * `model` pair — so the truthful local picture comes from scanning
 * `~/.dsh/sessions/<root>/<sid>/session.jsonl.zstd` (with bare
 * `session.jsonl` fallbacks).
 *
 * Decoding: the .zstd logs are multi-frame — the payload is split on the
 * zstd frame magic (28 B5 2F FD) and each frame is decompressed
 * independently with `zstdDecompressSync`; a bad frame is skipped (counted,
 * never fatal). Numbers aggregate per model with the official BigModel
 * credit factors (per 10k tokens): GLM-5.3 in 6.9 / out 24, GLM-5.3-Flash
 * in 2.3 / out 8; every other glm-* model borrows the GLM-5.3 row and is
 * flagged `approximate`.
 *
 * Discipline: everything stays on this machine — the aggregate (never raw
 * events, never prompts) is served to the settings card over the
 * /zhipu-toolkit-settings channel and nothing ever leaves the host.
 * Results cache per sessions dir for 60s; files over 10MB are skipped.
 *
 * @module dsh-zhipu-toolkit/usage-stats
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Official BigModel credit factors, per 10k tokens (input, output). */
export interface UsageCreditFactors {
  readonly inputPer10k: number
  readonly outputPer10k: number
}

/** GLM-5.3 standard factors (BigModel pricing table). */
export const GLM53_CREDIT_FACTORS: UsageCreditFactors = { inputPer10k: 6.9, outputPer10k: 24 }
/** GLM-5.3-Flash factors (BigModel pricing table). */
export const FLASH_CREDIT_FACTORS: UsageCreditFactors = { inputPer10k: 2.3, outputPer10k: 8 }

/**
 * Factors for one model id. Exact known ids use their own pricing row;
 * every other glm-* model borrows the GLM-5.3 row and is flagged
 * `approximate` so the card can mark it.
 */
export function creditFactorsFor(model: string): { factors: UsageCreditFactors, approximate: boolean } {
  const id = model.toLowerCase()
  if (id.includes('flash')) return { factors: FLASH_CREDIT_FACTORS, approximate: false }
  if (id === 'glm-5.3') return { factors: GLM53_CREDIT_FACTORS, approximate: false }
  return { factors: GLM53_CREDIT_FACTORS, approximate: true }
}

/** Per-model aggregate served to the card. */
export interface UsageModelRow {
  readonly model: string
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Credits at the model's factors; uncached + cacheRead + cacheWrite all count as input. */
  readonly credits: number
  /** True when the factors are borrowed from the GLM-5.3 row. */
  readonly approximate: boolean
}

/** The recent-5h slice; only present when logs carried parseable timestamps. */
export interface UsageWindowStats {
  readonly since: number
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly credits: number
}

/** Full aggregate served over the `usage-stats` RPC endpoint. */
export interface UsageStatsResult {
  readonly generatedAt: number
  readonly sessionsDir: string
  readonly scannedFiles: number
  readonly skippedLargeFiles: number
  readonly badFrames: number
  readonly totalRequests: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalCredits: number
  /** Sorted by credits, largest first. */
  readonly models: readonly UsageModelRow[]
  /** Null when no event carried a parseable timestamp (cumulative only). */
  readonly window: UsageWindowStats | null
  readonly warnings: readonly string[]
}

/** Scan knobs: bounded work, cached result. */
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 1500
const CONCURRENCY = 3
const WINDOW_MS = 5 * 60 * 60 * 1000
const CACHE_TTL_MS = 60_000
const MAX_WARNINGS = 5

const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])

/** `~/.dsh/sessions`, unless DSH_TOOLKIT_SESSIONS_DIR overrides (tests, sandboxes). */
export function defaultSessionsDir(): string {
  const override = process.env.DSH_TOOLKIT_SESSIONS_DIR
  return override !== undefined && override.length > 0 ? override : join(homedir(), '.dsh', 'sessions')
}

/** Split a multi-frame zstd payload on the frame magic; empty for non-zstd input. */
function splitZstdFrames(buffer: Buffer): Buffer[] {
  const frames: Buffer[] = []
  let start = buffer.indexOf(ZSTD_MAGIC)
  while (start !== -1) {
    const next = buffer.indexOf(ZSTD_MAGIC, start + ZSTD_MAGIC.length)
    frames.push(buffer.subarray(start, next === -1 ? undefined : next))
    start = next
  }
  return frames
}

/** Epoch-ms from the common host timestamp fields; undefined when absent or foreign. */
function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return value
    if (value > 1e9) return value * 1000
    return undefined
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

const MODEL_FALLBACK = /"model"\s*:\s*"([^"]+)"/

/**
 * One session-log line → a GLM usage event, or undefined.
 *
 * DSH session logs wrap every event as `{type, seq, time, data}`; the
 * authoritative pair rides the `assistant/message` envelope as
 * `data.usage` + `data.message.source.model` (the per-chunk usage events
 * carry no model and are therefore skipped, so nothing double-counts).
 * A flat `{model, usage}` shape is accepted as a fallback so hand-made
 * logs and fixtures aggregate the same way. The model must start with
 * `glm-`; input counts uncached + cacheRead + cacheWrite.
 */
export function extractUsageEvent(line: string): {
  model: string
  inputTokens: number
  outputTokens: number
  timestamp?: number
} | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0 || !trimmed.includes('"usage"')) return undefined
  let usage: Record<string, unknown> | undefined
  let model: string | undefined
  let timestamp: number | undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      const data = typeof obj.data === 'object' && obj.data !== null
        ? obj.data as Record<string, unknown>
        : undefined
      const chunk = typeof data?.chunk === 'object' && data.chunk !== null
        ? data.chunk as Record<string, unknown>
        : undefined
      const message = typeof data?.message === 'object' && data.message !== null
        ? data.message as Record<string, unknown>
        : undefined
      const source = typeof message?.source === 'object' && message.source !== null
        ? message.source as Record<string, unknown>
        : undefined
      for (const candidate of [obj.usage, data?.usage, chunk?.usage]) {
        if (typeof candidate === 'object' && candidate !== null) {
          usage = candidate as Record<string, unknown>
          break
        }
      }
      for (const candidate of [obj.model, data?.model, source?.model, message?.model, chunk?.model]) {
        if (typeof candidate === 'string' && candidate.length > 0) {
          model = candidate
          break
        }
      }
      timestamp = normalizeTimestamp(obj.time) ?? normalizeTimestamp(obj.timestamp) ?? normalizeTimestamp(obj.ts)
    }
  } catch {
    // Broken JSON: the raw-line regex below can still attribute the model.
    const fallback = MODEL_FALLBACK.exec(trimmed)
    if (fallback !== null) model = fallback[1]
  }
  if (usage === undefined) return undefined
  if (model === undefined) {
    const fallback = MODEL_FALLBACK.exec(trimmed)
    if (fallback === null) return undefined
    model = fallback[1]
  }
  if (!model.toLowerCase().startsWith('glm-')) return undefined
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  return {
    model,
    inputTokens: count(usage.inputTokens) + count(usage.cacheReadTokens) + count(usage.cacheWriteTokens),
    outputTokens: count(usage.outputTokens),
    timestamp,
  }
}

interface ModelAccumulator {
  requests: number
  inputTokens: number
  outputTokens: number
  credits: number
  approximate: boolean
}

/** One timestamped event kept per file so the 5h window can be re-sliced on merge. */
interface TimestampedUsage {
  readonly ts: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly credits: number
}

/** Per-file aggregate: mergeable, and cacheable by (size, mtime). */
interface FileAggregate {
  rows: Map<string, ModelAccumulator>
  badFrames: number
  timestamped: TimestampedUsage[]
}

interface Accumulator {
  rows: Map<string, ModelAccumulator>
  window: { requests: number, inputTokens: number, outputTokens: number, credits: number }
  windowHasTimestamps: boolean
  badFrames: number
}

function newAccumulator(): Accumulator {
  return {
    rows: new Map(),
    window: { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
    windowHasTimestamps: false,
    badFrames: 0,
  }
}

function creditsFor(inputTokens: number, outputTokens: number, factors: UsageCreditFactors): number {
  return (inputTokens / 10_000) * factors.inputPer10k + (outputTokens / 10_000) * factors.outputPer10k
}

/** Decode one session file into a self-contained aggregate; bad frames are counted, never fatal. */
function ingestSessionFile(buffer: Buffer, isZstd: boolean): FileAggregate {
  const aggregate: FileAggregate = { rows: new Map(), badFrames: 0, timestamped: [] }
  let text: string
  if (!isZstd) {
    text = buffer.toString('utf8')
  } else {
    const frames = splitZstdFrames(buffer)
    if (frames.length === 0) {
      aggregate.badFrames++
      return aggregate
    }
    const parts: string[] = []
    for (const frame of frames) {
      try {
        parts.push(zstdDecompressSync(frame).toString('utf8'))
      } catch {
        aggregate.badFrames++
      }
    }
    if (parts.length === 0) return aggregate
    text = parts.join('\n')
  }
  for (const line of text.split('\n')) {
    const event = extractUsageEvent(line)
    if (event === undefined) continue
    const { factors, approximate } = creditFactorsFor(event.model)
    const row = aggregate.rows.get(event.model)
      ?? { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, approximate: false }
    const credits = creditsFor(event.inputTokens, event.outputTokens, factors)
    row.requests++
    row.inputTokens += event.inputTokens
    row.outputTokens += event.outputTokens
    row.credits += credits
    row.approximate = row.approximate || approximate
    aggregate.rows.set(event.model, row)
    // Timestamped events ride along so the 5h window can be re-sliced at
    // merge time with the CURRENT boundary (per-file caches outlive it).
    if (event.timestamp !== undefined) {
      aggregate.timestamped.push({ ts: event.timestamp, inputTokens: event.inputTokens, outputTokens: event.outputTokens, credits })
    }
  }
  return aggregate
}

/** Fold one file aggregate into the scan accumulator, slicing the 5h window now. */
function mergeAggregate(target: Accumulator, source: FileAggregate, windowSince: number): void {
  for (const [model, row] of source.rows) {
    const merged = target.rows.get(model)
      ?? { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, approximate: false }
    merged.requests += row.requests
    merged.inputTokens += row.inputTokens
    merged.outputTokens += row.outputTokens
    merged.credits += row.credits
    merged.approximate = merged.approximate || row.approximate
    target.rows.set(model, merged)
  }
  target.badFrames += source.badFrames
  for (const event of source.timestamped) {
    target.windowHasTimestamps = true
    if (event.ts >= windowSince) {
      target.window.requests++
      target.window.inputTokens += event.inputTokens
      target.window.outputTokens += event.outputTokens
      target.window.credits += event.credits
    }
  }
}

/** session.jsonl.zstd / session.jsonl files under <root>/**, depth- and count-capped. */
async function collectSessionFiles(root: string, warnings: string[]): Promise<string[]> {
  const files: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable branch: the scan stays best-effort, never fatal
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 3) await visit(path, depth + 1)
        continue
      }
      if (entry.name === 'session.jsonl.zstd' || entry.name === 'session.jsonl') files.push(path)
    }
  }
  await visit(root, 0)
  files.sort()
  if (files.length > MAX_FILES) {
    warnings.push(`session file cap reached: scanning ${MAX_FILES} of ${files.length}`)
    return files.slice(0, MAX_FILES)
  }
  return files
}

const caches = new Map<string, { at: number, result: UsageStatsResult }>()

/**
 * Per-file aggregate cache: unchanged files (same size + mtime) are merged
 * from cache instead of being re-decoded, so a rescan costs stat() calls
 * rather than a full zstd pass over every session log.
 */
const fileCaches = new Map<string, { size: number, mtimeMs: number, aggregate: FileAggregate }>()
const FILE_CACHE_LIMIT = 4000

/** Drop the result cache AND the per-file decode cache. */
export function resetUsageStatsCache(): void {
  caches.clear()
  fileCaches.clear()
}

export interface ComputeUsageStatsOptions {
  /** Override the sessions root (tests; default DSH_TOOLKIT_SESSIONS_DIR or ~/.dsh/sessions). */
  readonly sessionsDir?: string
  /** Clock override for the 5h window and the cache TTL. */
  readonly now?: number
  /** Recompute even when a cached result is fresh. */
  readonly force?: boolean
}

/**
 * Aggregate GLM usage across the local session logs. Best-effort by design:
 * unreadable branches are skipped, oversize files counted and skipped, bad
 * frames tolerated. The result caches per sessions dir for 60s, so the card
 * can poll without re-scanning.
 */
export async function computeUsageStats(options: ComputeUsageStatsOptions = {}): Promise<UsageStatsResult> {
  const now = options.now ?? Date.now()
  const dir = options.sessionsDir ?? defaultSessionsDir()
  const cached = caches.get(dir)
  if (options.force !== true && cached !== undefined && now - cached.at < CACHE_TTL_MS) {
    return cached.result
  }
  const warnings: string[] = []
  const pushWarning = (message: string): void => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message)
  }
  const files = await collectSessionFiles(dir, warnings)
  const sized = await Promise.all(files.map(async path => {
    try {
      const info = await stat(path)
      return { path, size: info.size, mtimeMs: info.mtimeMs }
    } catch {
      return undefined
    }
  }))
  const work: Array<{ path: string, size: number, mtimeMs: number }> = []
  let skippedLargeFiles = 0
  for (const entry of sized) {
    if (entry === undefined) continue
    if (entry.size > MAX_FILE_BYTES) {
      skippedLargeFiles++
      pushWarning(`${basename(entry.path)} skipped: ${(entry.size / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB cap`)
      continue
    }
    work.push(entry)
  }
  const acc = newAccumulator()
  const windowSince = now - WINDOW_MS
  let scannedFiles = 0
  let cursor = 0
  const worker = async (): Promise<void> => {
    // The cursor read+increment is synchronous, so concurrent workers claim
    // disjoint files; each worker's awaits never interleave inside a claim.
    while (cursor < work.length) {
      const item = work[cursor++]
      const cached = fileCaches.get(item.path)
      if (cached !== undefined && cached.size === item.size && cached.mtimeMs === item.mtimeMs) {
        mergeAggregate(acc, cached.aggregate, windowSince)
        scannedFiles++
        continue
      }
      let buffer: Buffer
      try {
        buffer = await readFile(item.path)
      } catch {
        pushWarning(`${basename(item.path)} unreadable, skipped`)
        continue
      }
      const aggregate = ingestSessionFile(buffer, item.path.endsWith('.zstd'))
      if (fileCaches.size >= FILE_CACHE_LIMIT) {
        const eldest = fileCaches.keys().next().value
        if (eldest !== undefined) fileCaches.delete(eldest)
      }
      fileCaches.set(item.path, { size: item.size, mtimeMs: item.mtimeMs, aggregate })
      mergeAggregate(acc, aggregate, windowSince)
      scannedFiles++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  const models: UsageModelRow[] = [...acc.rows.entries()]
    .map(([model, row]) => ({ model, ...row }))
    .sort((a, b) => b.credits - a.credits)
  const totals = models.reduce(
    (sum, row) => ({
      requests: sum.requests + row.requests,
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      credits: sum.credits + row.credits,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
  )
  const result: UsageStatsResult = {
    generatedAt: now,
    sessionsDir: dir,
    scannedFiles,
    skippedLargeFiles,
    badFrames: acc.badFrames,
    totalRequests: totals.requests,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCredits: totals.credits,
    models,
    window: acc.windowHasTimestamps ? { since: windowSince, ...acc.window } : null,
    warnings,
  }
  caches.set(dir, { at: now, result })
  return result
}
