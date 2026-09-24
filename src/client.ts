/**
 * Client half of dsh-zhipu-toolkit: the settings card.
 *
 * This source compiles verbatim to lib/client.js, which DSH loads through
 * window.__ModuleLoader__.load — it is NOT a plain ES module at runtime, so:
 * - the only top-level statement is the ModuleLoader registration;
 * - every require lives inside the factory closure and stays within the
 *   7-word client seed whitelist (react, react/jsx-runtime, react-dom,
 *   react-dom/client, @deepseek-ai/cordis, @deepseek-ai/dsh-client-ui-slots,
 *   @deepseek-ai/dsh-client-ui-primitives);
 * - types are structural and local; no type-only imports (tsc emits this
 *   file's body unchanged apart from stripping annotations).
 *
 * The card reads and writes the `zhipu-toolkit` settings namespace through
 * `ctx.remote.*` — the official api-gateway remote surface (the same path
 * the official ui-settings-models plugin uses). The local API key is held
 * through `remote.credentials` (stored in the credentials service, never in
 * settings.yaml). There is no custom RPC channel: rc.1 compositions no
 * longer register plugin channels (the gateway owns the single /api
 * surface), which is why this half follows the remote contract exactly.
 *
 * UI discipline (see reference/UI_COMPONENTS.md): controls come from
 * @deepseek-ai/dsh-client-ui-primitives — Input for text and password
 * fields, Button for actions and toggles, Icon* for glyphs. Enum pickers
 * use a native <select> under the official chevron icon (the primitives
 * catalog has no standalone Select atom; the host Models card itself uses
 * a native select). Only the card's layout CSS is authored here, and every
 * rule is taken from the host settings cards' compiled CSS (field: 12px/1.5
 * 500 secondary label, 6px gap; input: 32px tall, r8, border-l4, bg-layer-1,
 * 14px text — see packages/client/ui-settings-models ModelsSection.module.css
 * and the installed family cards' .field/.input rules).
 */

/* Structural faces of the seed modules — the only ambient runtime deps. */
interface ReactModule {
  useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  createElement: unknown
}
interface JsxRuntimeModule { jsx: (type: unknown, props: unknown, key?: unknown) => unknown }
interface PrimitivesModule {
  Input: (props: Record<string, unknown>) => unknown
  Button: (props: Record<string, unknown>) => unknown
  IconCheckOutline16: (props: Record<string, unknown>) => unknown
  IconChevronDownOutline14: (props: Record<string, unknown>) => unknown
  IconEditOutline16: (props: Record<string, unknown>) => unknown
  IconCloseOutline16: (props: Record<string, unknown>) => unknown
  IconRightUpOutline16: (props: Record<string, unknown>) => unknown
}
interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  subscribe(fn: () => void): () => void
  getLocale(): { active: string }
}

/* Structural faces of the api-gateway remote surface ({ok,value|error}).
 * Shape facts verified against the installed dsh-llm-stepfun card (the
 * same remote face):
 * - `settings.describe()` resolves to `{ namespaces: [...] }` — a wrapper
 *   object, NOT a bare array;
 * - `credentials.describe(refs)` resolves to a map keyed by reference,
 *   NOT an array. */
