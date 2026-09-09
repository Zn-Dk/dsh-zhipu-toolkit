import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Drives the SHIPPED client bundle's pure usage-view helpers (window
 * boundaries, KMB formatting, event slicing) through the same ModuleLoader
 * contract the host uses — no reimplementation, no drift.
 */

interface UsageViewHelpers {
  windowSince(kind: 'h5' | 'today' | 'week', now: number): number
  fmtCompactTokens(value: number): string
  sliceUsageEvents(
    events: ReadonlyArray<{ model: string, inputTokens: number, outputTokens: number, time: number | null }>,
    kind: 'h5' | 'today' | 'week',
    now: number,
  ): { rows: Array<{ model: string, requests: number, inputTokens: number, outputTokens: number, credits: number, approximate: boolean }>, unparsed: boolean }
}

let helpers: UsageViewHelpers

beforeAll(async () => {
  const loaded: Array<Record<string, unknown>> = []
  ;(globalThis as unknown as { window: unknown }).window = {
    __ModuleLoader__: {
      load(def: { id: string, factory: (require: (spec: string) => unknown) => unknown }): void {
        loaded.push(def.factory(() => ({})) as Record<string, unknown>)
      },
    },
  }
  await import(new URL('../lib/client.js', import.meta.url).href)
  expect(loaded.length).toBe(1)
  helpers = loaded[0]!.usageView as UsageViewHelpers
  expect(helpers).toBeTypeOf('object')
})

describe('usageWindowSince', () => {
  it('h5 is a rolling now - 5h', () => {
    const now = Date.parse('2026-09-09T15:30:00')
    expect(helpers.windowSince('h5', now)).toBe(now - 5 * 60 * 60 * 1000)
  })

  it('today is the local midnight of `now`', () => {
    const now = new Date(2026, 8, 9, 15, 30, 45).getTime() // Wed Sep 9, 15:30 local
    expect(helpers.windowSince('today', now)).toBe(new Date(2026, 8, 9, 0, 0, 0, 0).getTime())
  })

  it('week is the local Monday midnight (Sunday-start getDay corrected)', () => {
    const wednesday = new Date(2026, 8, 9, 15, 30, 45).getTime()
    expect(helpers.windowSince('week', wednesday)).toBe(new Date(2026, 8, 7, 0, 0, 0, 0).getTime())
    const sunday = new Date(2026, 8, 13, 23, 0).getTime()
    expect(helpers.windowSince('week', sunday)).toBe(new Date(2026, 8, 7, 0, 0, 0, 0).getTime())
    const monday = new Date(2026, 8, 14, 1, 0).getTime()
    expect(helpers.windowSince('week', monday)).toBe(new Date(2026, 8, 14, 0, 0, 0, 0).getTime())
  })
})

describe('fmtCompactTokens', () => {
  it('renders raw counts below 1e3', () => {
    expect(helpers.fmtCompactTokens(0)).toBe('0')
    expect(helpers.fmtCompactTokens(999)).toBe('999')
  })

  it('abbreviates K/M/B with one decimal', () => {
    expect(helpers.fmtCompactTokens(1000)).toBe('1.0K')
    expect(helpers.fmtCompactTokens(4900)).toBe('4.9K')
    expect(helpers.fmtCompactTokens(4_900_000)).toBe('4.9M')
    expect(helpers.fmtCompactTokens(7_900_000_000)).toBe('7.9B')
  })

  it('is robust to junk input', () => {
    expect(helpers.fmtCompactTokens(Number.NaN)).toBe('0')
    expect(helpers.fmtCompactTokens(-5)).toBe('0')
  })
})

describe('sliceUsageEvents', () => {
  // Wed Sep 9 2026, 15:00 local: now-1h and now-6h are both "today",
  // only now-1h is inside the rolling 5h, and everything lands in "week".
  const now = new Date(2026, 8, 9, 15, 0, 0).getTime()
  const events = [
    { model: 'glm-5.3', inputTokens: 10_000, outputTokens: 1_000, time: now - 1 * 60 * 60 * 1000 },
    { model: 'glm-5.3', inputTokens: 20_000, outputTokens: 2_500, time: now - 6 * 60 * 60 * 1000 },
    // Timestamped flash row: exercises the flash factors + non-approximate.
    { model: 'glm-5.3-flash', inputTokens: 5_000, outputTokens: 500, time: now - 2 * 60 * 60 * 1000 },
    // Null-time row: always dropped, only flips the unparsed flag.
    { model: 'glm-5.3-flash', inputTokens: 9_999, outputTokens: 9_999, time: null },
  ]

  it('slices the 5h window and drops null-time events, flagging them', () => {
    const out = helpers.sliceUsageEvents(events, 'h5', now)
    expect(out.unparsed).toBe(true)
    // now-1h (glm-5.3) and now-2h (flash) are inside; now-6h is not.
    expect(out.rows.map(row => row.model)).toEqual(['glm-5.3', 'glm-5.3-flash'])
    expect(out.rows[0]).toMatchObject({ model: 'glm-5.3', requests: 1, inputTokens: 10_000, outputTokens: 1_000, approximate: false })
    expect(out.rows[0].credits).toBeCloseTo(9.3, 6)
  })

  it('slices today from local midnight (both timestamped events count)', () => {
    const out = helpers.sliceUsageEvents(events, 'today', now)
    // glm-5.3 sums both events (29.1 credits) before flash (1.55).
    expect(out.rows.map(row => row.model)).toEqual(['glm-5.3', 'glm-5.3-flash'])
    expect(out.rows[0]).toMatchObject({ requests: 2, inputTokens: 30_000, outputTokens: 3_500, approximate: false })
    // Credits math: in 30k → 20.7, out 3.5k → 8.4.
    expect(out.rows[0].credits).toBeCloseTo(29.1, 6)
    // Flash row uses the flash factors and is not approximate.
    expect(out.rows[1].credits).toBeCloseTo(1.55, 6)
    expect(out.rows[1].approximate).toBe(false)
  })

  it('week matches today for same-week events and sorts credits descending', () => {
    const out = helpers.sliceUsageEvents(events, 'week', now)
    expect(out.rows.map(row => row.model)).toEqual(['glm-5.3', 'glm-5.3-flash'])
    expect(out.rows[0].credits).toBeCloseTo(29.1, 6)
    const borrowed = helpers.sliceUsageEvents([
      { model: 'glm-4.7', inputTokens: 10_000, outputTokens: 0, time: now },
      { model: 'glm-5.3', inputTokens: 0, outputTokens: 0, time: now },
    ], 'today', now)
    // 10k in at 6.9 → glm-4.7 (6.9) sorts above the zero-credit glm-5.3,
    // and its borrowed GLM-5.3 factors are flagged approximate.
    expect(borrowed.rows.map(row => row.model)).toEqual(['glm-4.7', 'glm-5.3'])
    expect(borrowed.rows[0].approximate).toBe(true)
    expect(borrowed.rows[1].approximate).toBe(false)
  })

  it('reports an unparsed-only window as empty with the flag set', () => {
    const out = helpers.sliceUsageEvents([{ model: 'glm-5.3', inputTokens: 10, outputTokens: 10, time: null }], 'today', now)
    expect(out.rows).toEqual([])
    expect(out.unparsed).toBe(true)
  })
})
