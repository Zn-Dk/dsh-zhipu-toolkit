import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as Built from '../lib/index.js'
import * as BuiltInvariant from '../lib/invariant.js'
import * as BuiltSettingsRpc from '../lib/settings-rpc.js'

/**
 * Verifies the BUILT artifact (lib/), not the sources: the tsc output must
 * keep the plugin shape, the maintained catalog, and the d8189e3-verified
 * wire semantics after compilation and ESM rewriting.
 */
describe('built host artifact', () => {
  it('exposes the cordis plugin shape', () => {
    expect(Built.name).toBe('dsh-zhipu-toolkit')
    expect(Built.inject).toEqual(['llm', 'credentials'])
  })

  it('ships a catalog of at least ten maintained models', () => {
    expect(Built.maintainedModels.length).toBeGreaterThanOrEqual(10)
    const ids = new Set(Built.maintainedModels.map(model => model.id))
    for (const id of ['glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-5-turbo', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash']) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('keeps the d8189e3-verified glm-5.3 wire semantics after compilation', () => {
    const glm53 = Built.maintainedModels.find(model => model.id === 'glm-5.3')
    expect(glm53?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
    expect(glm53?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'zai',
      zaiToolStream: true,
    })
    expect(Built.DEFAULT_REASONING_TIER).toBe('low')
  })

  it('keeps the invariant companion exports after compilation', () => {
    expect(BuiltInvariant.name).toBe('dsh-zhipu-toolkit-invariant')
    expect(BuiltInvariant.GLM53_WIRE_MAP).toEqual({
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
  })

  it('exposes the settings bridge constants the client card targets', () => {
    expect(Built.SETTINGS_NAMESPACE).toBe('zhipu-toolkit')
    // The connection channel pattern rejects inner slashes and requires a
    // leading one; the dash form is the only valid spelling.
    expect(Built.SETTINGS_CHANNEL).toBe('/zhipu-toolkit-settings')
    expect(Built.REASONING_TIERS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(Built.MUTABLE_FIELDS).toEqual([
      'endpoints',
      'codingApiKeyEnv',
      'paasApiKeyEnv',
      'codingBaseURL',
      'paasBaseURL',
      'displayName',
      'defaultReasoningTier',
      'useLocalApiKey',
    ])
    expect(typeof BuiltSettingsRpc.createSettingsRpcHandler).toBe('function')
  })

  it('exposes the local API key reference for the local-key mode', () => {
    expect(Built.LOCAL_API_KEY_REF).toBe('ZHIPU_TOOLKIT_API_KEY')
  })
})

describe('built client bundle', () => {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  it('registers through the ModuleLoader with the plugin id', () => {
    expect(bundle).toContain("__ModuleLoader__")
    expect(bundle).toContain(".load({")
    expect(bundle).toContain("id: 'dsh-zhipu-toolkit'")
  })

  it('requires only client seed words inside the factory closure', () => {
    const specifiers = [...bundle.matchAll(/\brequire\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)]
      .map(match => match[2])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect([
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-ui-slots',
        '@deepseek-ai/dsh-client-ui-primitives',
      ]).toContain(spec)
    }
  })

  it('registers the settings.section slot with the component itself', () => {
    expect(bundle).toContain("ctx.slots.inject('settings.section'")
    // The register call must pass SettingsCard directly — not a wrapper like
    // () => jsx(SettingsCard, null), which renders a blank panel.
    expect(bundle).toMatch(/\}\s*,\s*SettingsCard\s*\)/)
  })

  it('declares the client-side service injections and the RPC channel', () => {
    expect(bundle).toContain("const inject = ['slots', 'connection', 'locale']")
    expect(bundle).toContain("'/zhipu-toolkit-settings'")
    expect(bundle).toContain("'zhipu-toolkit'")
  })

  it('carries the endpoint choice, billing help, and local-key endpoints', () => {
    // Endpoint choice is one of exactly two billing channels.
    expect(bundle).toContain("const ENDPOINT_CHOICES = ['coding', 'paas']")
    expect(bundle).not.toContain("'both'")
    // Billing help copy keys for both channels.
    expect(bundle).toContain('endpointHelpCoding')
    expect(bundle).toContain('endpointHelpPaas')
    // Local-key mode endpoints on the RPC channel.
    expect(bundle).toContain("'set-local-key'")
    expect(bundle).toContain("'unset-local-key'")
    expect(bundle).toContain("'local-key'")
    expect(bundle).toContain('ZHIPU_TOOLKIT_API_KEY')
    // The card title follows the plugin name.
    expect(bundle).toContain('Zhipu Toolkit')
    expect(bundle).toContain('智谱工具箱')
  })

  it('carries the local-key edit flow: masked summary, icon buttons, empty-commit guard', () => {
    // Icon actions from the official primitives catalog (edit/close/check).
    expect(bundle).toContain('IconEditOutline16')
    expect(bundle).toContain('IconCloseOutline16')
    expect(bundle).toContain('IconCheckOutline16')
    // The plaintext-toggle icon was removed: editing-time input is password-only.
    expect(bundle).not.toContain('IconInspectOutline12')
    // The masked summary surface and the edit-mode switch.
    expect(bundle).toContain('zt_masked')
    expect(bundle).toContain('setEditingKey')
    expect(bundle).toContain('editingKey')
    // An empty commit must NOT unset the saved key (the guard's shape).
    expect(bundle).toMatch(/if\s*\(next\.trim\(\)\.length\s*>\s*0\)\s*\{/)
    // The new i18n keys ride along in both languages.
    expect(bundle).toContain('updateHint')
    expect(bundle).toContain('savedMaskedHelp')
    expect(bundle).toContain('t(\'edit\')')
  })

  it('carries the explicit check-commit path beside blur/Enter', () => {
    // The live draft rides a ref so the check icon can submit without blur.
    expect(bundle).toContain('keyDraftRef')
    expect(bundle).toContain('onDraftChange')
    // The check icon submits through the same empty-guard as blur/Enter.
    expect(bundle).toMatch(/const draft = keyDraftRef\.current/)
    expect(bundle).toMatch(/draft !== undefined && draft\.trim\(\)\.length > 0/)
    // The check icon's own aria/title label key exists in both languages.
    expect(bundle).toContain('saveHint')
    expect(bundle).toContain('t(\'saveHint\')')
  })
})