type RemoteResult<T> = { ok: true, value: T } | { ok: false, error: { code: string, message: string } }
/** One namespace descriptor out of the settings describe answer. */
interface SettingsDescriptor {
  ns: string
  value: unknown
  revision?: number
}
/** The settings describe answer: a namespaces wrapper, not a bare array. */
interface SettingsDescribeValue { namespaces?: ReadonlyArray<SettingsDescriptor> }
/** One credential-describe entry, keyed by reference on the describe answer. */
interface CredentialEntry { configured: boolean, writable?: boolean }
/** The credentials describe answer: a map from reference to entry. */
type CredentialsDescribeValue = Record<string, CredentialEntry>
interface RemoteCredentials {
  describe(refs: string[]): Promise<RemoteResult<CredentialsDescribeValue>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
  unset(ref: string): Promise<RemoteResult<unknown>>
}
interface RemoteSettings {
  describe(): Promise<RemoteResult<SettingsDescribeValue>>
  mutate(ns: string, ops: unknown, expectedRevision?: number): Promise<RemoteResult<unknown>>
}
interface RemoteHandle {
  credentials: RemoteCredentials
  settings: RemoteSettings
  $on?(event: string, handler: () => void): () => void
}
interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): () => void
  locale: LocaleService
  remote: RemoteHandle
  slots: {
    inject(key: string, callback: () => (() => void) | void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

/**
 * The ModuleLoader facade the web shell installs before any client bundle
 * runs (structural: no DOM lib needed — this file compiles under lib=es2023).
 */
interface ModuleLoaderFacade {
  load(definition: { id: string, factory: (require: (spec: string) => never) => unknown }): void
}

/** Browser DOM surface this bundle touches, accessed structurally. */
interface StyleTag { dataset: Record<string, string>, textContent: string }
interface DomLike {
  querySelector(selector: string): unknown
  createElement(tag: 'style'): StyleTag
  head: { appendChild(tag: StyleTag): unknown }
}
function dom(): DomLike | undefined {
  return (globalThis as { document?: DomLike }).document
}
/** The browser's language list, when a navigator exists. */
function browserLanguage(): string {
  const nav = (globalThis as { navigator?: { language?: string } }).navigator
  return nav?.language ?? 'en'
}

/**
 * Open an external page in a new tab with noopener/noreferrer enforced.
 * The official Button renders a native <button>, and wrapping it in an
 * <a target=_blank> would be invalid interactive nesting — so the new-tab
 * semantics ride the window.open features string instead of target/rel.
 */
function openExternal(url: string): void {
  const w = (globalThis as { window?: { open?: (url: string, target: string, features: string) => unknown } }).window
  w?.open?.(url, '_blank', 'noopener,noreferrer')
}

const __moduleLoader: ModuleLoaderFacade
  = (globalThis as unknown as { window: { __ModuleLoader__: ModuleLoaderFacade } }).window.__ModuleLoader__

__moduleLoader.load({
  id: 'dsh-zhipu-toolkit',
  factory: (require) => {
    const bundleModule = { exports: {} as Record<string, unknown> }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' })
    const react: ReactModule = require('react')
    const { jsx }: JsxRuntimeModule = require('react/jsx-runtime')
    const primitives: PrimitivesModule = require('@deepseek-ai/dsh-client-ui-primitives')
    // -- constants mirrored from the Host half (single source: src/index.ts) --
    const SETTINGS_NAMESPACE = 'zhipu-toolkit'
    const LOCAL_API_KEY_REF = 'ZHIPU_TOOLKIT_API_KEY'
    const LOCALE_NS = 'zhipu-toolkit'
    const REASONING_TIERS = ['low', 'medium', 'high', 'xhigh', 'max']
    const ENDPOINT_CHOICES = ['coding', 'paas']

    // Official BigModel console deep links: there is no public usage API
    // (probed endpoints all 404), so the console pages are the authoritative
    // surfaces the card links to. Local session-log aggregation was dropped
    // in the rc.1 rewrite: the remote surface carries no channel for custom
    // aggregates, and the console remains the source of truth either way.
    const USAGE_URL = 'https://www.bigmodel.cn/coding-plan/personal/usage'
    const RATE_LIMITS_URL = 'https://bigmodel.cn/usercenter/proj-mgmt/rate-limits'

    /**
     * Copy table. zh/en key sets are 1:1 (checked by scripts/check-i18n.mjs);
     * placeholders ({name}) must match across languages. Text follows the
     * host locale service — never navigator.language directly — with a
     * browser-language fallback when the service is absent.
     */
    const I18N: Record<'zh' | 'en', Record<string, string>> = {
      zh: {
        title: '智谱工具箱',
        cardDescription: 'BigModel GLM 双端点模型目录与凭据配置',
        collapse: '收起',
        expand: '展开',
        intro: 'BigModel GLM 模型目录：选择计费通道，配置凭据与默认推理档，模型列表实时发现。',
        endpointsLabel: '端点',
        endpointsHint: '选择本部署使用的 BigModel 计费通道。',
        endpointsCoding: 'Coding Plan（套餐计费）',
        endpointsPaas: '普通 API（按量计费）',
        endpointHelpCoding: 'coding 通道（open.bigmodel.cn/api/coding/paas/v4）：套餐积分制（Lite/Pro/Max），5 小时+每周双限额，耗尽后等周期恢复、不扣余额；非高峰时段 5 折；场景限官方编码工具。',
        endpointHelpPaas: 'paas 通道（open.bigmodel.cn/api/paas/v4）：按 token 计费（资源包/余额），无场景限制。两通道模型列表与参数行为完全一致，区别仅在计费。',
        codingKeyLabel: 'Coding Plan 凭据引用',
        codingKeyHint: '读取该凭据引用作为 Coding Plan 端点的 API key。',
        paasKeyLabel: '普通 API 凭据引用',
        paasKeyHint: '读取该凭据引用作为普通端点的 API key。',
        envKeyHint: '通过 dsh web 凭证库管理对应环境变量的 API key。',
        displayNameLabel: '显示名称',
        displayNameHint: '模型选择器中的提供方名称。',
        reasoningLabel: '默认推理档',
        reasoningHint: '未指定 effort 的请求使用的思考档位。GLM-5.3 系列无法关闭思考。',
        useLocalApiKeyLabel: '本地 API key',
        useLocalApiKeyHint: '开启后在卡片内直接保存 API key（存入 dsh 凭证库，不写入 settings.yaml）；关闭则使用下方凭据引用。',
        localApiKeyLabel: 'API key',
        localApiKeyHint: '保存到 dsh 凭证库 ZHIPU_TOOLKIT_API_KEY；保存后即可直接发消息，无需手动存环境变量。',
        localApiKeyConfigured: '已保存（保存在 dsh 凭证库）',
        localApiKeyNotConfigured: '未设置',
        localApiKeyPlaceholder: '粘贴 API key',
        edit: '编辑',
        updateHint: '输入新 key 后失焦或按 Enter 即覆盖保存；留空则不修改。',
        savedMaskedHelp: '已保存（仅显示末 4 位）。点编辑图标输入新值覆盖。',
        saveHint: '立即保存',
        clear: '清除',
        codingBaseLabel: 'Coding Plan Base URL',
        paasBaseLabel: '普通 API Base URL',
        advanced: '高级',
        saveFailed: '保存失败',
        readOnly: '当前部署的设置文档为只读。',
        loadFailed: '加载设置失败',
        retry: '重试',
        saved: '已保存',
        unloading: '等待宿主…',
        envPatternHint: '仅字母、数字与下划线。',
        usageQuotaTitle: '用量与额度',
        usageLink: 'Coding Plan 用量统计',
        limitsLink: '速率限制',
        usageRulesPlan: '套餐限额：5 小时 + 每周双限额，耗尽后等周期恢复、不扣余额；非高峰时段（工作日 14-18 点外）积分消耗 5 折。',
        usageRulesCredits: '积分系数（每万 token）：GLM-5.3=6.9/24、Flash=2.3/8。',
        usageRulesApi: '普通 API 按 token 计费，无场景限制。',
        usageDisclaimer: '用量数据以 BigModel 官方控制台为准，本卡片仅提供入口。',
      },
      en: {
        title: 'Zhipu Toolkit',
        cardDescription: 'BigModel GLM dual-endpoint model catalog and credentials',
        collapse: 'Collapse',
        expand: 'Expand',
        intro: 'BigModel GLM model catalog: pick the billing channel, configure credentials and the default reasoning tier, with live model discovery.',
        endpointsLabel: 'Endpoint',
        endpointsHint: 'Choose which BigModel billing channel this deployment uses.',
        endpointsCoding: 'Coding Plan (subscription)',
        endpointsPaas: 'Ordinary API (pay-as-you-go)',
        endpointHelpCoding: 'The coding channel (open.bigmodel.cn/api/coding/paas/v4): subscription quota (Lite/Pro/Max), 5-hour + weekly dual limits that reset with the window and never touch the balance; 50% off off-peak; scoped to official coding tools.',
        endpointHelpPaas: 'The paas channel (open.bigmodel.cn/api/paas/v4): per-token billing (resource packs / balance), no scene restriction. Both channels expose identical model lists and parameter behavior — the difference is billing only.',
        codingKeyLabel: 'Coding Plan credential ref',
        codingKeyHint: 'Credential reference read as the Coding Plan endpoint API key.',
        paasKeyLabel: 'Ordinary API credential ref',
        paasKeyHint: 'Credential reference read as the ordinary endpoint API key.',
        envKeyHint: 'Manage the API key for the env variable through the dsh web credentials store.',
        displayNameLabel: 'Display name',
        displayNameHint: 'Provider label shown in model selectors.',
        reasoningLabel: 'Default reasoning tier',
        reasoningHint: 'Thinking tier used for requests that name no effort. GLM-5.3-series models cannot turn thinking off.',
        useLocalApiKeyLabel: 'Local API key',
        useLocalApiKeyHint: 'Store the API key right on this card (kept in the dsh credentials store, never in settings.yaml); off falls back to the credential reference below.',
        localApiKeyLabel: 'API key',
        localApiKeyHint: 'Stored in the dsh credentials store as ZHIPU_TOOLKIT_API_KEY; once saved you can send messages without manually storing an env variable.',
        localApiKeyConfigured: 'Saved (kept in the dsh credentials store)',
        localApiKeyNotConfigured: 'Not set',
        localApiKeyPlaceholder: 'Paste the API key',
        edit: 'Edit',
        updateHint: 'Type a new key and blur or press Enter to overwrite; leaving it empty keeps the saved one.',
        savedMaskedHelp: 'Saved (last 4 characters shown). Click the edit icon to enter a new value.',
        saveHint: 'Save now',
        clear: 'Clear',
        codingBaseLabel: 'Coding Plan base URL',
        paasBaseLabel: 'Ordinary API base URL',
        advanced: 'Advanced',
        saveFailed: 'Save failed',
        readOnly: 'The settings document is read-only in this deployment.',
        loadFailed: 'Loading settings failed',
        retry: 'Retry',
        saved: 'Saved',
        unloading: 'Waiting for the host…',
        envPatternHint: 'Letters, digits, and underscores only.',
        usageQuotaTitle: 'Usage & quota',
        usageLink: 'Coding Plan usage',
        limitsLink: 'Rate limits',
        usageRulesPlan: 'Plan quota: 5-hour + weekly dual limits; exhausted quota restores with the cycle and never touches the balance; credit burn is 50% off off-peak (outside weekday 14:00-18:00).',
        usageRulesCredits: 'Credit factors (per 10k tokens): GLM-5.3=6.9/24, Flash=2.3/8.',
        usageRulesApi: 'The ordinary API bills per token with no scene restriction.',
        usageDisclaimer: 'The official BigModel console is the source of truth for usage and quota; this card only links to it.',
      },
    }

    /** Resolve the dictionary for a locale id ('zh-CN' family → zh, else en). */
    function dictFor(active: string): Record<string, string> {
      return active !== undefined && active.toLowerCase().startsWith('zh') ? I18N.zh : I18N.en
    }

    /**
     * Layout CSS extracted from the host settings cards (field 12px/1.5 500
     * secondary label + 6px gap; input 32px r8 border-l4 bg-layer-1 14px;
     * advanced fields live behind the same disclosure pattern the Models
     * editor uses). Colors resolve exclusively through --dsw-alias-* tokens
     * so light/dark themes both hold.
     */
    const css = [
      '.zt_section{display:flex;flex-direction:column;max-width:720px;color:var(--dsw-alias-label-primary)}',
      '.zt_title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.zt_intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}',
      '.zt_field{display:flex;flex-direction:column;gap:6px}',
      '.zt_fieldLabel{display:inline-flex;align-items:center;gap:10px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.zt_hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.zt_help{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:pre-line}',
      '.zt_input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.zt_input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.zt_input::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.zt_input:disabled{opacity:0.6;cursor:default}',
      '.zt_select{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.zt_select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.zt_select:disabled{opacity:0.6;cursor:default}',
      '.zt_selectWrap{position:relative;display:flex;align-items:center}',
      '.zt_selectChevron{position:absolute;right:8px;pointer-events:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}',
      '.zt_selectWrap .zt_select{appearance:none;padding-right:28px}',
      '.zt_status{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.zt_notice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}',
      '.zt_saved{display:inline-flex;align-items:center;gap:4px;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}',
      '.zt_state{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.zt_fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.zt_fields>.zt_field{min-width:0}',
      '.zt_span2{grid-column:1 / -1}',
      '.zt_advanced{border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:10px}',
      '.zt_advancedSummary{display:flex;align-items:center;gap:6px;width:fit-content;padding:2px 4px;margin-left:-4px;border-radius:6px;cursor:pointer;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);list-style:none}',
      '.zt_advancedSummary::-webkit-details-marker{display:none}',
      '.zt_advancedSummary:hover{color:var(--dsw-alias-label-primary)}',
      '.zt_advancedBody{display:flex;flex-direction:column;gap:12px;padding-top:12px}',
      '.zt_footer{display:flex;align-items:center;gap:8px;min-height:24px}',
      '.zt_keyRow{display:flex;align-items:center;gap:8px}',
      '.zt_keyRow .zt_inputWrap{flex:1;min-width:0}',
      '.zt_iconBtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.zt_iconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.zt_iconBtn:disabled{opacity:0.4;cursor:default;background:transparent;color:var(--dsw-alias-label-tertiary)}',
      '.zt_masked{display:inline-flex;align-items:center;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.zt_usage{display:flex;flex-direction:column;gap:8px;border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:10px}',
      '.zt_usageTitle{margin:0;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.zt_usageLinks{display:flex;flex-wrap:wrap;gap:8px}',
      '.zt_disclaimer{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed)}',
      '.zt_card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}',
      '.zt_card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.zt_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.zt_cardHeader{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
      '.zt_cardHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.zt_cardHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.zt_cardName{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.zt_cardDescription{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.zt_cardChevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.zt_cardChevronOpen{transform:rotate(180deg)}',
      '.zt_cardBody{border-top:0.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px}',
      '@media (prefers-reduced-motion:reduce){.zt_advancedSummary,.zt_cardChevron{transition:none}}',
    ].join('')

    {
      const document = dom()
      if (document !== undefined) {
        const tagId = 'dsh-zhipu-toolkit/src/client.css'
        if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
          const tag = document.createElement('style')
          tag.dataset.pluginCss = tagId
          tag.textContent = css
          document.head.appendChild(tag)
        }
      }
    }

    /** Resolved section snapshot the card works from. */
    interface View { value: Record<string, unknown>, revision: number }

    /** Local-key state derived from the credentials service. */
    interface LocalKeyView { configured: boolean, writable: boolean, masked: string }

    /** Credential-ref shape the card validates: letters, digits, underscores. */
    const ENV_REF_PATTERN = /^[A-Za-z0-9_]*$/

    /**
     * One text field with a local draft: the write fires on blur/Enter
     * only, never per keystroke (see CLIENT_BUNDLE.md's input lesson).
     */
    function FieldInput(props: {
      value: unknown
      disabled: boolean
      label: string
      placeholder: string
      type?: 'text' | 'password'
      pattern?: RegExp
      /** Live draft notification, so an external commit button can read it. */
      onDraftChange?: (draft: string) => void
      onCommit: (next: string) => void
    }): unknown {
      const initial = props.value === undefined || props.value === null ? '' : String(props.value)
      const [draft, setDraft] = react.useState(initial)
      react.useEffect(() => { setDraft(initial) }, [initial])
      const updateDraft = (next: string) => {
        setDraft(next)
        props.onDraftChange?.(next)
      }
      const commit = () => {
        if (draft === initial) return
        if (props.pattern !== undefined && !props.pattern.test(draft)) return
        props.onCommit(draft)
      }
      return jsx(primitives.Input, {
        type: props.type ?? 'text',
        className: 'zt_input',
        value: draft,
        disabled: props.disabled,
        placeholder: props.placeholder,
        'aria-label': props.label,
        autoComplete: 'off',
        spellCheck: false,
        onChange: (e: { target: { value: string } }) => { updateDraft(e.target.value) },
        onBlur: commit,
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') commit() },
      })
    }

    /**
     * Enum picker as a styled native select under an official chevron icon.
     * The primitives catalog has no standalone Select atom (Menu is an
     * anchored popup); the host Models card itself uses a native select
     * styled exactly this way, so this is the aligned choice, not a rewrite
     * of an official component.
     */
    function FieldSelect(props: {
      value: string
      disabled: boolean
      label: string
      options: Array<{ id: string, text: string }>
      onChange: (next: string) => void
    }): unknown {
      return jsx('span', { className: 'zt_selectWrap', children: [
        jsx('select', {
          className: 'zt_select',
          value: props.value,
          disabled: props.disabled,
          'aria-label': props.label,
          onChange: (e: { target: { value: string } }) => { props.onChange(e.target.value) },
          children: props.options.map(option =>
            jsx('option', { value: option.id, children: option.text }, option.id)),
        }),
        jsx(primitives.IconChevronDownOutline14, { className: 'zt_selectChevron' }),
      ] })
    }

    /** Mask a saved key to its last four characters (never crosses the wire). */
    const maskTail = (value: string): string => '••••••••' + value.slice(-4)

    /**
     * Read the namespace's descriptor out of remote.settings.describe() and
     * project it into the card's view. The remote face returns every
     * registered namespace, so ours is selected by id; an older host that
     * does not expose it yields undefined and the card shows its retry state.
     */
    function viewFromDescriptors(answer: SettingsDescribeValue): View | undefined {
      const namespaces = answer.namespaces
      if (!Array.isArray(namespaces)) return undefined
      const hit = namespaces.find(entry => entry['ns'] === SETTINGS_NAMESPACE)
      if (hit === undefined) return undefined
      const value = hit['value']
      const revision = hit['revision']
      if (value === undefined || typeof value !== 'object') return undefined
      return {
        value: value as Record<string, unknown>,
        revision: typeof revision === 'number' ? revision : 0,
      }
    }

    /** The settings card itself (slot component: reads ctx.remote.*). */
    function SettingsCard(): unknown {
      const [view, setView] = react.useState<View | undefined>(undefined)
      const [localKey, setLocalKey] = react.useState<LocalKeyView | undefined>(undefined)
      const [error, setError] = react.useState<string | undefined>(undefined)
      const [readOnly, setReadOnly] = react.useState(false)
      const [saved, setSaved] = react.useState(false)
      const [reload, setReload] = react.useState(0)
      const [editingKey, setEditingKey] = react.useState(false)
      // Card-local disclosure: which card the user has open is a reading
      // gesture — the Host and the tab have no stake in it (official
      // PluginCard behavior).
      const [open, setOpen] = react.useState(false)
      // Live draft of the local-key input, kept in a ref (no re-render): the
      // explicit check-commit icon reads it without waiting for blur/Enter.
      const keyDraftRef = react.useState<{ current: string | undefined }>({ current: undefined })[0]
      // Copy freshness: subscribe to the locale service when present, else
      // fall back to the browser language; both re-resolve t() per render.
      const [localeTick, setLocaleTick] = react.useState(0)
      const locale = getCtx()?.locale
      react.useEffect(() => {
        if (locale === undefined) return
        return locale.subscribe(() => { setLocaleTick(tick => tick + 1) })
      }, [locale])
      const active = locale === undefined ? browserLanguage() : locale.getLocale().active
      const t = (key: string, params?: Record<string, unknown>): string => {
        void localeTick
        const table = dictFor(active)
        const raw = table[key] ?? I18N.en[key] ?? key
        if (params === undefined) return raw
        return raw.replace(/\{(\w+)\}/g, (match: string, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
      }

      // One mount pass: read the section, read the key state. Reloads re-run
      // it after a rejected write or a manual retry.
      react.useEffect(() => installReloadBridge(() => { setReload(n => n + 1) }), [])
      react.useEffect(() => {
        const remote = getCtx()?.remote
        if (remote === undefined) return
        let cancelled = false
        setError(undefined)
        void (async () => {
          try {
            const outcome = await remote.settings.describe()
            if (cancelled) return
            if (!outcome.ok) {
              setError(outcome.error.message)
              return
            }
            const next = viewFromDescriptors(outcome.value)
            if (next === undefined) {
              setError('namespace not registered')
              return
            }
            setView(next)
            setSaved(false)
          } catch (e: unknown) {
            if (!cancelled) setError(String(e))
          }
        })()
        // The key state: read what the credentials service knows, then mask
        // the stored value locally (the raw key never re-enters the view).
        // The describe answer is a map keyed by reference, not an array.
        void (async () => {
          try {
            const outcome = await remote.credentials.describe([LOCAL_API_KEY_REF])
            if (cancelled || !outcome.ok) return
            const entry = outcome.value?.[LOCAL_API_KEY_REF]
            if (entry === undefined) return
            setLocalKey({
              configured: entry.configured === true,
              writable: entry.writable !== false,
              masked: entry.configured === true ? '••••••••' : '',
            })
          } catch {
            /* the key state stays unknown; the field still works */
          }
        })()
        return () => { cancelled = true }
      }, [reload])

      /** One settings write: path-addressed ops over the namespace's user section. */
      const mutate = (ops: Array<{ op: 'set' | 'unset', path: string[], value?: unknown }>) => {
        const remote = getCtx()?.remote
        if (remote === undefined || view === undefined) return
        void (async () => {
          try {
            const outcome = await remote.settings.mutate(
              SETTINGS_NAMESPACE,
              ops,
              view.revision,
            )
            if (outcome.ok) {
              setSaved(true)
              setError(undefined)
              // Re-read: the committed revision moved, and the next write's
              // expectedRevision must track it.
              setReload(n => n + 1)
            } else {
              if (outcome.error.code === 'read-only') setReadOnly(true)
              setError(outcome.error.message)
            }
          } catch (e: unknown) {
            setError(String(e))
          }
        })()
      }

      const saveField = (key: string, next: unknown) => {
        mutate([{ op: 'set', path: [key], value: next }])
      }

      const callLocalKey = (endpoint: 'set' | 'unset') => {
        const remote = getCtx()?.remote
        if (remote === undefined) return
        void (async () => {
          try {
            const draft = keyDraftRef.current
            const outcome = endpoint === 'unset'
              ? await remote.credentials.unset(LOCAL_API_KEY_REF)
              : draft === undefined || draft.trim().length === 0
                ? undefined
                : await remote.credentials.set(LOCAL_API_KEY_REF, draft)
            if (outcome === undefined) return
            if (outcome.ok) {
              setSaved(true)
              setError(undefined)
              setEditingKey(false)
              keyDraftRef.current = undefined
              setReload(n => n + 1)
            } else {
              setError(outcome.error.message)
            }
          } catch (e: unknown) {
            setError(String(e))
          }
        })()
      }

      // The card shell mirrors the official PluginCard: an <li> (the tab's
      // dispatch lands directly inside its <ul>), a header button naming the
      // plugin over a one-line description, and a rotating chevron. The card
      // is draft-commit (no staged save), so there is no unsaved marker or
      // save/discard footer — the body just discloses the controls.
      const shell = (content: unknown): unknown => jsx('li', {
        className: open ? 'zt_card zt_cardOpen' : 'zt_card',
        children: [
          jsx('button', {
            type: 'button',
            className: 'zt_cardHeader',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
            onClick: () => { setOpen(!open) },
            children: [
              jsx('span', { className: 'zt_cardHeadText', children: [
                jsx('span', { className: 'zt_cardName', children: t('title') }),
                jsx('span', { className: 'zt_cardDescription', children: t('cardDescription') }),
              ] }),
              jsx(primitives.IconChevronDownOutline14, {
                className: open ? 'zt_cardChevron zt_cardChevronOpen' : 'zt_cardChevron',
              }),
            ],
          }),
          open ? jsx('div', { className: 'zt_cardBody', children: content }) : null,
        ],
      })

      if (view === undefined) {
        return shell(jsx('div', { className: 'zt_section', children: [
          error === undefined
            ? jsx('p', { className: 'zt_hint', children: t('unloading') })
            : jsx('p', { className: 'zt_status', children: `${t('loadFailed')}: ${error}` }),
          error === undefined ? null : jsx(primitives.Button, {
            variant: 'outline',
            onClick: () => { setReload(n => n + 1) },
            children: t('retry'),
          }),
        ] }))
      }

      const value = view.value
      const endpoints = String(value.endpoints ?? 'coding')
      const useLocal = value.useLocalApiKey === true

      return shell(jsx('div', { className: 'zt_section', children: [
        jsx('p', { className: 'zt_intro', children: t('intro') }),
        readOnly ? jsx('p', { className: 'zt_notice', children: t('readOnly') }) : null,
        error === undefined ? null : jsx('p', { className: 'zt_status', children: `${t('saveFailed')}: ${error}` }),
        jsx('div', { className: 'zt_fields', children: [
          // Endpoint choice: one of the two billing channels, full-width so
          // the billing help underneath has room to breathe.
          jsx('label', { className: 'zt_field zt_span2', children: [
            jsx('span', { className: 'zt_fieldLabel', children: t('endpointsLabel') }),
            jsx(FieldSelect, {
              value: ENDPOINT_CHOICES.includes(endpoints) ? endpoints : 'coding',
              label: t('endpointsLabel'),
              options: [
                { id: 'coding', text: t('endpointsCoding') },
                { id: 'paas', text: t('endpointsPaas') },
              ],
              onChange: (next: string) => { saveField('endpoints', next) },
            }),
            jsx('p', { className: 'zt_help', children: endpoints === 'paas'
              ? t('endpointHelpPaas')
              : t('endpointHelpCoding') }),
          ] }),
          // Local API key toggle (icon form, like the key-row actions).
          jsx('label', { className: 'zt_field zt_span2', children: [
            jsx('span', { className: 'zt_fieldLabel', children: [
              t('useLocalApiKeyLabel'),
              jsx('button', {
                type: 'button',
                className: 'zt_iconBtn',
                'aria-pressed': useLocal ? 'true' : 'false',
                'aria-label': t('useLocalApiKeyLabel'),
                title: t('useLocalApiKeyLabel'),
                onClick: () => { saveField('useLocalApiKey', !useLocal) },
                children: useLocal
                  ? jsx(primitives.IconCheckOutline16, {})
                  : jsx(primitives.IconEditOutline16, {}),
              }),
            ] }),
            jsx('p', { className: 'zt_hint', children: t('useLocalApiKeyHint') }),
          ] }),
          // Local API key: masked summary + icon actions when saved, an
          // editable password input otherwise (or after pressing edit).
          useLocal ? jsx('div', { className: 'zt_field zt_span2', children: [
            jsx('span', { className: 'zt_fieldLabel', children: [
              t('localApiKeyLabel'),
              localKey === undefined ? null : jsx('span', { className: 'zt_state', children:
                localKey.configured ? t('localApiKeyConfigured') : t('localApiKeyNotConfigured') }),
            ] }),
            (editingKey || localKey?.configured !== true)
              ? jsx('div', { className: 'zt_keyRow', children: [
                  jsx('div', { className: 'zt_inputWrap', children:
                    jsx(FieldInput, {
                      value: '',
                      label: t('localApiKeyLabel'),
                      placeholder: t('localApiKeyPlaceholder'),
                      type: 'password',
                      onDraftChange: (draft: string) => { keyDraftRef.current = draft },
                      onCommit: (next: string) => {
                        // An empty commit keeps the saved key untouched;
                        // a non-empty value overwrites it in place.
                        if (next.trim().length > 0) {
                          keyDraftRef.current = next
                          callLocalKey('set')
                          setEditingKey(false)
                        }
                      },
                    }) }),
                  jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('saveHint'),
                    title: t('saveHint'),
                    onClick: () => { callLocalKey('set') },
                    children: jsx(primitives.IconCheckOutline16, {}),
                  }),
                  localKey?.configured === true ? jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('clear'),
                    title: t('clear'),
                    onClick: () => { callLocalKey('unset') },
                    children: jsx(primitives.IconCloseOutline16, {}),
                  }) : null,
                ] })
              : jsx('div', { className: 'zt_keyRow', children: [
                  jsx('div', { className: 'zt_masked', children: localKey?.masked ?? '••••••••' }),
                  jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('edit'),
                    title: t('edit'),
                    onClick: () => {
                      keyDraftRef.current = undefined
                      setEditingKey(true)
                    },
                    children: jsx(primitives.IconEditOutline16, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('clear'),
                    title: t('clear'),
                    onClick: () => { callLocalKey('unset') },
                    children: jsx(primitives.IconCloseOutline16, {}),
                  }),
                ] }),
            jsx('p', { className: 'zt_hint', children:
              localKey?.configured === true && !editingKey
                ? t('savedMaskedHelp')
                : `${t('localApiKeyHint')} ${t('updateHint')}` }),
          ] }) : null,
          // Reasoning tier for effort-undefined requests.
          jsx('label', { className: 'zt_field', children: [
            jsx('span', { className: 'zt_fieldLabel', children: t('reasoningLabel') }),
            jsx(FieldSelect, {
              value: REASONING_TIERS.includes(String(value.defaultReasoningTier ?? 'low'))
                ? String(value.defaultReasoningTier)
                : 'low',
              label: t('reasoningLabel'),
              options: REASONING_TIERS.map(id => ({ id, text: id })),
              onChange: (next: string) => { saveField('defaultReasoningTier', next) },
            }),
            // GLM-5.3 cannot disable thinking — the always-visible hint keeps
            // the explanation one glance away without crowding the field.
            jsx('p', { className: 'zt_hint', children: t('reasoningHint') }),
          ] }),
          // Display name for the served route.
          jsx('label', { className: 'zt_field', children: [
            jsx('span', { className: 'zt_fieldLabel', children: t('displayNameLabel') }),
            jsx(FieldInput, {
              value: value.displayName,
              label: t('displayNameLabel'),
              placeholder: 'BigModel',
              onCommit: (next: string) => { saveField('displayName', next) },
            }),
            jsx('p', { className: 'zt_hint', children: t('displayNameHint') }),
          ] }),
          // Env credential reference for the ACTIVE endpoint; hidden while
          // the local key mode is on (the env path stays as host fallback).
          useLocal ? null : (endpoints === 'paas'
            ? jsx('label', { className: 'zt_field', children: [
                jsx('span', { className: 'zt_fieldLabel', children: t('paasKeyLabel') }),
                jsx(FieldInput, {
                  value: value.paasApiKeyEnv,
                  label: t('paasKeyLabel'),
                  placeholder: 'ZHIPU_API_KEY',
                  pattern: ENV_REF_PATTERN,
                  onCommit: (next: string) => { saveField('paasApiKeyEnv', next) },
                }),
                jsx('p', { className: 'zt_hint', children: `${t('paasKeyHint')} ${t('envKeyHint')} ${t('envPatternHint')}` }),
              ] })
            : jsx('label', { className: 'zt_field', children: [
                jsx('span', { className: 'zt_fieldLabel', children: t('codingKeyLabel') }),
                jsx(FieldInput, {
                  value: value.codingApiKeyEnv,
                  label: t('codingKeyLabel'),
                  placeholder: 'BIGMODEL_API_KEY',
                  pattern: ENV_REF_PATTERN,
                  onCommit: (next: string) => { saveField('codingApiKeyEnv', next) },
                }),
                jsx('p', { className: 'zt_hint', children: `${t('codingKeyHint')} ${t('envKeyHint')} ${t('envPatternHint')}` }),
              ] })),
        ] }),
        // Advanced disclosure: base URLs change rarely; the same pattern the
        // host Models editor uses for its customized-settings block.
        jsx('details', { className: 'zt_advanced', children: [
          jsx('summary', { className: 'zt_advancedSummary', children: [
            jsx(primitives.IconChevronDownOutline14, {}),
            t('advanced'),
          ] }),
          jsx('div', { className: 'zt_advancedBody', children: [
            jsx('label', { className: 'zt_field', children: [
              jsx('span', { className: 'zt_fieldLabel', children: t('codingBaseLabel') }),
              jsx(FieldInput, {
                value: value.codingBaseURL,
                label: t('codingBaseLabel'),
                placeholder: 'https://open.bigmodel.cn/api/coding/paas/v4',
                onCommit: (next: string) => { saveField('codingBaseURL', next) },
              }),
            ] }),
            jsx('label', { className: 'zt_field', children: [
              jsx('span', { className: 'zt_fieldLabel', children: t('paasBaseLabel') }),
              jsx(FieldInput, {
                value: value.paasBaseURL,
                label: t('paasBaseLabel'),
                placeholder: 'https://open.bigmodel.cn/api/paas/v4',
                onCommit: (next: string) => { saveField('paasBaseURL', next) },
              }),
            ] }),
          ] }),
        ] }),
        // Usage & Quota: the public BigModel API exposes no usage endpoints
        // (probed candidates all 404), so the console pages are the
        // authoritative surfaces — the card deep-links to them with the
        // official Button/Icon pair and restates the billing rules as
        // static copy. The discontinued local session-log aggregate left
        // its data-disclaimer note in usageDisclaimer.
        jsx('div', { className: 'zt_usage', children: [
          jsx('p', { className: 'zt_usageTitle', children: t('usageQuotaTitle') }),
          jsx('div', { className: 'zt_usageLinks', children: [
            jsx(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              icon: jsx(primitives.IconRightUpOutline16, {}),
              onClick: () => { openExternal(USAGE_URL) },
              children: t('usageLink'),
            }),
            jsx(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              icon: jsx(primitives.IconRightUpOutline16, {}),
              onClick: () => { openExternal(RATE_LIMITS_URL) },
              children: t('limitsLink'),
            }),
          ] }),
          jsx('p', { className: 'zt_hint', children: t('usageRulesPlan') }),
          jsx('p', { className: 'zt_hint', children: t('usageRulesCredits') }),
          jsx('p', { className: 'zt_hint', children: t('usageRulesApi') }),
          jsx('p', { className: 'zt_disclaimer', children: t('usageDisclaimer') }),
        ] }),
        jsx('div', { className: 'zt_footer', children: saved
          ? jsx('p', { className: 'zt_saved', children: [
              jsx(primitives.IconCheckOutline16, {}),
              t('saved'),
            ] })
          : null }),
      ] }))
    }

    /**
     * Client-side services required before the card can mount. `remote` and
     * its namespaces are provided by api-gateway/connection, not by this
     * plugin: without the declaration cordis resolves them to undefined and
     * the card would silently never load (the exact failure that retired
     * the custom-channel half in the rc.1 upgrade).
     */
    const inject = ['slots', 'connection', 'locale', 'remote', 'remote.credentials', 'remote.settings']

    // The client root context, set by apply(): the card reads the locale and
    // remote services through this accessor rather than a prop (label + copy
    // both follow it; the slot's registration supplies no props).
    let ctxRef: ClientContext | undefined
    function getCtx(): ClientContext | undefined { return ctxRef }

    function apply(ctx: ClientContext): void {
      ctxRef = ctx
      try {
        ctx.effect(() => ctx.locale.register(LOCALE_NS, I18N))
      } catch {
        // The locale service is optional in compositions without it; the
        // card falls back to the browser language table.
      }
      // The official configurable-plugins tab: the card is keyed by the
      // settings namespace it edits, and the tab pairs it with the Host's
      // registered `zhipu-toolkit` namespace — the sidebar entry is gone
      // and the card keeps drawing all of its own internals.
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        id: 'dsh-zhipu-toolkit',
        key: SETTINGS_NAMESPACE,
        order: 30,
        locale: LOCALE_NS,
      }, SettingsCard))
      // Pushed invalidations keep the card honest when the Host, another
      // card, or a CLI write moves the section or the stored key. The card's
      // own reload counter is the bridge: a shared module-scoped setter the
      // SettingsCard installs on mount.
      ctx.effect(() => {
        const disposers: Array<() => void> = []
        const remote = ctx.remote
        if (remote !== undefined && remote.$on !== undefined) {
          for (const event of ['settings/document-updated', 'credentials/reference-updated']) {
            try {
              const dispose = remote.$on(event, () => { bumpReload() })
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch {
              // A host without the pushed-event face simply never refreshes;
              // the card stays correct on the next mount.
            }
          }
        }
        return () => {
          for (const dispose of disposers) dispose()
        }
      }, 'dsh-zhipu-toolkit: pushed invalidations')
    }

    // Reload bridge: the card installs its counter's setter on mount, and the
    // pushed-invalidation effect (registered without card props) calls it.
    let bumpReload: () => void = () => {}
    function installReloadBridge(setter: () => void): () => void {
      bumpReload = setter
      return () => { bumpReload = () => {} }
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    return bundleModule.exports
  },
})
