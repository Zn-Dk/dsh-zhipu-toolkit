/**
 * Settings RPC bridge for the Client half of dsh-zhipu-toolkit.
 *
 * Pure factory, unit-testable without a real DSH host: it wraps the host
 * settings provider (the same seam the official settings surfaces use) into
 * the get/mutate endpoint pair the settings card calls over
 * `connection.rpc`, plus a local-API-key endpoint set backed by the
 * credentials service so the card can hold the key in the credentials store
 * (never in settings.yaml). The field whitelist below is the whole attack
 * surface of the channel — a client can only write fields the card itself
 * owns.
 *
 * Provider faces consumed (see @deepseek-ai/dsh-settings and
 * @deepseek-ai/dsh-credentials):
 *   settings.get(ns) -> resolved value, or undefined while unregistered
 *   settings.mutate(ns, ops, expectedRevision?) -> Promise<void>
 *   settings.writable -> boolean
 *   settings.describe({redactSecrets: true}) -> descriptors with revisions
 *   credentials.set(ref, value) -> Promise<void>
 *   credentials.unset(ref) -> Promise<void>
 *   credentials.describe(ref) -> Promise<{configured, writable, ...}>
 *
 * @module dsh-zhipu-toolkit/settings-rpc
 */

import type { UsageStatsResult } from './usage-stats.ts'

/** Which card-editable fields the mutate endpoint may write. */
export const MUTABLE_FIELDS = [
  'endpoints',
  'codingApiKeyEnv',
  'paasApiKeyEnv',
  'codingBaseURL',
  'paasBaseURL',
  'displayName',
  'defaultReasoningTier',
  'useLocalApiKey',
] as const

/** Connection RPC result envelope (wire shape of @deepseek-ai/dsh-client-connection). */
export type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One path-addressed edit over the namespace's user section. */
export interface SettingsPathOp {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** Snapshot the card reads after every get/mutate. */
export interface SettingsView {
  /** Current resolved section. */
  readonly value: unknown
  /** Monotonic revision of the raw user section; send back as expectedRevision. */
  readonly revision: number
}

/** Local-API-key state the card reads; the value itself never crosses. */
export interface LocalApiKeyView {
  /** Whether the local key reference currently resolves. */
  readonly configured: boolean
  /** Whether the credentials provider can write this reference. */
  readonly writable: boolean
  /** Masked summary of the saved value (bullets + last characters). */
  readonly masked: string
}

/** Provider face this bridge needs from the settings service. */
export interface SettingsProviderFace {
  get(ns: string): unknown
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): ReadonlyArray<{
    ns: string
    value: unknown
    revision: number
  }>
}

/** Provider face this bridge needs from the credentials service. */
export interface CredentialsFace {
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  describe(ref: string): Promise<{ configured: boolean, writable: boolean }>
  /**
   * Read the stored value and return a masked summary (bullets plus the
   * last characters), or `undefined` while unconfigured. The raw value
   * never crosses this seam; only the masked form does.
   */
  masked(ref: string): Promise<string | undefined>
}

function result(value: unknown): RpcResult {
  return { ok: true, value }
}

function failure(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message } }
}

const MUTABLE = new Set<string>(MUTABLE_FIELDS)

/**
 * Build the get/mutate/local-key endpoint handler for
 * `'/zhipu-toolkit-settings'`.
 *
 * The credentials face is addressed by reference *name*: the bridge passes
 * the `localKeyRef` it was constructed with (the plugin's
 * `ZHIPU_TOOLKIT_API_KEY`), so the factory stays pure while the wired host
 * handler reaches the real credentials service under exactly that name.
 *
 * @param settings - the host settings provider.
 * @param namespace - the `zhipu-toolkit` settings namespace.
 * @param credentials - the host credentials provider (local-key endpoints;
 *   a deployment without one can pass a stub rejecting every call).
 * @param localKeyRef - the credential reference the local key is stored
 *   under (default `ZHIPU_TOOLKIT_API_KEY`).
 * @param usageStats - the local usage aggregate producer backing the
 *   read-only `usage-stats` endpoint; omit it in deployments without
 *   session-log access and the endpoint degrades to a typed failure.
 * @returns async `(endpoint, payload) => RpcResult`.
 */
