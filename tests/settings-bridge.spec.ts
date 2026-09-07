import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as ZhipuToolkit from '../src/index.ts'
import { SETTINGS_CHANNEL, SETTINGS_NAMESPACE } from '../src/index.ts'

let context: Context | undefined

/** In-memory read-write credentials provider (resolve + writable refs). */
class TestCredentials extends CredentialProvider {
  private readonly stored = new Map<string, string>()

  constructor(ctx: Context, private readonly values: Readonly<Record<string, string>>) {
    super(ctx)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.stored.get(ref) ?? this.values[ref]
    return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
  }

  override async describe(ref: CredentialRef) {
    return { configured: this.stored.has(ref) || this.values[ref] !== undefined, source: 'test', writable: true }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    this.stored.set(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    this.stored.delete(ref)
  }
}

/**
 * In-memory read-write settings provider: the real SettingsProvider base
 * (register/get/update/describe/installSection) over a document held in the
 * instance, persisted back into the same map.
 */
class MemorySettings extends SettingsProvider {
  override readonly writable = true
  document: Record<string, Record<string, unknown>> = {}

  protected override async load(): Promise<Record<string, unknown>> {
    return { ...this.document }
  }

  protected override async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.document[ns] = { ...section }
  }
}

/** Recorded RPC channel registration (host connection double). */
interface RecordedChannel {
  channel: string
  handler: (endpoint: string, payload: unknown) => Promise<unknown>
}

/** Minimal Host connection service recording rpc.handle registrations. */
class MemoryConnection extends Service {
  readonly channels: RecordedChannel[] = []

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get rpc(): {
    handle: (channel: string, handler: RecordedChannel['handler']) => () => Promise<void>
  } {
    const owner = this
    return {
      handle: (channel, handler) => {
        const record = { channel, handler }
        owner.channels.push(record)
        return async () => {
          const index = owner.channels.indexOf(record)
          if (index >= 0) owner.channels.splice(index, 1)
        }
      },
    }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllGlobals()
})

function stubFetch(): void {
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/models')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: [
          { id: 'glm-4.5' }, { id: 'glm-4.6' }, { id: 'glm-5' },
          { id: 'glm-5.3' }, { id: 'glm-5.3-flash' },
        ],
      })))
    }
    return Promise.resolve(new Response('', { status: 500 }))
  })
}

/** Mount the plugin over llm + credentials (+ optional settings/connection). */
async function mount(options: {
  settings?: typeof MemorySettings
  connection?: typeof MemoryConnection
  config?: Record<string, unknown>
}): Promise<void> {
  stubFetch()
  context = new Context()
  await context.plugin(LlmRuntime)
  await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'coding-key', ZHIPU_API_KEY: 'paas-key' })
  if (options.settings !== undefined) await context.plugin(options.settings)
  if (options.connection !== undefined) await context.plugin(options.connection)
  await context.plugin(ZhipuToolkit, options.config ?? {})
  // Let the plugin's injected fibers (settings install, RPC channel) settle.
  await new Promise(resolve => { setTimeout(resolve, 30) })
}

