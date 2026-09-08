/**
 * Self-maintained GLM family model catalog for Zhipu BigModel endpoints.
 *
 * Pure logic, no I/O: the descriptor table, the verified thinking-level map,
 * the wire-compatibility flags, the merge policy over pi-ai's builtin catalog,
 * and the `/models` payload parsing live here so tests can pin every shape.
 *
 * The semantics inherited from dsh-bigmodel-catalog commit d8189e3
 * (verified live 2026-09-06 against both BigModel endpoints):
 * - `compat.supportsReasoningEffort: true` + `compat.maxTokensField: 'max_tokens'`
 * - GLM-5.3-series `thinkingLevelMap`: `off`/`minimal` removed (`null`),
 *   `low`/`medium`/`high` collapse onto the `high` wire tier, `xhigh`/`max`
 *   unlock `max`.
 * - profile default reasoning tier `low`, so effort-undefined requests never
 *   wire `thinking: {type: "disabled"}` (the API refuses it with error 1210).
 * - descriptors carrying an explicit thinking-level map supersede the builtin
 *   catalog's stale entry for the same id.
 *
 * @module dsh-zhipu-toolkit/catalog
 */

import type { Api, Model, OpenAICompletionsCompat } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

/** pi-ai provider id served by the BigModel Coding Plan endpoint. */
export const CODING_PROVIDER_ID = 'zai'
/** Harness route id served by the ordinary BigModel OpenAPI endpoint. */
export const PAAS_PROVIDER_ID = 'zhipu'
/** BigModel Coding Plan API base URL. */
export const CODING_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'
/** Ordinary BigModel OpenAPI base URL. */
export const PAAS_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const

/** Wire-compatibility flags verified against both BigModel endpoints. */
export const GLM_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
  thinkingFormat: 'zai',
  zaiToolStream: true,
}

/**
 * GLM-5.3-series models always think: the API refuses `thinking:disabled` and
 * `reasoning_effort:minimal/medium` outright (verified 2026-09-06 against the
 * coding endpoint, error 1210 "请使用 low、high 或 max"). `off` is removed from
 * the picker entirely; the surviving low tiers collapse onto `high` (upstream's
 * glm-5.2 strategy), and xhigh/max unlock the `max` wire tier.
 */
export const GLM53_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: 'high',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
} as const

/** One self-maintained text model descriptor. */
export interface MaintainedTextModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly thinkingLevelMap?: Model<'openai-completions'>['thinkingLevelMap']
  /** Input modalities; defaults to text-only when omitted. */
  readonly input?: Model<'openai-completions'>['input']
}

/** The full GLM chat family this toolkit maintains, newest last. */
export const MAINTAINED_TEXT_MODELS: readonly MaintainedTextModel[] = [
  { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 131_072, maxTokens: 98_304 },
  { id: 'glm-4.5-air', name: 'GLM-4.5-Air', contextWindow: 131_072, maxTokens: 98_304 },
  { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 204_800, maxTokens: 131_072 },
  { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 204_800, maxTokens: 131_072 },
  { id: 'glm-5', name: 'GLM-5', contextWindow: 200_000, maxTokens: 131_072 },
  { id: 'glm-5-turbo', name: 'GLM-5-Turbo', contextWindow: 200_000, maxTokens: 131_072 },
  { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, maxTokens: 131_072 },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, maxTokens: 131_072 },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    thinkingLevelMap: GLM53_THINKING_LEVEL_MAP,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    thinkingLevelMap: GLM53_THINKING_LEVEL_MAP,
    // The official GLM-5.3-Flash docs list input = video, image, text, file
    // (multi-image via messages[].content[] image_url, URL or Base64);
    // pi-ai's Model["input"] type only knows "text" | "image" today, so
    // image is enabled here and video/file stay pending on the type.
    input: ['text', 'image'],
  },
]

/** Build one openai-completions model descriptor bound to a BigModel endpoint. */
export function textModel(
  id: string,
  name: string,
  contextWindow: number,
  maxTokens: number,
  thinkingLevelMap?: Model<'openai-completions'>['thinkingLevelMap'],
  input?: Model<'openai-completions'>['input'],
): Model<'openai-completions'> {
  return {
    id,
    name,
    api: 'openai-completions',
    provider: CODING_PROVIDER_ID,
    baseUrl: CODING_BASE_URL,
    reasoning: true,
    ...thinkingLevelMap === undefined ? {} : { thinkingLevelMap },
    input: input ?? ['text'],
    cost: ZERO_COST,
    compat: GLM_COMPAT,
    contextWindow,
    maxTokens,
  }
}

/**
 * Merge additions over a base catalog. An addition carrying an explicit
 * thinking level map (and the compat flags verified against the live API)
 * supersedes the base's older entry for the same id, so the map actually
 * reaches the wire; a map-less addition only fills ids the base lacks.
 * @param base - catalog entries, typically pi-ai's builtin models.
 * @param additions - self-maintained descriptors to overlay.
 * @returns merged descriptors in base order followed by new additions.
 */
export function appendMissing(
  base: readonly Model<Api>[],
  additions: readonly Model<Api>[],
): readonly Model<Api>[] {
  const merged = new Map(base.map(model => [model.id, model]))
  for (const model of additions) {
    const existing = merged.get(model.id)
    merged.set(model.id, existing === undefined || model.thinkingLevelMap === undefined
      ? existing ?? model
      : { ...existing, ...model })
  }
  return [...merged.values()]
}

/** Maintained descriptors plus models live-verified ahead of pi-ai's catalog. */
export const maintainedModels: readonly Model<Api>[] = appendMissing(
  getBuiltinModels(CODING_PROVIDER_ID),
  MAINTAINED_TEXT_MODELS.map(model => textModel(
    model.id,
    model.name,
    model.contextWindow,
    model.maxTokens,
    model.thinkingLevelMap,
    model.input,
  )),
)

/** Models proven by a direct completion may remain even when `/models` lags. */
export const DIRECTLY_VERIFIED = new Set(['glm-5.3', 'glm-5.3-flash'])

/**
 * Parse the provider-neutral ids returned by BigModel's Models endpoint.
 * @param payload - decoded JSON response body.
 * @returns model ids in provider order.
 * @throws Error when the payload is not `{ data: [{ id: string }, ...] }`.
 */
export function parseModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('BigModel /models response must contain a data array')
  }
  return (payload as { data: unknown[] }).data.map((entry) => {
    if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') {
      throw new Error('BigModel /models response contains an entry without a string id')
    }
    return (entry as { id: string }).id
  })
}

/**
 * Reconcile a live `/models` list with the maintained catalog, keeping
 * directly-verified additions even when the endpoint lags.
 * @param payload - decoded provider response body.
 * @returns maintained descriptors currently reported or directly verified.
 */
export function discoverModels(payload: unknown): readonly Model<Api>[] {
  const live = new Set(parseModelIds(payload))
  return maintainedModels.filter(model => live.has(model.id) || DIRECTLY_VERIFIED.has(model.id))
}
