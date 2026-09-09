import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import {
  computeUsageStats,
  creditFactorsFor,
  extractUsageEvent,
  FLASH_CREDIT_FACTORS,
  GLM53_CREDIT_FACTORS,
  resetUsageStatsCache,
} from '../src/usage-stats.ts'

/**
 * Event-detail shape + aggregation math against synthetic session logs
 * shaped like the real DSH envelope (`{type, seq, time, data}` with
 * `data.usage` + `data.message.source.model` on the assistant/message
 * events). Events mode carries the minimal row detail; past EVENTS_CAP the
 * detail collapses into per-model rows + the 5h window. All calls run
 * against a temp sessions root and an injected clock.
 */

const BASE = Date.parse('2026-09-06T12:00:00Z')
const HOUR = 60 * 60 * 1000

let root = ''

beforeEach(() => {
  resetUsageStatsCache()
  root = mkdtempSync(join(tmpdir(), 'zt-usage-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One zstd frame carrying complete JSONL lines. */
const frame = (lines: string[]): Buffer =>
  zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'))

const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])

const put = (relDir: string, name: string, payload: Buffer): void => {
  const dir = join(root, relDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), payload)
}

/** A real-shape assistant/message envelope line: usage + source.model + time. */
const envelopeLine = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  time: number | null,
  seq = 1,
  cacheReadTokens?: number,
): string =>
  JSON.stringify({
    type: 'assistant/message',
    seq,
    ...(time === null ? {} : { time }),
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', source: { model }, id: 'm' + seq },
      usage: {
        inputTokens,
        ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    },
  })

describe('credit factors', () => {
  it('uses the official pricing rows for the known ids', () => {
    expect(GLM53_CREDIT_FACTORS).toEqual({ inputPer10k: 6.9, outputPer10k: 24 })
    expect(FLASH_CREDIT_FACTORS).toEqual({ inputPer10k: 2.3, outputPer10k: 8 })
    expect(creditFactorsFor('glm-5.3')).toEqual({ factors: GLM53_CREDIT_FACTORS, approximate: false })
    expect(creditFactorsFor('glm-5.3-flash')).toEqual({ factors: FLASH_CREDIT_FACTORS, approximate: false })
  })

  it('borrows the GLM-5.3 row for other glm ids and flags it approximate', () => {
    expect(creditFactorsFor('glm-4.7')).toEqual({ factors: GLM53_CREDIT_FACTORS, approximate: true })
    expect(creditFactorsFor('glm-5.3-ioa')).toEqual({ factors: GLM53_CREDIT_FACTORS, approximate: true })
    expect(creditFactorsFor('GLM-5.3-Flash')).toEqual({ factors: FLASH_CREDIT_FACTORS, approximate: false })
  })
})

describe('extractUsageEvent', () => {
  it('reads the real DSH envelope: data.usage + data.message.source.model + time', () => {
    const event = extractUsageEvent(envelopeLine('glm-5.3-flash', 2244, 1024, BASE))
    expect(event).toMatchObject({ model: 'glm-5.3-flash', inputTokens: 2244, outputTokens: 1024, timestamp: BASE })
  })

  it('skips the model-less assistant/chunk usage frames (no double counting)', () => {
    const chunkLine = JSON.stringify({
      type: 'assistant/chunk', seq: 2, time: BASE,
      data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 2244, outputTokens: 1024 } } },
    })
    expect(extractUsageEvent(chunkLine)).toBeUndefined()
  })

  it('counts uncached plus cacheRead plus cacheWrite tokens as input (flat fallback shape)', () => {
    const event = extractUsageEvent(
      '{"model":"glm-5.3","usage":{"inputTokens":100,"cacheReadTokens":50,"cacheWriteTokens":25,"outputTokens":7}}',
    )
    expect(event).toMatchObject({ model: 'glm-5.3', inputTokens: 175, outputTokens: 7 })
  })

  it('ignores hostile or missing numbers instead of throwing', () => {
    const event = extractUsageEvent(
      '{"model":"glm-5.3","usage":{"inputTokens":-5,"cacheReadTokens":null,"outputTokens":"x"}}',
    )
    expect(event).toMatchObject({ inputTokens: 0, outputTokens: 0 })
  })

  it('only attributes glm-* models', () => {
    expect(extractUsageEvent('{"model":"claude-x","usage":{"inputTokens":1,"outputTokens":1}}')).toBeUndefined()
    expect(extractUsageEvent(envelopeLine('claude-x', 1, 1, BASE))).toBeUndefined()
  })

  it('recovers the model from a nested unknown field via the raw-line regex', () => {
    const event = extractUsageEvent(
      '{"usage":{"inputTokens":10,"outputTokens":5},"meta":{"model":"glm-5.3-flash"}}',
    )
    expect(event).toMatchObject({ model: 'glm-5.3-flash', inputTokens: 10, outputTokens: 5 })
  })

  it('skips lines without usage or without any model', () => {
    expect(extractUsageEvent('{"model":"glm-5.3"}')).toBeUndefined()
    expect(extractUsageEvent('{"usage":{"inputTokens":1,"outputTokens":1}}')).toBeUndefined()
    expect(extractUsageEvent('')).toBeUndefined()
    expect(extractUsageEvent('plain text, no json')).toBeUndefined()
  })
})

