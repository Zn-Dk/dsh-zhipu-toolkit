/**
 * Configuration schema and validation for dsh-zhipu-toolkit.
 *
 * One schema answers three layers: the schemastery shape rendered by
 * configuration surfaces, the validator refusing unserviceable values where
 * they are written, and the resolved form the plugin assembles per endpoint.
 *
 * @module dsh-zhipu-toolkit/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { CODING_BASE_URL, PAAS_BASE_URL } from './catalog.ts'

/**
 * Which BigModel endpoint this deployment serves. The two endpoints expose
 * the same models and the same request semantics (verified live 2026-09-06:
 * identical `/models` lists, identical thinking/reasoning_effort behavior);
 * they differ only in billing — the Coding Plan endpoint is the
 * subscription-backed channel (Lite/Pro/Max quota, scoped to official coding
 * tools), the ordinary endpoint bills per token. A deployment picks the one
 * its account is billed on, so the field is one-of-two, not both.
 */
export type Endpoints = 'coding' | 'paas'

/**
 * Reasoning-effort tier wired for effort-undefined requests. GLM-5.3-series
 * models always think (`thinking:disabled` is refused with error 1210), so
 * the default stays on the cheapest offered tier; higher tiers trade latency
 * for depth on every request that does not name an effort itself.
 */
export type ReasoningTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Default credential references, one per endpoint. */
export const DEFAULT_CODING_API_KEY_ENV = 'BIGMODEL_API_KEY'
export const DEFAULT_PAAS_API_KEY_ENV = 'ZHIPU_API_KEY'

/**
 * Credential reference holding the locally-managed API key when
 * {@link Config.useLocalApiKey} is on. The value lives in the dsh credentials
 * store (written through the settings card), never in settings.yaml.
 */
export const LOCAL_API_KEY_REF = 'ZHIPU_TOOLKIT_API_KEY'

/** Reasoning tiers offered by every maintained GLM model, cheapest first. */
export const REASONING_TIERS: readonly ReasoningTier[] = ['low', 'medium', 'high', 'xhigh', 'max']

const DEFAULT_DISPLAY_NAME = 'BigModel'
const DEFAULT_REASONING_TIER: ReasoningTier = 'low'
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/** Plugin configuration validated by {@link Config}. */
export interface Config {
  /**
   * The single BigModel endpoint this deployment serves: `coding` (Coding
   * Plan, subscription quota) or `paas` (ordinary API, per-token billing).
   */
  endpoints?: Endpoints
  /** Credential reference resolved for every coding-endpoint request. */
  codingApiKeyEnv?: string
  /** Credential reference resolved for every ordinary-endpoint request. */
  paasApiKeyEnv?: string
  /** BigModel Coding Plan API base URL. */
  codingBaseURL?: string
  /** Ordinary BigModel OpenAPI base URL. */
  paasBaseURL?: string
  /** Provider label shown in model selectors for the served route. */
  displayName?: string
  /**
   * Reasoning tier wired for requests that name no effort themselves.
   * GLM-5.3-series models cannot turn thinking off, so `off` is not offered.
   */
  defaultReasoningTier?: ReasoningTier
  /**
   * Hold the API key locally: when on, the plugin resolves the key from the
   * `ZHIPU_TOOLKIT_API_KEY` credential reference (written by the settings
   * card through the credentials service) instead of the per-endpoint env
   * reference; the env path stays as fallback when the local key is absent.
   */
  useLocalApiKey?: boolean
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * Base64 image payload bound for one request. Older images become text
   * placeholders once a session's accumulated images exceed it, so a long
   * session keeps completing requests instead of being refused for size.
   */
  maxRequestImageBytes?: number
  /** Total-pixel budget for each deterministic inline request version. */
  requestImagePixelBudget?: number
  /** Raw encoded-byte cap for each deterministic inline request version. */
  requestImageMaxBytes?: number
}

