import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as Built from '../lib/index.js'
import * as BuiltInvariant from '../lib/invariant.js'

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

  it('exposes the settings constants the client card targets', () => {
    expect(Built.SETTINGS_NAMESPACE).toBe('zhipu-toolkit')
    expect(Built.REASONING_TIERS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
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

  it('registers the settings.plugin.item slot with the component itself', () => {
    // The official configurable-plugins tab: the card hangs on the keyed
    // slot instead of a sidebar settings.section entry.
    expect(bundle).toContain("ctx.slots.inject('settings.plugin.item'")
    expect(bundle).toContain("name: 'settings.plugin.item'")
    // Keyed by the settings namespace: the tab pairs the card with the
    // Host-registered `zhipu-toolkit` namespace without interpreting it.
    expect(bundle).toContain('key: SETTINGS_NAMESPACE')
    // The register call must pass SettingsCard directly — not a wrapper like
    // () => jsx(SettingsCard, null), which renders a blank panel.
    expect(bundle).toMatch(/\}\s*,\s*SettingsCard\s*\)/)
  })

  it('draws the collapsible card shell itself: li + header + rotating chevron', () => {
    // The tab dispatches straight into its <ul>, so the card root is an <li>
    // (official PluginCard shape) and the card owns its disclosure chrome.
    expect(bundle).toMatch(/jsx\('li'/)
    expect(bundle).toContain("open ? 'zt_card zt_cardOpen' : 'zt_card'")
    // Header disclosure button with the expanding/collapsing aria label and
    // the official chevron rotating 180° when open.
    expect(bundle).toContain("'aria-expanded'")
    expect(bundle).toContain('zt_cardChevronOpen')
    expect(bundle).toContain('zt_cardChevron')
    // Shell copy keys ride along: one-line description + collapse/expand aria.
    expect(bundle).toContain("t('cardDescription')")
    // The aria label composes the state-dependent key at render time.
    expect(bundle).toContain("t(open ? 'collapse' : 'expand')")
    expect(bundle).toContain('BigModel GLM 双端点模型目录与凭据配置')
  })

  it('declares the client-side service injections including the remote surface', () => {
    // The official remote contract: connection carries it, api-gateway
    // provides it. Declaring each namespace is mandatory — an undeclared one
    // resolves to undefined and the card never loads.
    expect(bundle).toContain("'remote'")
    expect(bundle).toContain("'remote.credentials'")
    expect(bundle).toContain("'remote.settings'")
    expect(bundle).toContain("'zhipu-toolkit'")
  })

  it('carries the endpoint choice, billing help, and the local-key reference', () => {
    // Endpoint choice is one of exactly two billing channels.
    expect(bundle).toContain("const ENDPOINT_CHOICES = ['coding', 'paas']")
    expect(bundle).not.toContain("'both'")
    // Billing help copy keys for both channels.
    expect(bundle).toContain('endpointHelpCoding')
    expect(bundle).toContain('endpointHelpPaas')
    // Local-key mode writes through the credentials remote, not settings.
    expect(bundle).toContain('const LOCAL_API_KEY_REF')
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
    // The check icon submits through the same empty-guard as blur/Enter:
    // an absent or blank draft never reaches the credentials write.
    expect(bundle).toMatch(/const draft = keyDraftRef\.current/)
    expect(bundle).toMatch(/draft === undefined \|\| draft\.trim\(\)\.length === 0/)
    // The check icon's own aria/title label key exists in both languages.
    expect(bundle).toContain('saveHint')
    expect(bundle).toContain('t(\'saveHint\')')
  })

  it('carries the usage & quota section: console deep links, rules, disclaimer', () => {
    // The two official console pages (no public usage API exists — the
    // card deep-links instead of inventing endpoints).
    expect(bundle).toContain('https://www.bigmodel.cn/coding-plan/personal/usage')
    expect(bundle).toContain('https://bigmodel.cn/usercenter/proj-mgmt/rate-limits')
    // New-tab + noopener ride the window.open features string (Button is a
    // native <button>; <a target=_blank> around it is invalid nesting).
    expect(bundle).toMatch(/openExternal\(/)
    expect(bundle).toContain("'_blank', 'noopener,noreferrer'")
    // The external-link glyph comes from the official primitives catalog.
    expect(bundle).toContain('IconRightUpOutline16')
    // The i18n keys ride along in the shipped bundle.
    for (const key of [
      'usageQuotaTitle',
      'usageLink',
      'limitsLink',
      'usageRulesPlan',
      'usageRulesCredits',
      'usageRulesApi',
      'usageDisclaimer',
    ]) {
      expect(bundle).toContain(key)
    }
    // Both language bodies are present (zh title + en title).
    expect(bundle).toContain('用量与额度')
    expect(bundle).toContain('Usage & quota')
  })

  it('reads and writes through the remote surface with no custom channel', () => {
    // rc.1 retired plugin-owned RPC channels: the gateway owns the single
    // /api surface, and the card uses the official remote face instead.
    expect(bundle).toContain('remote.settings.describe()')
    expect(bundle).toContain('remote.settings.mutate(')
    expect(bundle).toContain('remote.credentials.describe([LOCAL_API_KEY_REF])')
    expect(bundle).toContain('remote.credentials.set(LOCAL_API_KEY_REF, draft)')
    expect(bundle).toContain('remote.credentials.unset(LOCAL_API_KEY_REF)')
    // Shape contract (the live failure this pins down): describe answers are
    // a `{ namespaces }` wrapper / a ref-keyed map — never bare arrays.
    expect(bundle).toContain('answer.namespaces')
    expect(bundle).toMatch(/outcome\.value\?\.\[LOCAL_API_KEY_REF\]/)
    // The named connect channel is gone from the shipped bundle.
    expect(bundle).not.toContain('zhipu-toolkit-settings')
    expect(bundle).not.toContain('usage-stats')
  })
})
