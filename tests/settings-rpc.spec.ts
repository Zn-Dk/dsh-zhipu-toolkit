import { describe, expect, it } from 'vitest'
import {
  createSettingsRpcHandler,
  MUTABLE_FIELDS,
  type CredentialsFace,
  type SettingsProviderFace,
} from '../src/settings-rpc.ts'

/** In-memory provider double: resolved value + revision over one user section. */
function fakeProvider(initial: Record<string, unknown> = {}): SettingsProviderFace & {
  section: Record<string, unknown>
  revision: number
} {
  const state = {
    section: { ...initial },
    revision: 0,
  }
  const resolved = (): Record<string, unknown> => ({
    endpoints: 'coding',
    codingApiKeyEnv: 'BIGMODEL_API_KEY',
    paasApiKeyEnv: 'ZHIPU_API_KEY',
    codingBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    paasBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
    displayName: 'BigModel',
    defaultReasoningTier: 'low',
    useLocalApiKey: false,
    ...Object.fromEntries(Object.entries(state.section).filter(([, v]) => v !== undefined)),
  })
  return {
    section: state.section,
    get revision() { return state.revision },
    get: () => resolved(),
    get writable() { return true },
    describe: () => [{ ns: 'zhipu-toolkit', value: resolved(), revision: state.revision }],
    mutate: async (ns: string, ops: readonly Array<{ op: 'set' | 'unset', path: readonly string[], value?: unknown }>, expectedRevision?: number) => {
      if (ns !== 'zhipu-toolkit') throw new Error(`settings namespace "${ns}" is not registered`)
      if (expectedRevision !== undefined && expectedRevision !== state.revision) {
        throw new Error(`settings namespace "zhipu-toolkit" changed since it was read (expected revision ${String(expectedRevision)}, now ${String(state.revision)})`)
      }
      for (const op of ops) {
        const key = op.path[0]
        if (key === undefined) continue
        if (op.op === 'set') state.section[key] = op.value
        else delete state.section[key]
      }
      state.revision += 1
    },
  }
}

/** In-memory credentials double over the local-key reference. */
function fakeCredentials(): CredentialsFace & {
  stored: Map<string, string>
  describeCalls: string[]
} {
  const stored = new Map<string, string>()
  const describeCalls: string[] = []
  return {
    stored,
    describeCalls,
    describe: async (ref: string) => {
      describeCalls.push(ref)
      return { configured: stored.has(ref), writable: true }
    },
    set: async (ref: string, value: string) => { stored.set(ref, value) },
    unset: async (ref: string) => { stored.delete(ref) },
    masked: async (ref: string) => {
      const value = stored.get(ref)
      return value === undefined ? undefined : '••••••••' + value.slice(-4)
    },
  }
}

describe('settings RPC bridge', () => {
  it('serves the resolved section and its revision on get', async () => {
    const provider = fakeProvider({ displayName: 'Zhipu' })
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('get', {})
    expect(outcome).toEqual({
      ok: true,
      value: {
        value: expect.objectContaining({ displayName: 'Zhipu', defaultReasoningTier: 'low' }),
        revision: 0,
      },
    })
  })

  it('writes whitelisted fields through mutate and echoes the next view', async () => {
    const provider = fakeProvider()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', {
      ops: [{ op: 'set', path: ['defaultReasoningTier'], value: 'high' }],
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect((outcome.value as { value: { defaultReasoningTier: string } }).value.defaultReasoningTier).toBe('high')
      expect((outcome.value as { revision: number }).revision).toBe(1)
    }
  })

  it('unsets a field back to its inherited default', async () => {
    const provider = fakeProvider({ displayName: 'Zhipu' })
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', { ops: [{ op: 'unset', path: ['displayName'] }] })
    expect(outcome.ok).toBe(true)
    expect(provider.get('zhipu-toolkit')).toMatchObject({ displayName: 'BigModel' })
  })

  it('refuses a field outside the whitelist', async () => {
    const provider = fakeProvider()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', {
      ops: [{ op: 'set', path: ['streamIdleTimeoutMs'], value: 1 }],
    })
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'bad-field', message: 'unsupported field: streamIdleTimeoutMs' },
    })
  })

  it('refuses nested paths, unknown ops, and non-array ops', async () => {
    const provider = fakeProvider()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    expect((await handler('mutate', { ops: [{ op: 'set', path: ['a', 'b'], value: 1 }] })).ok).toBe(false)
    expect((await handler('mutate', { ops: [{ op: 'delete', path: ['displayName'] }] })).ok).toBe(false)
    expect((await handler('mutate', { ops: 'nope' })).ok).toBe(false)
  })

  it('refuses writes when the document is read-only', async () => {
    const provider: SettingsProviderFace = {
      get: () => ({}),
      get writable() { return false },
      describe: () => [],
      mutate: async () => {},
    }
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', { ops: [{ op: 'set', path: ['displayName'], value: 'x' }] })
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'read-only', message: 'the settings document is read-only in this deployment' },
    })
  })

  it('maps a conflict failure onto the settings-conflict code', async () => {
    const provider = fakeProvider()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', {
      ops: [{ op: 'set', path: ['displayName'], value: 'x' }],
      expectedRevision: 41,
    })
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: 'settings-conflict',
        message: expect.stringContaining('changed since it was read'),
      },
    })
  })

  it('rejects unknown endpoints', async () => {
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit')
    expect((await handler('describe', {})).ok).toBe(false)
    expect((await handler('get', {})).ok).toBe(true)
  })

  it('covers exactly the card-editable fields', () => {
    expect([...MUTABLE_FIELDS]).toEqual([
      'endpoints',
      'codingApiKeyEnv',
      'paasApiKeyEnv',
      'codingBaseURL',
      'paasBaseURL',
      'displayName',
      'defaultReasoningTier',
      'useLocalApiKey',
    ])
  })

  it('reports a non-Error failure value through settings-rejected', async () => {
    const provider: SettingsProviderFace = {
      get: () => ({}),
      get writable() { return true },
      describe: () => [],
      mutate: async () => { throw 'plain string failure' },
    }
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', { ops: [{ op: 'set', path: ['displayName'], value: 'x' }] })
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'settings-rejected', message: 'plain string failure' },
    })
  })

  it('falls back to provider.get when the descriptor is absent', async () => {
    const provider: SettingsProviderFace = {
      get: () => ({ displayName: 'FromGet' }),
      get writable() { return true },
      describe: () => [],
      mutate: async () => {},
    }
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('get', {})
    expect(outcome.ok && (outcome.value as { value: { displayName: string } }).value.displayName).toBe('FromGet')
  })

  it('treats a missing payload as an empty mutate', async () => {
    const provider = fakeProvider()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit')
    const outcome = await handler('mutate', undefined)
    expect(outcome.ok).toBe(true)
    expect(provider.revision).toBe(1)
  })
})

