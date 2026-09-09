// Simulated host load of the built lib/ artifacts (run with plain `node`).
// Mirrors the dsh plugin loader's essential steps: import the host half from
// lib/index.js, check the plugin shape + catalog, and load the client bundle
// through a __ModuleLoader__ double with the 7-word seed whitelist.
import assert from 'node:assert/strict'

// ---- Host half -----------------------------------------------------------
const plugin = await import('../lib/index.js')

assert.equal(plugin.name, 'dsh-zhipu-toolkit')
assert.deepEqual(plugin.inject, ['llm', 'credentials'])
assert.equal(plugin.SETTINGS_NAMESPACE, 'zhipu-toolkit')
assert.equal(plugin.SETTINGS_CHANNEL, '/zhipu-toolkit-settings')
assert.equal(plugin.DEFAULT_REASONING_TIER, 'low')
assert.equal(plugin.REASONING_TIERS.length, 5)
assert.equal(plugin.REASONING_TIERS[0], 'low')
assert.equal(typeof plugin.apply, 'function')
assert.equal(plugin.LOCAL_API_KEY_REF, 'ZHIPU_TOOLKIT_API_KEY')

// Catalog: the 10 maintained ids + builtin extras merged.
const ids = plugin.maintainedModels.map(m => m.id)
for (const id of [
  'glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5',
  'glm-5-turbo', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash',
]) assert.ok(ids.includes(id), `missing ${id}`)
assert.ok(ids.length >= 10, `expected >= 10 merged models, got ${ids.length}`)

// d8189e3 semantics on the built artifact.
const glm53 = plugin.maintainedModels.find(m => m.id === 'glm-5.3')
const glm53f = plugin.maintainedModels.find(m => m.id === 'glm-5.3-flash')
for (const [label, m] of [['glm-5.3', glm53], ['glm-5.3-flash', glm53f]]) {
  assert.deepEqual(m.thinkingLevelMap, {
    off: null, minimal: null, low: 'high', medium: 'high', high: 'high',
    xhigh: 'max', max: 'max',
  }, `${label} thinkingLevelMap`)
  assert.deepEqual(m.compat, {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    maxTokensField: 'max_tokens',
    thinkingFormat: 'zai',
    zaiToolStream: true,
  }, `${label} compat`)
}
assert.deepEqual([...plugin.DIRECTLY_VERIFIED].sort(), ['glm-5.3', 'glm-5.3-flash'])
assert.deepEqual(plugin.GLM53_THINKING_LEVEL_MAP, {
  off: null, minimal: null, low: 'high', medium: 'high', high: 'high',
  xhigh: 'max', max: 'max',
})
assert.deepEqual(plugin.GLM_COMPAT, {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
  thinkingFormat: 'zai',
  zaiToolStream: true,
})

// discoverModels keeps directly-verified models alive.
const discovered = plugin.discoverModels({ data: [{ id: 'glm-4.6' }] })
assert.deepEqual(discovered.map(m => m.id).sort(), ['glm-4.6', 'glm-5.3', 'glm-5.3-flash'])

// Config resolves the single-endpoint model with per-route labels.
const resolvedDefault = plugin.resolveConfig(plugin.Config({}))
assert.equal(resolvedDefault.endpoints.length, 1)
assert.equal(resolvedDefault.endpoints[0].provider, 'zai')
assert.equal(resolvedDefault.endpoints[0].displayName, 'BigModel')
assert.equal(resolvedDefault.useLocalApiKey, false)
const resolvedPaas = plugin.resolveConfig(plugin.Config({ endpoints: 'paas' }))
assert.equal(resolvedPaas.endpoints[0].provider, 'zhipu')
assert.equal(resolvedPaas.endpoints[0].displayName, 'BigModel')
assert.throws(() => plugin.Config({ endpoints: 'both' }))

// Settings RPC handler factory loads from the built artifact and serves the
// local-key endpoints against a credentials double.
const rpc = await import('../lib/settings-rpc.js')
assert.equal(typeof rpc.createSettingsRpcHandler, 'function')
assert.deepEqual(rpc.MUTABLE_FIELDS, [
  'endpoints', 'codingApiKeyEnv', 'paasApiKeyEnv', 'codingBaseURL',
  'paasBaseURL', 'displayName',
  'defaultReasoningTier', 'useLocalApiKey',
])
const stored = new Map()
const handler = rpc.createSettingsRpcHandler({
  get: () => ({}),
  get writable() { return true },
  describe: () => [{ ns: 'zhipu-toolkit', value: {}, revision: 0 }],
  mutate: async () => {},
}, 'zhipu-toolkit', {
  set: async (ref, value) => { stored.set(ref, value) },
  unset: async (ref) => { stored.delete(ref) },
  describe: async (ref) => ({ configured: stored.has(ref), writable: true }),
  masked: async (ref) => {
    const value = stored.get(ref)
    return value === undefined ? undefined : '••••••••' + value.slice(-4)
  },
})
assert.deepEqual(await handler('local-key', {}), { ok: true, value: { configured: false, writable: true, masked: '' } })
assert.deepEqual(await handler('set-local-key', { value: 'probe-key' }), { ok: true, value: { configured: true, writable: true, masked: '••••••••-key' } })
assert.equal(stored.get('ZHIPU_TOOLKIT_API_KEY'), 'probe-key')

// Invariant companion loads.
const invariant = await import('../lib/invariant.js')
assert.equal(invariant.name, 'dsh-zhipu-toolkit-invariant')
assert.deepEqual(invariant.GLM53_WIRE_MAP, {
  low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max',
})

// ---- Client half (ModuleLoader double) -----------------------------------
const SEEDS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])
const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      assert.equal(def.id, 'dsh-zhipu-toolkit')
      const require = (spec) => {
        assert.ok(SEEDS.has(spec), `non-seed require: ${spec}`)
        return { /* structural double: enough for apply() not to touch them */ }
      }
      loaded.push(def.factory(require))
    },
  },
}
await import('../lib/client.js')
assert.equal(loaded.length, 1, 'ModuleLoader.load must fire exactly once')
const client = loaded[0]
assert.equal(typeof client.apply, 'function')
assert.deepEqual(client.inject, ['slots', 'connection', 'locale'])

// Drive apply() against structural doubles: the card must mount the
// settings.plugin.item slot (keyed by the settings namespace) and pass the
// SettingsCard component itself.
const registered = []
const unsubscribeLocale = () => {}
let registeredSlot = null
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: {
    register: () => unsubscribeLocale,
    bind: () => (key) => key,
    subscribe: () => () => {},
    getLocale: () => ({ active: 'en' }),
  },
  connection: { rpc: { call: async () => ({ ok: true, value: { value: {}, revision: 0 } }) } },
  slots: {
    inject: (key, cb) => { registered.push(key); cb() },
    register: (options, component) => {
      registeredSlot = { options, component }
      return () => {}
    },
  },
}
client.apply(ctx)
assert.deepEqual(registered, ['settings.plugin.item'])
assert.ok(registeredSlot, 'settings.plugin.item must be registered')
assert.equal(registeredSlot.options.id, 'dsh-zhipu-toolkit')
assert.equal(registeredSlot.options.name, 'settings.plugin.item')
assert.equal(registeredSlot.options.key, 'zhipu-toolkit', 'the card key must pair with the settings namespace')
assert.equal(typeof registeredSlot.component, 'function', 'component must be the function itself, not a wrapper')
assert.equal(registeredSlot.options.inject().connection, ctx.connection)

console.log('simulated host load: ALL PASS')
