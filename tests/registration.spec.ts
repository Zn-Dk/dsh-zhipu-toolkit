import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as ZhipuToolkit from '../src/index.ts'

let context: Context | undefined

/**
 * In-memory read-write credentials provider: env-ref resolution plus a
 * writable reference store, so the local-key path can be exercised too.
 */
class TestCredentials extends CredentialProvider {
  private readonly stored = new Map<string, string>()

  constructor(ctx: Context, private readonly values: Readonly<Record<string, string>>) {
    super(ctx)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.stored.get(ref) ?? this.values[ref]
    return Promise.resolve(value === undefined
      ? undefined
      : { value, source: this.stored.has(ref) ? 'store' : 'test' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.stored.has(ref) || this.values[ref] !== undefined, source: 'test', writable: true })
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    this.stored.set(ref, value)
    // Real providers fan the reference-updated event out after the write
    // commits; mirror that so listeners (the plugin's refresh) react.
    this.notifyUpdated(ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    this.stored.delete(ref)
    this.notifyUpdated(ref)
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('test credentials hold no records'))
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.reject(new Error('test credentials hold no records'))
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllGlobals()
})

const LIVE_RESPONSE = {
  data: [
    { id: 'glm-4.5' },
    { id: 'glm-4.5-air' },
    { id: 'glm-4.6' },
    { id: 'glm-4.7' },
    { id: 'glm-5' },
    { id: 'glm-5-turbo' },
    { id: 'glm-5.1' },
    { id: 'glm-5.2' },
    { id: 'glm-5.3' },
    { id: 'glm-5.3-flash' },
    { id: 'glm-5v-turbo' },
    { id: 'embedding-3' },
  ],
}

const LIVE_IDS = [
  'glm-4.5-air',
  'glm-4.7',
  'glm-5-turbo',
  'glm-5.1',
  'glm-5.2',
  'glm-5v-turbo',
  'glm-4.5',
  'glm-4.6',
  'glm-5',
  'glm-5.3',
  'glm-5.3-flash',
]

function stubFetch(requests: Array<{ authorization: string | null, url: string }>): void {
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({ authorization: new Headers(init?.headers).get('authorization'), url })
    if (url.endsWith('/models')) {
      return Promise.resolve(new Response(JSON.stringify(LIVE_RESPONSE)))
    }
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      '{"choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}',
      '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      '[DONE]',
    ]
    return Promise.resolve(new Response(events.map(event => `data: ${event}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    }))
  })
}

describe('single-endpoint registration', () => {
  it('registers the coding route with its own label and key ref by default', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, {
      BIGMODEL_API_KEY: 'coding-key',
      ZHIPU_API_KEY: 'paas-key',
    })
    await context.plugin(ZhipuToolkit, {})

    expect(context.llm.listProviders()).toEqual([
      { id: 'zai', name: 'BigModel' },
    ])
    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    expect(requests).toEqual([
      {
        authorization: 'Bearer coding-key',
        url: 'https://open.bigmodel.cn/api/coding/paas/v4/models',
      },
    ])
  })

  it('registers only the paas route with its own label and key ref', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { ZHIPU_API_KEY: 'paas-key' })
    await context.plugin(ZhipuToolkit, { endpoints: 'paas' })

    expect(context.llm.listProviders()).toEqual([{ id: 'zhipu', name: 'BigModel' }])
    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zhipu')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    expect(requests.map(request => request.url)).toEqual([
      'https://open.bigmodel.cn/api/paas/v4/models',
    ])
  })

  it('uses the configured display name', async () => {
    stubFetch([])
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'coding-key' })
    await context.plugin(ZhipuToolkit, { endpoints: 'coding', displayName: 'GLM Coding' })

    expect(context.llm.listProviders()).toEqual([{ id: 'zai', name: 'GLM Coding' }])
  })

  it('streams through the coding route with per-route credential and wire shape', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'coding-key' })
    await context.plugin(ZhipuToolkit, { endpoints: 'coding' })

    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    const assembler = new BlockAssembler()
    for await (const chunk of context.llm.stream({
      provider: 'zai',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })) assembler.push(chunk)
    expect(assembler.message({ kind: 'model', provider: 'zai', model: 'glm-5.3-flash' }).content)
      .toEqual([{ type: 'text', text: 'hello' }])
    expect(requests.slice(-1)).toEqual([{
      authorization: 'Bearer coding-key',
      url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    }])
  })

  it('keeps the maintained catalog when the live refresh fails', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'coding-key' })
    await context.plugin(ZhipuToolkit, {})

    expect(context.llm.listProviders()).toEqual([
      { id: 'zai', name: 'BigModel' },
    ])
    // The maintained fallback catalog is the full merged list (11 entries:
    // the 6 builtin ids plus the 5 maintained additions).
    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
  })
})

describe('local API key mode', () => {
  it('resolves the key from the local reference when useLocalApiKey is on', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'env-key' })
    // The card writes the local key through the credentials service.
    await context.credentials.set(credentialRef('ZHIPU_TOOLKIT_API_KEY'), 'local-key')
    await context.plugin(ZhipuToolkit, { useLocalApiKey: true })

    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    expect(requests[0]).toEqual({
      authorization: 'Bearer local-key',
      url: 'https://open.bigmodel.cn/api/coding/paas/v4/models',
    })
  })

  it('falls back to the env reference when the local key is unset', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, { BIGMODEL_API_KEY: 'env-key' })
    await context.plugin(ZhipuToolkit, { useLocalApiKey: true })

    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    expect(requests[0]?.authorization).toBe('Bearer env-key')
  })

  it('refreshes when the local key is written after registration', async () => {
    const requests: Array<{ authorization: string | null, url: string }> = []
    stubFetch(requests)
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(TestCredentials, {})
    await context.plugin(ZhipuToolkit, { useLocalApiKey: true })

    // Initially no key at all: the refresh fails, the maintained catalog serves.
    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })
    // The card writes the local key through the credentials service; the
    // reference-updated event re-runs the live refresh with the new key.
    await context.credentials.set(credentialRef('ZHIPU_TOOLKIT_API_KEY'), 'late-key')
    await vi.waitFor(() => {
      expect(requests.some(request => request.authorization === 'Bearer late-key'
        && request.url === 'https://open.bigmodel.cn/api/coding/paas/v4/models')).toBe(true)
    })
  })
})