describe('local API key endpoints', () => {
  it('serves the configured state of the local key reference', async () => {
    const credentials = fakeCredentials()
    credentials.stored.set('ZHIPU_TOOLKIT_API_KEY', 'a-key')
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', credentials)
    const outcome = await handler('local-key', {})
    expect(outcome).toEqual({ ok: true, value: { configured: true, writable: true, masked: '••••••••-key' } })
    expect(credentials.describeCalls).toEqual(['ZHIPU_TOOLKIT_API_KEY'])
  })

  it('writes the key into the credentials reference and never into the section', async () => {
    const provider = fakeProvider()
    const credentials = fakeCredentials()
    const handler = createSettingsRpcHandler(provider, 'zhipu-toolkit', credentials)
    const outcome = await handler('set-local-key', { value: 'a-secret' })
    expect(outcome).toEqual({ ok: true, value: { configured: true, writable: true, masked: '••••••••cret' } })
    expect(credentials.stored.get('ZHIPU_TOOLKIT_API_KEY')).toBe('a-secret')
    // The settings document is untouched by a local-key write.
    expect(provider.section).toEqual({})
  })

  it('refuses an empty or non-string local key value', async () => {
    const credentials = fakeCredentials()
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', credentials)
    expect(await handler('set-local-key', { value: '' })).toEqual({
      ok: false,
      error: { code: 'bad-value', message: 'the local API key must be a non-empty string' },
    })
    expect(await handler('set-local-key', { value: 42 })).toEqual({
      ok: false,
      error: { code: 'bad-value', message: 'the local API key must be a non-empty string' },
    })
    expect(credentials.stored.size).toBe(0)
  })

  it('unsets the local key and reports the new state', async () => {
    const credentials = fakeCredentials()
    credentials.stored.set('ZHIPU_TOOLKIT_API_KEY', 'a-key')
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', credentials)
    const outcome = await handler('unset-local-key', {})
    expect(outcome).toEqual({ ok: true, value: { configured: false, writable: true, masked: '' } })
    expect(credentials.stored.has('ZHIPU_TOOLKIT_API_KEY')).toBe(false)
  })

  it('addresses a custom local key reference when constructed with one', async () => {
    const credentials = fakeCredentials()
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', credentials, 'OTHER_REF')
    await handler('set-local-key', { value: 'x' })
    expect(credentials.stored.get('OTHER_REF')).toBe('x')
    expect(credentials.stored.has('ZHIPU_TOOLKIT_API_KEY')).toBe(false)
  })

  it('reports no-credentials failures when no credentials face was wired', async () => {
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', undefined)
    expect(await handler('set-local-key', { value: 'x' })).toEqual({
      ok: false,
      error: { code: 'no-credentials', message: 'no credentials service is available in this deployment' },
    })
    expect(await handler('local-key', {})).toEqual({
      ok: true,
      value: { configured: false, writable: false, masked: '' },
    })
  })

  it('maps a credentials failure through settings-rejected', async () => {
    const credentials: CredentialsFace = {
      set: async () => { throw new Error('the store is sealed') },
      unset: async () => {},
      describe: async () => ({ configured: false, writable: false }),
      masked: async () => undefined,
    }
    const handler = createSettingsRpcHandler(fakeProvider(), 'zhipu-toolkit', credentials)
    const outcome = await handler('set-local-key', { value: 'x' })
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'settings-rejected', message: 'the store is sealed' },
    })
  })
})
