/**
 * Dual-endpoint Zhipu BigModel GLM provider routes backed by pi-ai message
 * conversion: the Coding Plan endpoint (`zai`) and the ordinary OpenAPI
 * endpoint (`zhipu`). One is served at a time (they expose the same models
 * and semantics; the choice is which billing channel the account uses),
 * each with its own label and credential reference.
 *
 * Configuration is hot-reloadable: the plugin owns the `zhipu-toolkit`
 * settings namespace (`settings.installSection`), so edits made in the
 * settings card — or directly in settings.yaml — re-resolve the routes
 * without a restart. The Client half reaches the same namespace over the
 * `/zhipu-toolkit-settings` connection RPC channel (see ./settings-rpc.ts).
 *
 * @module dsh-zhipu-toolkit
 */

import {
  defaultProviderAuthContext,
  InMemoryCredentialStore,
  type Api,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai'
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
// Type-only: pulls the ctx.settings Context merge into this program (the
// dsh-settings Service Definition declares it); the runtime service is
// provided by the host composition.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the ctx.connection Context merge (the Host connection
// handle that rpc.handle registers channels on).
import type {} from '@deepseek-ai/dsh-client-connection'
import { discoverModels, maintainedModels } from './catalog.ts'
import { Config, LOCAL_API_KEY_REF, resolveConfig, type Config as ConfigType, type ResolvedConfig } from './config.ts'
import { createSettingsRpcHandler, type CredentialsFace, type SettingsProviderFace } from './settings-rpc.ts'
import { computeUsageStats } from './usage-stats.ts'

export const name = 'dsh-zhipu-toolkit'
export const inject = ['llm', 'credentials']
export { Config }
export type { Config as ConfigType } from './config.ts'
export {
  appendMissing,
  CODING_BASE_URL,
  CODING_PROVIDER_ID,
  DIRECTLY_VERIFIED,
  discoverModels,
  GLM53_THINKING_LEVEL_MAP,
  GLM_COMPAT,
  maintainedModels,
  MAINTAINED_TEXT_MODELS,
  PAAS_BASE_URL,
  PAAS_PROVIDER_ID,
  parseModelIds,
  textModel,
} from './catalog.ts'
export {
  LOCAL_API_KEY_REF,
  resolveConfig,
} from './config.ts'
export type {
  Endpoints, ReasoningTier, ResolvedConfig as ResolvedConfigType, ResolvedEndpoint,
} from './config.ts'
export { REASONING_TIERS } from './config.ts'
export { createSettingsRpcHandler, MUTABLE_FIELDS } from './settings-rpc.ts'
export type { RpcResult, SettingsPathOp, SettingsProviderFace, SettingsView } from './settings-rpc.ts'
export {
  computeUsageStats,
  creditFactorsFor,
  defaultSessionsDir,
  EVENTS_CAP,
  FLASH_CREDIT_FACTORS,
  GLM53_CREDIT_FACTORS,
  resetUsageStatsCache,
} from './usage-stats.ts'
export type {
  UsageCreditFactors, UsageEventRow, UsageModelRow, UsageStatsMode, UsageStatsResult, UsageWindowStats,
} from './usage-stats.ts'

/** Settings namespace owned by this plugin (lowercase kebab-case). */
export const SETTINGS_NAMESPACE = 'zhipu-toolkit'

/** Connection RPC channel serving the settings card (see CHANNEL_PATTERN: no inner slashes). */
export const SETTINGS_CHANNEL = '/zhipu-toolkit-settings'

/** The default reasoning tier applied to effort-undefined requests. */
export const DEFAULT_REASONING_TIER = 'low' as const

function providerFor(
  endpoint: ResolvedConfig['endpoints'][number],
  models: readonly Model<Api>[],
): Provider {
  const builtin = zaiProvider()
  const resolvedModels = models.map(model => ({
    ...model,
    provider: endpoint.provider,
    baseUrl: endpoint.baseURL,
  }))
  return {
    ...builtin,
    id: endpoint.provider,
    name: endpoint.displayName,
    baseUrl: endpoint.baseURL,
    getModels: () => resolvedModels,
  }
}

function profilesFor(
  config: ResolvedConfig,
  models: readonly Model<Api>[],
): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
  const entries = config.endpoints.map(endpoint => {
    const profile = {
      provider: endpoint.provider,
      displayName: endpoint.displayName,
      apiKeyEnv: credentialRef(endpoint.apiKeyEnv),
      // GLM-5.3-series always think: an effort-less request would wire
      // `thinking:{type:"disabled"}` and be refused (1210). Default the profile
      // to the configured tier (lowest offered by default) so effort-undefined
      // requests stay valid.
      reasoning: config.defaultReasoningTier,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
      maxRequestImageBytes: config.maxRequestImageBytes,
      requestImagePixelBudget: config.requestImagePixelBudget,
      requestImageMaxBytes: config.requestImageMaxBytes,
      retryPolicy: resolveRetryPolicy(undefined, 'dsh-zhipu-toolkit: retryPolicy'),
      configuredMaxTokens: new Map<string, number>(),
      piProvider: providerFor(endpoint, models),
    }
    // This package pins pi-ai 0.82.1 (the version whose builtin GLM catalog
    // the maintained overlay was verified against), while the host's
    // dsh-llm-pi-ai links 0.84.2. The two copies interoperate structurally at
    // runtime — the same dual-copy arrangement the installed
    // dsh-bigmodel-catalog runs under — but their Provider d.ts disagree on
    // the optional refreshModels callback, so the crossing needs one cast.
    return [endpoint.provider, profile as unknown as ResolvedPiAiProviderProfile] as const
  })
  return new Map(entries)
}