describe('settings namespace + RPC bridge integration', () => {
  it('installs the zhipu-toolkit namespace and re-resolves routes on writes', async () => {
    await mount({ settings: MemorySettings, config: { endpoints: 'coding' } })
    const ctx = context!

    // The namespace resolves the composition entry as its base layer.
    const section = ctx.settings.get(SETTINGS_NAMESPACE) as Record<string, unknown>
    expect(section.endpoints).toBe('coding')
    expect(section.displayName).toBe('BigModel')

    // A user-layer write lands in the document and re-resolves the value.
    await ctx.settings.update(SETTINGS_NAMESPACE, { endpoints: 'paas' })
    expect(ctx.settings.get(SETTINGS_NAMESPACE)).toMatchObject({ endpoints: 'paas' })
    // The route set follows: zai drops, zhipu serves.
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders()).toEqual([{ id: 'zhipu', name: 'BigModel' }])
    })
  })

  it('refuses an unserviceable write at write time', async () => {
    await mount({ settings: MemorySettings })
    const ctx = context!

    await expect(ctx.settings.update(SETTINGS_NAMESPACE, { codingApiKeyEnv: '' }))
      .rejects.toThrow('codingApiKeyEnv must not be empty')
    // The last good value stays.
    expect(ctx.settings.get(SETTINGS_NAMESPACE)).toMatchObject({ codingApiKeyEnv: 'BIGMODEL_API_KEY' })
  })

  it('registers the settings RPC channel once a connection service exists', async () => {
    await mount({ settings: MemorySettings, connection: MemoryConnection })
    const ctx = context!

    const connection = ctx.get('connection') as unknown as MemoryConnection
    const registered = connection.channels.find(entry => entry.channel === SETTINGS_CHANNEL)
    expect(registered).toBeDefined()
    if (registered === undefined) return

    // get: the bridge serves the resolved section.
    const initial = await registered.handler('get', {}) as { ok: boolean, value: { value: Record<string, unknown> } }
    expect(initial.ok).toBe(true)
    expect(initial.value.value.defaultReasoningTier).toBe('low')

    // mutate: a whitelisted write lands and the next view reflects it.
    const written = await registered.handler('mutate', {
      ops: [{ op: 'set', path: ['defaultReasoningTier'], value: 'high' }],
    }) as { ok: boolean, value: { value: Record<string, unknown> } }
    expect(written.ok).toBe(true)
    expect(written.value.value.defaultReasoningTier).toBe('high')
    expect(ctx.settings.get(SETTINGS_NAMESPACE)).toMatchObject({ defaultReasoningTier: 'high' })

    // A non-whitelisted field is refused without touching the document.
    const refused = await registered.handler('mutate', {
      ops: [{ op: 'set', path: ['streamIdleTimeoutMs'], value: 1 }],
    }) as { ok: boolean, error: { code: string } }
    expect(refused.ok).toBe(false)
    expect(refused.error.code).toBe('bad-field')
    expect(ctx.settings.get(SETTINGS_NAMESPACE)).toMatchObject({ defaultReasoningTier: 'high' })
  })

  it('serves the local-key endpoints against the real credentials service', async () => {
    await mount({ settings: MemorySettings, connection: MemoryConnection })
    const ctx = context!

    const connection = ctx.get('connection') as unknown as MemoryConnection
    const registered = connection.channels.find(entry => entry.channel === SETTINGS_CHANNEL)
    expect(registered).toBeDefined()
    if (registered === undefined) return

    // The key is unconfigured before the card writes it.
    const before = await registered.handler('local-key', {}) as { ok: boolean, value: { configured: boolean, writable: boolean, masked: string } }
    expect(before).toEqual({ ok: true, value: { configured: false, writable: true, masked: '' } })

    // The card writes the key: it lands in the credentials service only,
    // and the masked summary exposes just the tail.
    const written = await registered.handler('set-local-key', { value: 'card-key' }) as { ok: boolean, value: { configured: boolean, writable: boolean, masked: string } }
    expect(written).toEqual({ ok: true, value: { configured: true, writable: true, masked: '••••••••-key' } })

    // Overwriting in place (the edit flow) updates the store without any
    // unset step in between.
    const overwritten = await registered.handler('set-local-key', { value: 'rotated-key' }) as { ok: boolean, value: { configured: boolean, masked: string } }
    expect(overwritten).toEqual({ ok: true, value: { configured: true, writable: true, masked: '••••••••-key' } })
    const settings = ctx.settings as unknown as MemorySettings
    expect(settings.document[SETTINGS_NAMESPACE]).toBeUndefined()

    // The route resolves the local key once the mode is on.
    await ctx.settings.update(SETTINGS_NAMESPACE, { useLocalApiKey: true })
    await vi.waitFor(async () => {
      const models = await ctx.llm.listModels('zai')
      expect(models.map(model => model.id)).toEqual([
        'glm-4.5', 'glm-4.6', 'glm-5', 'glm-5.3', 'glm-5.3-flash',
      ])
    })
  })
})