describe('computeUsageStats (events mode)', () => {
  it('returns minimal event rows with cumulative totals', async () => {
    const frame1 = frame([
      envelopeLine('glm-5.3', 10000, 1000, BASE - 1 * HOUR, 1),
      envelopeLine('glm-5.3-flash', 20000, 2500, BASE - 6 * HOUR, 2, 5000),
      envelopeLine('claude-x', 999999, 999999, BASE - HOUR, 3),
      '{"data":{"usage":{"inputTokens":1,"outputTokens":1}},"time":' + String(BASE) + '}',
      'not json at all',
    ])
    const frame2 = frame([
      // No timestamp on this envelope → the event rides along with time:null.
      '{"type":"assistant/message","seq":4,"data":{"turn":1,"step":1,'
      + '"message":{"role":"assistant","source":{"model":"glm-4.7"}},'
      + '"usage":{"inputTokens":1000,"outputTokens":100}}}',
    ])
    const corrupt = Buffer.concat([ZSTD_MAGIC, Buffer.from('definitely-not-a-zstd-frame')])
    put('proj-a/s1', 'session.jsonl.zstd', Buffer.concat([frame1, frame2, corrupt]))
    put('proj-b/s2', 'session.jsonl', Buffer.from(
      envelopeLine('glm-5.3', 5000, 500, BASE - 0.5 * HOUR, 5) + '\ngarbage\n',
      'utf8',
    ))

    const result = await computeUsageStats({ sessionsDir: root, now: BASE })

    expect(result.mode).toBe('events')
    expect(result.models).toBeNull()
    expect(result.window).toBeNull()
    expect(result.scannedFiles).toBe(2)
    expect(result.scanMs).toBeTypeOf('number')
    expect(result.scanMs).toBeGreaterThanOrEqual(0)
    expect(result.badFrames).toBe(1)
    expect(result.totalRequests).toBe(4)
    expect(result.totalInputTokens).toBe(41000)
    expect(result.totalOutputTokens).toBe(4100)
    // Event detail: minimal rows only, null time preserved for the
    // timestamp-less envelope, non-GLM traffic absent.
    expect(result.events).toEqual([
      { model: 'glm-5.3', inputTokens: 10000, outputTokens: 1000, time: BASE - 1 * HOUR },
      { model: 'glm-5.3-flash', inputTokens: 25000, outputTokens: 2500, time: BASE - 6 * HOUR },
      { model: 'glm-4.7', inputTokens: 1000, outputTokens: 100, time: null },
      { model: 'glm-5.3', inputTokens: 5000, outputTokens: 500, time: BASE - 0.5 * HOUR },
    ])
    expect(result.totalCredits).toBeCloseTo(9.3 + 7.75 + 0.93 + 4.65, 6)
  })

  it('skips oversize files with a warning and reports them', async () => {
    put('proj-c/s3', 'session.jsonl.zstd', Buffer.alloc(10 * 1024 * 1024 + 1, 0x78))
    put('proj-c/s4', 'session.jsonl.zstd', frame([envelopeLine('glm-5.3', 10, 10, BASE, 6)]))
    const result = await computeUsageStats({ sessionsDir: root, now: BASE })
    expect(result.skippedLargeFiles).toBe(1)
    expect(result.scannedFiles).toBe(1)
    expect(result.totalRequests).toBe(1)
    expect(result.warnings.some(w => w.includes('10 MB cap'))).toBe(true)
  })

  it('collapses into aggregated mode past EVENTS_CAP with rows + 5h window', async () => {
    // 50,002 events: two glm-5.3/flash lines and the bulk as glm-4.7
    // (approximate factors) — enough to trip EVENTS_CAP.
    const lines: string[] = [
      envelopeLine('glm-5.3', 10000, 1000, BASE - 1 * HOUR, 1),
      envelopeLine('glm-5.3-flash', 20000, 2500, BASE - 6 * HOUR, 2),
    ]
    for (let i = 0; i < 50_000; i++) {
      lines.push(envelopeLine('glm-4.7', 100, 10, BASE - 2 * HOUR, 100 + i))
    }
    put('proj-d/s5', 'session.jsonl.zstd', frame(lines))
    const result = await computeUsageStats({ sessionsDir: root, now: BASE })
    expect(result.mode).toBe('aggregated')
    expect(result.events).toEqual([])
    expect(result.totalRequests).toBe(50_002)
    // Cumulative rows sorted by credits, largest first: glm-4.7 bulk wins
    // (50k × (0.069 + 0.024) = 4650) over glm-5.3 (9.3) and flash (7.75).
    expect(result.models?.map(row => row.model)).toEqual(['glm-4.7', 'glm-5.3', 'glm-5.3-flash'])
    expect(result.models?.[0]).toMatchObject({ requests: 50_000, inputTokens: 5_000_000, outputTokens: 500_000, approximate: true })
    expect(result.models?.[0].credits).toBeCloseTo(4650, 4)
    // The 5h window: the glm-5.3 line (1h old) and all 50k glm-4.7 lines
    // (2h old) fall inside it; the flash line (6h old) does not.
    expect(result.window?.requests).toBe(50_001)
    expect(result.window?.inputTokens).toBe(5_010_000)
  })

  it('caches per sessions dir until the TTL or a forced refresh', async () => {
    put('proj-e/s6', 'session.jsonl.zstd', frame([envelopeLine('glm-5.3', 10, 10, BASE, 8)]))
    const first = await computeUsageStats({ sessionsDir: root, now: BASE })
    put('proj-e/s7', 'session.jsonl.zstd', frame([envelopeLine('glm-5.3', 10, 10, BASE, 9)]))
    const cached = await computeUsageStats({ sessionsDir: root, now: BASE + 1000 })
    expect(cached).toBe(first) // same object → served from cache
    const fresh = await computeUsageStats({ sessionsDir: root, now: BASE + 1000, force: true })
    expect(fresh).not.toBe(first)
    expect(fresh.totalRequests).toBe(2)
    // Past the TTL the cache expires by itself.
    const expired = await computeUsageStats({ sessionsDir: root, now: BASE + 60_000 + 1 })
    expect(expired.totalRequests).toBe(2)
  })

  it('picks up appended content in an existing file on a forced refresh', async () => {
    const dir = join(root, 'proj-f/s8')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'session.jsonl.zstd')
    writeFileSync(file, frame([envelopeLine('glm-5.3', 10, 10, BASE, 10)]))
    const first = await computeUsageStats({ sessionsDir: root, now: BASE, force: true })
    expect(first.totalRequests).toBe(1)
    // Append a second event → size and mtime change → the per-file cache
    // must miss and re-decode this file only.
    appendFileSync(file, frame([envelopeLine('glm-5.3', 20, 20, BASE, 11)]))
    const second = await computeUsageStats({ sessionsDir: root, now: BASE, force: true })
    expect(second.totalRequests).toBe(2)
    expect(second.totalInputTokens).toBe(30)
  })

  it('degrades to an empty aggregate for a missing sessions dir', async () => {
    const result = await computeUsageStats({ sessionsDir: join(root, 'does-not-exist'), now: BASE })
    expect(result.mode).toBe('events')
    expect(result.events).toEqual([])
    expect(result.totalRequests).toBe(0)
    expect(result.models).toBeNull()
  })
})