/**
 * Register and live-filter the BigModel provider route.
 *
 * The composition entry (`rawConfig` from cordis.patch.yml) is the fallback
 * source; once the settings service is present the `zhipu-toolkit` namespace
 * section takes over as the authoritative source and committed edits re-run
 * {@link resync} without a restart.
 * @param ctx - Cordis context providing LLM and credential services.
 * @param rawConfig - validated plugin configuration (composition entry).
 */
export function apply(ctx: Context, rawConfig: ConfigType): void {
  // Configuration source: starts at the composition entry, replaced by the
  // settings scope once the namespace is installed. `readConfig` always
  // resolves through the live source, so a committed settings write is picked
  // up by the next resync/refresh (the llm-deepseek `current()` pattern).
  let source: () => ConfigType = () => rawConfig
  const readConfig = (): ResolvedConfig => resolveConfig(source())
  let config = readConfig()
  let profiles = profilesFor(config, maintainedModels)
  const routes = (): string[] => config.endpoints.map(endpoint => endpoint.provider)
  const resolveApiKey = async (provider: string): Promise<string> => {
    const endpoint = config.endpoints.find(route => route.provider === provider)
    if (endpoint === undefined) {
      throw new LlmError(
        `dsh-zhipu-toolkit: no endpoint configured for provider route "${provider}"`,
        'MISSING_CREDENTIAL',
      )
    }
    // Local-key mode first: the card-written ZHIPU_TOOLKIT_API_KEY reference
    // in the credentials store wins when the user opted in and it is set.
    if (config.useLocalApiKey) {
      const local = await ctx.credentials.resolve(credentialRef(LOCAL_API_KEY_REF))
      if (local !== undefined) {
        return assertUsableApiKey(local.value, 'dsh-zhipu-toolkit', LOCAL_API_KEY_REF)
      }
    }
    // Env-reference path (always the fallback, also the only path when
    // useLocalApiKey is off).
    const ref = credentialRef(endpoint.apiKeyEnv)
    const hit = await ctx.credentials.resolve(ref)
    if (hit !== undefined) {
      return assertUsableApiKey(hit.value, 'dsh-zhipu-toolkit', endpoint.apiKeyEnv)
    }
    throw new LlmError(
      `dsh-zhipu-toolkit: no API key for provider route "${provider}"; store ${endpoint.apiKeyEnv}`
      + ' through the credentials service'
      + (config.useLocalApiKey ? ` or set the local API key (${LOCAL_API_KEY_REF})` : ''),
      'MISSING_CREDENTIAL',
    )
  }
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: (provider) => resolveApiKey(provider),
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
  })
  const registration = ctx.llm.registerAdapter(routes(), adapter)
  const controller = new AbortController()
  let refreshing: Promise<void> | undefined
  /** Re-resolve the routes after a committed settings change, atomically. */
  const resync = (): void => {
    config = readConfig()
    profiles = profilesFor(config, maintainedModels)
    registration.replace(routes())
  }
  const refresh = (): void => {
    refreshing ??= (async () => {
      try {
        const liveByProvider = new Map<string, readonly Model<Api>[]>()
        for (const endpoint of config.endpoints) {
          const apiKey = await resolveApiKey(endpoint.provider)
          const response = await fetch(`${endpoint.baseURL}/models`, {
            headers: { authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`BigModel /models failed with HTTP ${response.status}`)
          const live = discoverModels(await response.json())
          if (live.length === 0) throw new Error('BigModel /models returned no maintained chat models')
          liveByProvider.set(endpoint.provider, live)
        }
        const liveUnion: readonly Model<Api>[] = liveByProvider.size === 0
          ? maintainedModels
          : maintainedModels.filter(model => [...liveByProvider.values()].some(
              list => list.some(live => live.id === model.id),
            ))
        profiles = profilesFor(config, liveUnion)
        registration.replace(routes())
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.logger.warn('dsh-zhipu-toolkit: live refresh failed; keeping the maintained catalog')
          ctx.logger.warn(error)
        }
      } finally {
        refreshing = undefined
      }
    })()
  }
  ctx.effect(() => {
    refresh()
    return () => { controller.abort() }
  }, 'dsh-zhipu-toolkit: live refresh')
  ctx.on('credentials/reference-updated', (ref: string) => {
    if (ref === LOCAL_API_KEY_REF || config.endpoints.some(endpoint => endpoint.apiKeyEnv === ref)) refresh()
  })

  // Hot-reloadable settings section: the composition entry (with schema
  // defaults resolved) is the base layer, the user layer lives in
  // settings.yaml under the same namespace. A write that fails the
  // serviceability check is refused where it is written.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      SETTINGS_NAMESPACE,
      Config,
      Config(rawConfig),
      {
        // Refuse an unserviceable section at write time: without this a
        // schema-valid but unusable value would be stored and then silently
        // keep the previous routes serving (resolveConfig throws name the
        // first bad field).
        validate: (value: ConfigType) => { resolveConfig(value) },
        // Store the live source; every later read (resync/refresh) resolves
        // the CURRENT section, so committed writes take effect immediately.
        setSource: (next: () => ConfigType) => { source = next },
        onChange: () => {
          try {
            resync()
          } catch (error) {
            ctx.logger.error('dsh-zhipu-toolkit: keeping the previous routes after a refused settings update')
            ctx.logger.error(error)
          }
          refresh()
        },
      },
    )
    // Serve the same section to the Web settings card over the settings
    // provider seam (get/mutate with revisions, the same face the official
    // settings surfaces use). The connection envelope carries
    // {code, message, details} failures; the bridge's own result shape maps
    // straight onto it. The credentials face lets the card write the local
    // API key into the credentials store (never into settings.yaml) and read
    // back only its configured state plus a masked summary.
    settingsCtx.inject(['connection'], (webCtx) => {
      const connection = webCtx.connection
      if (connection === undefined) return
      const credentialsFace: CredentialsFace = {
        set: (ref, value) => webCtx.credentials.set(credentialRef(ref), value),
        unset: (ref) => webCtx.credentials.unset(credentialRef(ref)),
        describe: async (ref) => {
          const info = await webCtx.credentials.describe(credentialRef(ref))
          return { configured: info.configured, writable: info.writable }
        },
        masked: async (ref) => {
          const hit = await webCtx.credentials.resolve(credentialRef(ref))
          if (hit === undefined) return undefined
          const tail = hit.value.slice(-4)
          return '••••••••' + tail
        },
      }
      const handler = createSettingsRpcHandler(
        webCtx.settings as unknown as SettingsProviderFace,
        SETTINGS_NAMESPACE,
        credentialsFace,
        undefined,
        // Read-only local usage aggregate (60s cached, never leaves the host).
        () => computeUsageStats(),
      )
      webCtx.effect(() => connection.rpc.handle(
        SETTINGS_CHANNEL,
        async (endpoint: string, payload: unknown) => {
          const outcome = await handler(endpoint, payload)
          return outcome.ok
            ? { ok: true, value: outcome.value } as const
            : {
              ok: false,
              error: { code: outcome.error.code, message: outcome.error.message, details: {} },
            } as const
        },
      ), 'dsh-zhipu-toolkit: settings RPC channel')
    })

    // Fire-and-forget usage pre-scan: by the time the user opens the
    // settings card the 60s-cached, incrementally-built aggregate is
    // usually ready, so the panel reads instantly instead of waiting on a
    // cold ~30s scan. Failures stay silent — the card degrades to its
    // loading/empty state and the next RPC attempt retries anyway.
  // Deferred prescan: warming the usage cache is pure host-side bookkeeping and
  // must not compete with boot-critical work (plugin assembly, tsx transpile).
  // 60s settle delay keeps the event loop responsive during startup; the scan
  // itself stays fire-and-forget with silent failure and incremental caching.
  const prescanTimer = setTimeout(() => {
    void computeUsageStats().catch(() => undefined)
  }, 60_000)
  ctx.effect(() => () => clearTimeout(prescanTimer), 'model-catalog-bigmodel: usage prescan timer')
  })
}