export function createSettingsRpcHandler(
  settings: SettingsProviderFace,
  namespace: string,
  credentials?: CredentialsFace,
  localKeyRef: string = 'ZHIPU_TOOLKIT_API_KEY',
  usageStats?: () => Promise<UsageStatsResult>,
): (endpoint: string, payload: unknown) => Promise<RpcResult> {
  const view = (): SettingsView => {
    const descriptor = settings.describe({ redactSecrets: true })
      .find(entry => entry.ns === namespace)
    return {
      value: descriptor === undefined ? settings.get(namespace) : descriptor.value,
      revision: descriptor?.revision ?? 0,
    }
  }
  const localKeyView = async (): Promise<LocalApiKeyView> => {
    if (credentials === undefined) return { configured: false, writable: false, masked: '' }
    const state = await credentials.describe(localKeyRef)
    const masked = state.configured ? (await credentials.masked(localKeyRef)) ?? '' : ''
    return { configured: state.configured, writable: state.writable, masked }
  }
  return async (endpoint: string, rawPayload: unknown): Promise<RpcResult> => {
    try {
      if (endpoint === 'get') return result(view())
      if (endpoint === 'usage-stats') {
        if (usageStats === undefined) {
          return failure('unavailable', 'usage statistics are not available in this deployment')
        }
        return result(await usageStats())
      }
      if (endpoint === 'local-key') return result(await localKeyView())
      if (endpoint === 'set-local-key') {
        if (credentials === undefined) {
          return failure('no-credentials', 'no credentials service is available in this deployment')
        }
        const payload = (rawPayload ?? {}) as { value?: unknown }
        const value = payload.value
        if (typeof value !== 'string' || value.trim().length === 0) {
          return failure('bad-value', 'the local API key must be a non-empty string')
        }
        await credentials.set(localKeyRef, value)
        return result(await localKeyView())
      }
      if (endpoint === 'unset-local-key') {
        if (credentials === undefined) {
          return failure('no-credentials', 'no credentials service is available in this deployment')
        }
        await credentials.unset(localKeyRef)
        return result(await localKeyView())
      }
      if (endpoint !== 'mutate') return failure('bad-endpoint', `unknown endpoint: ${endpoint}`)
      if (!settings.writable) return failure('read-only', 'the settings document is read-only in this deployment')
      const payload = (rawPayload ?? {}) as {
        ops?: unknown
        expectedRevision?: number
      }
      const rawOps = payload.ops ?? []
      if (!Array.isArray(rawOps)) return failure('malformed', 'ops must be an array')
      // Whitelist gate: only card-owned top-level fields, only set/unset.
      const ops: SettingsPathOp[] = []
      for (const raw of rawOps) {
        const op = raw as { op?: unknown, path?: unknown }
        if (op.op !== 'set' && op.op !== 'unset') {
          return failure('bad-op', `unsupported op: ${String(op.op)}`)
        }
        if (!Array.isArray(op.path) || op.path.length !== 1 || typeof op.path[0] !== 'string'
          || !MUTABLE.has(op.path[0])) {
          return failure('bad-field', `unsupported field: ${String(Array.isArray(op.path) ? op.path[0] : op.path)}`)
        }
        ops.push(op.op === 'set'
          ? { op: 'set', path: op.path as readonly string[], value: (raw as { value?: unknown }).value }
          : { op: 'unset', path: op.path as readonly string[] })
      }
      await settings.mutate(namespace, ops, payload.expectedRevision)
      return result(view())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = /changed since it was read/i.test(message) ? 'settings-conflict' : 'settings-rejected'
      return failure(code, message)
    }
  }
}