/** Schemastery validator for the plugin configuration. */
export const Config: z<Config> = z.object({
  endpoints: z.union([z.const('coding'), z.const('paas')]).default('coding'),
  codingApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_CODING_API_KEY_ENV),
  paasApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_PAAS_API_KEY_ENV),
  codingBaseURL: z.string().default(CODING_BASE_URL),
  paasBaseURL: z.string().default(PAAS_BASE_URL),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  defaultReasoningTier: z.union([
    z.const('low'), z.const('medium'), z.const('high'), z.const('xhigh'), z.const('max'),
  ]).default(DEFAULT_REASONING_TIER),
  useLocalApiKey: z.boolean().default(false),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  requestImagePixelBudget: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
})

/** One endpoint route after defaults and validation. */
export interface ResolvedEndpoint {
  /** Harness route id, also the profile key in the adapter. */
  readonly provider: 'zai' | 'zhipu'
  /** Credential reference resolved for every request on this route. */
  readonly apiKeyEnv: string
  /** API base URL with no trailing slash. */
  readonly baseURL: string
  /** Provider label shown in model selectors for this route. */
  readonly displayName: string
}

/** Fully resolved plugin configuration. */
export interface ResolvedConfig {
  /** The single route to register. */
  readonly endpoints: readonly ResolvedEndpoint[]
  /** Reasoning tier wired for effort-undefined requests. */
  readonly defaultReasoningTier: ReasoningTier
  /** Whether the locally-managed API key reference takes precedence. */
  readonly useLocalApiKey: boolean
  readonly streamIdleTimeoutMs: number
  readonly maxRequestImageBytes: number
  readonly requestImagePixelBudget: number
  readonly requestImageMaxBytes: number
}

function requireNonEmpty(value: string, field: string): string {
  if (value.length === 0) throw new Error(`dsh-zhipu-toolkit: ${field} must not be empty`)
  return value
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`dsh-zhipu-toolkit: ${field} must be a positive safe integer`)
  }
}

/**
 * Validate a raw configuration and resolve every default.
 * @param config - schema-validated plugin configuration.
 * @returns the resolved route and shared settings.
 * @throws Error naming the first unserviceable entry.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const defaultReasoningTier = config.defaultReasoningTier ?? DEFAULT_REASONING_TIER
  const useLocalApiKey = config.useLocalApiKey ?? false
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  const maxRequestImageBytes = config.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
  const requestImagePixelBudget = config.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
  const requestImageMaxBytes = config.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `dsh-zhipu-toolkit: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  requirePositiveInteger(maxRequestImageBytes, 'maxRequestImageBytes')
  requirePositiveInteger(requestImagePixelBudget, 'requestImagePixelBudget')
  requirePositiveInteger(requestImageMaxBytes, 'requestImageMaxBytes')
  const displayName = requireNonEmpty(config.displayName ?? DEFAULT_DISPLAY_NAME, 'displayName')
  const mode = config.endpoints ?? 'coding'
  const endpoints: ResolvedEndpoint[] = []
  if (mode === 'coding') {
    endpoints.push({
      provider: 'zai',
      apiKeyEnv: requireNonEmpty(config.codingApiKeyEnv ?? DEFAULT_CODING_API_KEY_ENV, 'codingApiKeyEnv'),
      baseURL: requireNonEmpty(
        (config.codingBaseURL ?? CODING_BASE_URL).replace(/\/+$/, ''),
        'codingBaseURL',
      ),
      displayName,
    })
  } else {
    endpoints.push({
      provider: 'zhipu',
      apiKeyEnv: requireNonEmpty(config.paasApiKeyEnv ?? DEFAULT_PAAS_API_KEY_ENV, 'paasApiKeyEnv'),
      baseURL: requireNonEmpty(
        (config.paasBaseURL ?? PAAS_BASE_URL).replace(/\/+$/, ''),
        'paasBaseURL',
      ),
      displayName,
    })
  }
  return {
    endpoints,
    defaultReasoningTier,
    useLocalApiKey,
    streamIdleTimeoutMs,
    maxRequestImageBytes,
    requestImagePixelBudget,
    requestImageMaxBytes,
  }
}
