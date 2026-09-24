import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as ZhipuToolkit from '../src/index.ts'
import { SETTINGS_NAMESPACE } from '../src/index.ts'

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

/** Mount the plugin over llm + credentials (+ optional settings). */
async function mount(options: {
  settings?: typeof MemorySettings
  config?: Record<string, unknown>
}): Promise<void> {
  stubFetch()
  context = new Context()
  await context.plugin(LlmRuntime)
  await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'coding-key', ZHIPU_API_KEY: 'paas-key' })
  if (options.settings !== undefined) await context.plugin(options.settings)
  await context.plugin(ZhipuToolkit, options.config ?? {})
  // Let the plugin's injected fibers (settings install) settle.
  await new Promise(resolve => { setTimeout(resolve, 30) })
}

describe('settings namespace integration', () => {
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
})
