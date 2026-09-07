import { describe, expect, it } from 'vitest'
import { Config, LOCAL_API_KEY_REF, resolveConfig } from '../src/config.ts'

describe('Config schema defaults', () => {
  it('resolves every field to the verified defaults', () => {
    expect(Config({})).toEqual({
      endpoints: 'coding',
      codingApiKeyEnv: 'BIGMODEL_API_KEY',
      paasApiKeyEnv: 'ZHIPU_API_KEY',
      codingBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
      paasBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
      displayName: 'BigModel',
      defaultReasoningTier: 'low',
      useLocalApiKey: false,
      streamIdleTimeoutMs: 300_000,
      maxRequestImageBytes: 20_971_520,
      requestImagePixelBudget: 4_194_304,
      requestImageMaxBytes: 1_048_576,
    })
  })

  it('keeps explicit overrides', () => {
    expect(Config({ endpoints: 'paas', displayName: 'Zhipu' })).toMatchObject({
      endpoints: 'paas',
      displayName: 'Zhipu',
    })
  })

  it('exposes the local API key reference name', () => {
    expect(LOCAL_API_KEY_REF).toBe('ZHIPU_TOOLKIT_API_KEY')
  })

  it('accepts each offered reasoning tier and rejects an unknown one', () => {
    for (const tier of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(Config({ defaultReasoningTier: tier })).toMatchObject({ defaultReasoningTier: tier })
    }
    expect(() => Config({ defaultReasoningTier: 'off' })).toThrow()
  })

  it('rejects the removed both endpoint mode', () => {
    expect(() => Config({ endpoints: 'both' })).toThrow()
  })

  it('defaults useLocalApiKey to off and accepts an explicit on', () => {
    expect(Config({}).useLocalApiKey).toBe(false)
    expect(Config({ useLocalApiKey: true }).useLocalApiKey).toBe(true)
  })
})

describe('resolveConfig endpoint selection', () => {
  it('registers only the coding route by default', () => {
    expect(resolveConfig({}).endpoints).toEqual([
      {
        provider: 'zai',
        apiKeyEnv: 'BIGMODEL_API_KEY',
        baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        displayName: 'BigModel',
      },
    ])
  })

  it('registers only the paas route when endpoints is paas', () => {
    expect(resolveConfig({ endpoints: 'paas' }).endpoints).toEqual([
      {
        provider: 'zhipu',
        apiKeyEnv: 'ZHIPU_API_KEY',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        displayName: 'BigModel',
      },
    ])
  })

  it('uses the single configured display name for the served route', () => {
    expect(resolveConfig({ endpoints: 'coding', displayName: 'GLM' }).endpoints
      .map(endpoint => endpoint.displayName)).toEqual(['GLM'])
    expect(resolveConfig({ endpoints: 'paas', displayName: 'GLM' }).endpoints
      .map(endpoint => endpoint.displayName)).toEqual(['GLM'])
  })

  it('configures the credential reference of the served route', () => {
    const resolved = resolveConfig({ endpoints: 'paas', paasApiKeyEnv: 'MY_PAAS_KEY' })
    expect(resolved.endpoints.map(endpoint => endpoint.apiKeyEnv)).toEqual(['MY_PAAS_KEY'])
    expect(resolveConfig({ endpoints: 'coding', codingApiKeyEnv: 'MY_CODING_KEY' }).endpoints
      .map(endpoint => endpoint.apiKeyEnv)).toEqual(['MY_CODING_KEY'])
  })

  it('overrides each base URL independently and strips trailing slashes', () => {
    const resolved = resolveConfig({
      endpoints: 'coding',
      codingBaseURL: 'https://proxy.example.com/coding/',
    })
    expect(resolved.endpoints.map(endpoint => endpoint.baseURL)).toEqual([
      'https://proxy.example.com/coding',
    ])
    expect(resolveConfig({ endpoints: 'paas', paasBaseURL: 'https://proxy.example.com/open/' }).endpoints
      .map(endpoint => endpoint.baseURL)).toEqual(['https://proxy.example.com/open'])
  })

  it('carries useLocalApiKey through to the resolved config', () => {
    expect(resolveConfig({}).useLocalApiKey).toBe(false)
    expect(resolveConfig({ useLocalApiKey: true }).useLocalApiKey).toBe(true)
  })
})

describe('resolveConfig validation branches', () => {
  it('rejects an empty displayName', () => {
    expect(() => resolveConfig({ displayName: '' })).toThrow('displayName must not be empty')
  })

  it('rejects an empty credential reference', () => {
    expect(() => resolveConfig({ codingApiKeyEnv: '' })).toThrow('codingApiKeyEnv must not be empty')
    expect(() => resolveConfig({ endpoints: 'paas', paasApiKeyEnv: '' })).toThrow('paasApiKeyEnv must not be empty')
  })

  it('rejects an empty base URL after slash stripping', () => {
    expect(() => resolveConfig({ codingBaseURL: '///' })).toThrow('codingBaseURL must not be empty')
    expect(() => resolveConfig({ endpoints: 'paas', paasBaseURL: '/' })).toThrow('paasBaseURL must not be empty')
  })

  it('rejects a non-positive or oversized stream idle timeout', () => {
    expect(() => resolveConfig({ streamIdleTimeoutMs: 0 })).toThrow(/streamIdleTimeoutMs/)
    expect(() => resolveConfig({ streamIdleTimeoutMs: -1 })).toThrow(/streamIdleTimeoutMs/)
    expect(() => resolveConfig({ streamIdleTimeoutMs: Number.POSITIVE_INFINITY })).toThrow(/streamIdleTimeoutMs/)
    expect(() => resolveConfig({ streamIdleTimeoutMs: 2_147_483_648 })).toThrow(/streamIdleTimeoutMs/)
  })

  it('rejects non-positive-safe-integer image bounds', () => {
    expect(() => resolveConfig({ maxRequestImageBytes: 0 })).toThrow('maxRequestImageBytes must be a positive safe integer')
    expect(() => resolveConfig({ requestImagePixelBudget: 1.5 })).toThrow('requestImagePixelBudget must be a positive safe integer')
    expect(() => resolveConfig({ requestImageMaxBytes: -1 })).toThrow('requestImageMaxBytes must be a positive safe integer')
  })
})
