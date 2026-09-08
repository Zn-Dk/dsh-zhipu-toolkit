import { describe, expect, it } from 'vitest'
import {
  appendMissing,
  DIRECTLY_VERIFIED,
  discoverModels,
  GLM53_THINKING_LEVEL_MAP,
  GLM_COMPAT,
  MAINTAINED_TEXT_MODELS,
  maintainedModels,
  parseModelIds,
  textModel,
} from '../src/catalog.ts'
import { GLM53_WIRE_MAP, OFFERED_PICKER_TIERS, WIRE_TIER_WHITELIST } from '../src/invariant.ts'

describe('maintained GLM family descriptors', () => {
  it('covers the full ten-model chat family with verified capacities', () => {
    expect(MAINTAINED_TEXT_MODELS.map(model => model.id)).toEqual([
      'glm-4.5',
      'glm-4.5-air',
      'glm-4.6',
      'glm-4.7',
      'glm-5',
      'glm-5-turbo',
      'glm-5.1',
      'glm-5.2',
      'glm-5.3',
      'glm-5.3-flash',
    ])
    const byId = new Map(MAINTAINED_TEXT_MODELS.map(model => [model.id, model]))
    expect(byId.get('glm-4.5')).toMatchObject({ contextWindow: 131_072, maxTokens: 98_304 })
    expect(byId.get('glm-4.5-air')).toMatchObject({ contextWindow: 131_072, maxTokens: 98_304 })
    expect(byId.get('glm-4.6')).toMatchObject({ contextWindow: 204_800, maxTokens: 131_072 })
    expect(byId.get('glm-4.7')).toMatchObject({ contextWindow: 204_800, maxTokens: 131_072 })
    expect(byId.get('glm-5')).toMatchObject({ contextWindow: 200_000, maxTokens: 131_072 })
    expect(byId.get('glm-5-turbo')).toMatchObject({ contextWindow: 200_000, maxTokens: 131_072 })
    expect(byId.get('glm-5.1')).toMatchObject({ contextWindow: 200_000, maxTokens: 131_072 })
    expect(byId.get('glm-5.2')).toMatchObject({ contextWindow: 1_000_000, maxTokens: 131_072 })
    expect(byId.get('glm-5.3')).toMatchObject({ contextWindow: 1_000_000, maxTokens: 131_072 })
    expect(byId.get('glm-5.3-flash')).toMatchObject({ contextWindow: 1_000_000, maxTokens: 131_072 })
  })

  it('only the GLM-5.3 series carries the verified thinking level map', () => {
    for (const model of MAINTAINED_TEXT_MODELS) {
      const mapped = model.id === 'glm-5.3' || model.id === 'glm-5.3-flash'
      expect(model.thinkingLevelMap === undefined, model.id).toBe(!mapped)
    }
  })

  it('glm-5.3-flash is the native multimodal entry: text + image input', () => {
    // Official GLM-5.3-Flash docs: input = video, image, text, file (multi
    // image_url parts, URL or Base64). pi-ai's Model["input"] type only knows
    // "text" | "image" today, so image is enabled and video/file stay pending.
    const flash = maintainedModels.find(model => model.id === 'glm-5.3-flash')
    expect(flash?.input).toEqual(['text', 'image'])
    // appendMissing's spread overlay carries the override past pi-ai's
    // builtin entry; every other MAINTAINED model stays text-only (the
    // builtin pi-ai catalog may keep its own multimodal entries like
    // glm-5v-turbo — those are not ours to assert).
    const textOnly = maintainedModels.find(model => model.id === 'glm-5.3')
    expect(textOnly?.input).toEqual(['text'])
    const maintainedIds = new Set(MAINTAINED_TEXT_MODELS.map(model => model.id))
    for (const model of maintainedModels) {
      if (!maintainedIds.has(model.id) || model.id === 'glm-5.3-flash') continue
      expect(model.input, model.id).toEqual(['text'])
    }
  })

  it('pins the exact GLM-5.3 thinking level map from the d8189e3 fix', () => {
    expect(GLM53_THINKING_LEVEL_MAP).toEqual({
      off: null,
      minimal: null,
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
  })

  it('pins the exact compat flags from the d8189e3 fix', () => {
    expect(GLM_COMPAT).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'zai',
      zaiToolStream: true,
    })
  })

  it('materializes a complete maintained glm-5.3 descriptor', () => {
    const glm53 = maintainedModels.find(model => model.id === 'glm-5.3')
    expect(glm53).toEqual({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      api: 'openai-completions',
      provider: 'zai',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      reasoning: true,
      thinkingLevelMap: GLM53_THINKING_LEVEL_MAP,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: GLM_COMPAT,
      contextWindow: 1_000_000,
      maxTokens: 131_072,
    })
  })

  it('includes every maintained id in the merged catalog', () => {
    const ids = new Set(maintainedModels.map(model => model.id))
    for (const model of MAINTAINED_TEXT_MODELS) {
      expect(ids.has(model.id), model.id).toBe(true)
    }
  })
})

