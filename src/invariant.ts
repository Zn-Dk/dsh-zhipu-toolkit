/**
 * Package-owned invariant companion for dsh-zhipu-toolkit.
 *
 * Unlike dsh-bigmodel-catalog (whose invariant companion is a no-op because
 * the LLM registry owns everything), this package owns verifiable catalog
 * invariants that hold regardless of registration lifecycle: the wire-tier
 * whitelist the API accepts, and the thinking-level mapping that must keep
 * routing every offered picker tier into it.
 *
 * @module dsh-zhipu-toolkit/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { GLM53_THINKING_LEVEL_MAP, MAINTAINED_TEXT_MODELS } from './catalog.ts'

export const name = 'dsh-zhipu-toolkit-invariant'
export const inject = ['invariants']

/** The only reasoning-effort wire values the BigModel API accepts (verified 2026-09-06). */
export const WIRE_TIER_WHITELIST = new Set(['low', 'medium', 'high', 'max'])

/** Picker tiers that survive mapping — every key mapped to `null` is hidden instead. */
export const OFFERED_PICKER_TIERS = Object.freeze(
  (Object.keys(GLM53_THINKING_LEVEL_MAP) as Array<keyof typeof GLM53_THINKING_LEVEL_MAP>)
    .filter(tier => GLM53_THINKING_LEVEL_MAP[tier] !== null),
)

/** The complete GLM-5.3-series wire mapping as a plain object, for tests. */
export const GLM53_WIRE_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(GLM53_THINKING_LEVEL_MAP) as Array<keyof typeof GLM53_THINKING_LEVEL_MAP>)
      .filter(tier => GLM53_THINKING_LEVEL_MAP[tier] !== null)
      .map(tier => [tier, GLM53_THINKING_LEVEL_MAP[tier] as string]),
  ),
)

/**
 * Every maintained descriptor that offers a thinking-level map must map every
 * offered picker tier into the wire whitelist, and must not offer `off`
 * (GLM-5.3-series always think; `thinking:disabled` is refused with 1210).
 */
const install: InvariantInstaller = (_ctx, fail) => {
  for (const model of MAINTAINED_TEXT_MODELS) {
    const map = model.thinkingLevelMap
    if (map === undefined) continue
    if (map.off !== null || map.minimal !== null) {
      fail(`model ${model.id} must not offer a disablable thinking tier (off/minimal must be null)`)
    }
    for (const [tier, wire] of Object.entries(map)) {
      if (wire === null) continue
      if (!WIRE_TIER_WHITELIST.has(wire)) {
        fail(`model ${model.id} maps thinking tier ${tier} to wire tier ${wire} outside the verified whitelist`)
      }
    }
  }
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('dsh-zhipu-toolkit', install))
