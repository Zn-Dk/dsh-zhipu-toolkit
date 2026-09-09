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
 * never fatal).
 *
 * Result shape: the scan produces event-level detail (`events`: minimal
 * {model, inputTokens, outputTokens, time} rows) and the CLIENT slices the
 * 5h/today/week windows from it. Past EVENTS_CAP events the detail is
 * collapsed server-side into per-model rows + a 5h window (`mode:
 * 'aggregated'`) so the RPC payload stays bounded; the client then shows
 * cumulative rows without window switching.
 *
 * Credits: official BigModel factors per 10k tokens — GLM-5.3 in 6.9 /
 * out 24, GLM-5.3-Flash in 2.3 / out 8; every other glm-* model borrows
 * the GLM-5.3 row and is flagged `approximate`.
 *
 * Discipline: everything stays on this machine — the aggregate (never raw
 * event text, only numeric rows) is served to the settings card over the
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

/** One minimal event row: the only per-event shape that crosses the RPC. */
export interface UsageEventRow {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  /** Epoch ms when the log carried a parseable timestamp, else null. */
  readonly time: number | null
}

/** Per-model cumulative aggregate (aggregated mode rows). */
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

/** The recent-5h slice; only meaningful in aggregated mode. */
export interface UsageWindowStats {
  readonly since: number
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly credits: number
}

/** Which shape the payload carries (see module docs). */
export type UsageStatsMode = 'events' | 'aggregated'

/** Full result served over the `usage-stats` RPC endpoint. */
export interface UsageStatsResult {
  readonly generatedAt: number
  readonly sessionsDir: string
  readonly scannedFiles: number
  readonly skippedLargeFiles: number
  readonly badFrames: number
  /** Wall-clock duration of this scan (decode + parse), in milliseconds. */
  readonly scanMs: number
  readonly totalRequests: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalCredits: number
  readonly mode: UsageStatsMode
  /** Event detail (events mode); empty in aggregated mode. */
  readonly events: readonly UsageEventRow[]
  /** Per-model cumulative rows (aggregated mode); null in events mode. */
  readonly models: readonly UsageModelRow[] | null
  /** The 5h window (aggregated mode); null in events mode (client slices). */
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
/** Past this many events the detail collapses into pre-aggregated rows. */
export const EVENTS_CAP = 50_000

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

/** Minimal per-file aggregate: event rows + bad-frame count, cache-friendly. */
interface FileAggregate {
  events: UsageEventRow[]
  badFrames: number
}

/** Decode one session file into minimal event rows; bad frames are counted, never fatal. */
function ingestSessionFile(buffer: Buffer, isZstd: boolean): FileAggregate {
  const aggregate: FileAggregate = { events: [], badFrames: 0 }
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
    aggregate.events.push({
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      time: event.timestamp ?? null,
    })
  }
  return aggregate
}

/** Fold event rows into per-model cumulative aggregates + the 5h window. */
function aggregateEvents(events: readonly UsageEventRow[], windowSince: number): {
  rows: Map<string, { requests: number, inputTokens: number, outputTokens: number, credits: number, approximate: boolean }>
  window: { requests: number, inputTokens: number, outputTokens: number, credits: number }
  windowHasTimestamps: boolean
} {
  const rows = new Map<string, { requests: number, inputTokens: number, outputTokens: number, credits: number, approximate: boolean }>()
  const window = { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0 }
  let windowHasTimestamps = false
  for (const event of events) {
    const { factors, approximate } = creditFactorsFor(event.model)
    const credits = (event.inputTokens / 10_000) * factors.inputPer10k + (event.outputTokens / 10_000) * factors.outputPer10k
    const row = rows.get(event.model)
      ?? { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, approximate: false }
    row.requests++
    row.inputTokens += event.inputTokens
    row.outputTokens += event.outputTokens
    row.credits += credits
    row.approximate = row.approximate || approximate
    rows.set(event.model, row)
    if (event.time !== null) {
      windowHasTimestamps = true
      if (event.time >= windowSince) {
        window.requests++
        window.inputTokens += event.inputTokens
        window.outputTokens += event.outputTokens
        window.credits += credits
      }
    }
  }
  return { rows, window, windowHasTimestamps }
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
 * rather than a full zstd pass over every session log. Cached aggregates
 * hold the minimal event rows only.
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
  const scanStartedAt = Date.now()
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
  const events: UsageEventRow[] = []
  let badFrames = 0
  let scannedFiles = 0
  let cursor = 0
  const worker = async (): Promise<void> => {
    // The cursor read+increment is synchronous, so concurrent workers claim
    // disjoint files; each worker's awaits never interleave inside a claim.
    while (cursor < work.length) {
      const item = work[cursor++]
      const cached = fileCaches.get(item.path)
      if (cached !== undefined && cached.size === item.size && cached.mtimeMs === item.mtimeMs) {
        events.push(...cached.aggregate.events)
        badFrames += cached.aggregate.badFrames
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
      events.push(...aggregate.events)
      badFrames += aggregate.badFrames
      scannedFiles++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  // Wall-clock scan duration as the user perceives it (this RPC's scan pass).
  const scanMs = Date.now() - scanStartedAt

  const totals = events.reduce(
    (sum, event) => {
      const { factors } = creditFactorsFor(event.model)
      return {
        requests: sum.requests + 1,
        inputTokens: sum.inputTokens + event.inputTokens,
        outputTokens: sum.outputTokens + event.outputTokens,
        credits: sum.credits + (event.inputTokens / 10_000) * factors.inputPer10k + (event.outputTokens / 10_000) * factors.outputPer10k,
      }
    },
    { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
  )

  // Payload guard: past the cap the detail collapses into pre-aggregated
  // per-model rows + the 5h window; the client then shows cumulative rows
  // without window switching.
  const aggregated = events.length > EVENTS_CAP
  let models: readonly UsageModelRow[] | null = null
  let window: UsageWindowStats | null = null
  if (aggregated) {
    const built = aggregateEvents(events, now - WINDOW_MS)
    models = [...built.rows.entries()]
      .map(([model, row]) => ({ model, ...row }))
      .sort((a, b) => b.credits - a.credits)
    window = built.windowHasTimestamps ? { since: now - WINDOW_MS, ...built.window } : null
  }

  const result: UsageStatsResult = {
    generatedAt: now,
    sessionsDir: dir,
    scannedFiles,
    skippedLargeFiles,
    badFrames,
    scanMs,
    totalRequests: totals.requests,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCredits: totals.credits,
    mode: aggregated ? 'aggregated' : 'events',
    events: aggregated ? [] : events,
    models,
    window,
    warnings,
  }
  caches.set(dir, { at: now, result })
  return result
}