describe('appendMissing override semantics', () => {
  it('a mapped descriptor supersedes the stale builtin entry for the same id', () => {
    const stale = textModel('glm-5.3', 'GLM-5.3', 128_000, 32_768)
    const mapped = textModel('glm-5.3', 'GLM-5.3', 1_000_000, 131_072, GLM53_THINKING_LEVEL_MAP)
    const merged = appendMissing([stale], [mapped])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(mapped)
  })

  it('a map-less descriptor never replaces an existing entry', () => {
    const existing = textModel('glm-4.5', 'GLM-4.5', 131_072, 98_304)
    const newer = textModel('glm-4.5', 'GLM-4.5-renamed', 999_999, 999_999)
    const merged = appendMissing([existing], [newer])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(existing)
  })

  it('a map-less descriptor fills a missing id, and a mapped descriptor appends one', () => {
    const glm45 = textModel('glm-4.5', 'GLM-4.5', 131_072, 98_304)
    const glm46 = textModel('glm-4.6', 'GLM-4.6', 204_800, 131_072)
    const glm53 = textModel('glm-5.3', 'GLM-5.3', 1_000_000, 131_072, GLM53_THINKING_LEVEL_MAP)
    const merged = appendMissing([glm45], [glm46, glm53])
    expect(merged.map(model => model.id)).toEqual(['glm-4.5', 'glm-4.6', 'glm-5.3'])
    expect(merged[2]).toEqual(glm53)
  })

  it('the merged glm-5.2 keeps the builtin thinking map (upstream already correct)', () => {
    const glm52 = maintainedModels.find(model => model.id === 'glm-5.2')
    expect(glm52?.thinkingLevelMap).toEqual({
      minimal: null,
      low: 'high',
      medium: 'high',
      high: 'high',
      max: 'max',
    })
  })
})

describe('parseModelIds', () => {
  it('returns ids in provider order', () => {
    expect(parseModelIds({ data: [{ id: 'glm-5.2' }, { id: 'glm-5.3' }] })).toEqual(['glm-5.2', 'glm-5.3'])
  })

  it('rejects payloads without a data array', () => {
    expect(() => parseModelIds([])).toThrow(/data array/)
    expect(() => parseModelIds({ data: 'nope' })).toThrow(/data array/)
    expect(() => parseModelIds(null)).toThrow(/data array/)
  })

  it('rejects entries without a string id', () => {
    expect(() => parseModelIds({ data: [{ id: 42 }] })).toThrow(/string id/)
    expect(() => parseModelIds({ data: [{}] })).toThrow(/string id/)
  })
})

describe('discoverModels', () => {
  it('filters to the live list while retaining directly verified models', () => {
    const models = discoverModels({ data: [{ id: 'glm-5.2' }] })
    // builtin glm-5.2 keeps its insertion slot; glm-5.3 and glm-5.3-flash are
    // appended by the maintained overlay and survive via DIRECTLY_VERIFIED.
    expect(models.map(model => model.id)).toEqual(['glm-5.2', 'glm-5.3', 'glm-5.3-flash'])
    expect(DIRECTLY_VERIFIED).toEqual(new Set(['glm-5.3', 'glm-5.3-flash']))
  })

  it('returns the full intersection when the endpoint reports everything', () => {
    const models = discoverModels({
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
    })
    // appendMissing keeps the builtin catalog's insertion order first, then
    // appends the maintained descriptors the builtin catalog lacks.
    expect(models.map(model => model.id)).toEqual([
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
    ])
  })

  it('keeps directly verified models even when the endpoint reports nothing maintained', () => {
    const models = discoverModels({ data: [{ id: 'embedding-3' }] })
    expect(models.map(model => model.id)).toEqual(['glm-5.3', 'glm-5.3-flash'])
  })
})

describe('invariant exports', () => {
  it('offers exactly the four non-disablable picker tiers', () => {
    expect(OFFERED_PICKER_TIERS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('maps every offered tier into the verified wire whitelist', () => {
    expect(GLM53_WIRE_MAP).toEqual({
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
    for (const wire of Object.values(GLM53_WIRE_MAP)) {
      expect(WIRE_TIER_WHITELIST.has(wire), wire).toBe(true)
    }
  })

  it('whitelists exactly the wire values the API accepts', () => {
    expect([...WIRE_TIER_WHITELIST].sort()).toEqual(['high', 'low', 'max', 'medium'])
  })
})
