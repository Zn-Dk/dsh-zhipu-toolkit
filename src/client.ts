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
 * The card reads and writes the `zhipu-toolkit` settings namespace over the
 * `/zhipu-toolkit-settings` connection RPC channel registered by the Host
 * half (see src/settings-rpc.ts), and holds the local API key through the
 * same channel's set-local-key endpoints (stored in the credentials
 * service, never in settings.yaml).
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
  useSyncExternalStore(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => unknown,
    getServerSnapshot?: () => unknown,
  ): unknown
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
}
interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  subscribe(fn: () => void): () => void
  getLocale(): { active: string }
}
interface ConnectionHandle {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>
  }
}
interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): () => void
  locale: LocaleService
  connection: ConnectionHandle
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
    const SETTINGS_CHANNEL = '/zhipu-toolkit-settings'
    const LOCALE_NS = 'zhipu-toolkit'
    const REASONING_TIERS = ['low', 'medium', 'high', 'xhigh', 'max']
    const ENDPOINT_CHOICES = ['coding', 'paas']

    /**
     * Copy table. zh/en key sets are 1:1 (checked by scripts/check-i18n.mjs);
     * placeholders ({name}) must match across languages. Text follows the
     * host locale service — never navigator.language directly — with a
     * browser-language fallback when the service is absent.
     */
    const I18N: Record<'zh' | 'en', Record<string, string>> = {
      zh: {
        nav: '智谱工具箱',
        title: '智谱工具箱',
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
      },
      en: {
        nav: 'Zhipu Toolkit',
        title: 'Zhipu Toolkit',
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
      '@media (prefers-reduced-motion:reduce){.zt_advancedSummary{transition:none}}',
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

    /** Snapshot the RPC get endpoint returns. */
    interface View { value: Record<string, unknown>, revision: number }

    /** Local-key state the local-key endpoints return. */
    interface LocalKeyView { configured: boolean, writable: boolean, masked: string }

    /** Credential-ref shape the bridge resolves: letters, digits, underscores. */
    const ENV_REF_PATTERN = /^[A-Za-z0-9_]*$/

    /**
     * One text field with a local draft: the write RPC fires on blur/Enter
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

    /** The settings card itself (slot component: receives injected props). */
    function SettingsCard(props: { connection?: ConnectionHandle }): unknown {
      const connection = props.connection
      const [view, setView] = react.useState<View | undefined>(undefined)
      const [localKey, setLocalKey] = react.useState<LocalKeyView | undefined>(undefined)
      const [error, setError] = react.useState<string | undefined>(undefined)
      const [readOnly, setReadOnly] = react.useState(false)
      const [saved, setSaved] = react.useState(false)
      const [reload, setReload] = react.useState(0)
      const [editingKey, setEditingKey] = react.useState(false)
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
      const t = (key: string): string => {
        void localeTick
        const table = dictFor(active)
        return table[key] ?? I18N.en[key] ?? key
      }

      react.useEffect(() => {
        if (connection === undefined) return
        let cancelled = false
        setError(undefined)
        connection.rpc.call(SETTINGS_CHANNEL, 'get', {})
          .then(outcome => {
            if (cancelled) return
            if (outcome.ok) {
              setView(outcome.value as View)
              setSaved(false)
            } else {
              setError(outcome.error.message)
            }
          })
          .catch((e: unknown) => { if (!cancelled) setError(String(e)) })
        connection.rpc.call(SETTINGS_CHANNEL, 'local-key', {})
          .then(outcome => {
            if (cancelled) return
            if (outcome.ok) setLocalKey(outcome.value as LocalKeyView)
          })
          .catch(() => { /* the key state stays unknown; the field still works */ })
        return () => { cancelled = true }
      }, [connection, reload])

      const mutate = (ops: Array<{ op: string, path: string[], value?: unknown }>) => {
        if (connection === undefined) return
        connection.rpc.call(SETTINGS_CHANNEL, 'mutate', {
          ops,
          ...(view === undefined ? {} : { expectedRevision: view.revision }),
        })
          .then(outcome => {
            if (outcome.ok) {
              setView(outcome.value as View)
              setSaved(true)
            } else {
              if (outcome.error.code === 'read-only') setReadOnly(true)
              setError(outcome.error.message)
            }
          })
          .catch((e: unknown) => { setError(String(e)) })
      }

      const callLocalKey = (endpoint: 'set-local-key' | 'unset-local-key', payload: unknown) => {
        if (connection === undefined) return
        connection.rpc.call(SETTINGS_CHANNEL, endpoint, payload)
          .then(outcome => {
            if (outcome.ok) {
              setLocalKey(outcome.value as LocalKeyView)
              setSaved(true)
            } else {
              setError(outcome.error.message)
            }
          })
          .catch((e: unknown) => { setError(String(e)) })
      }

      if (connection === undefined) {
        return jsx('div', { className: 'zt_section', children: [
          jsx('h2', { className: 'zt_title', children: t('title') }),
          jsx('p', { className: 'zt_notice', children: t('unloading') }),
        ] })
      }
      if (view === undefined) {
        return jsx('div', { className: 'zt_section', children: [
          jsx('h2', { className: 'zt_title', children: t('title') }),
          error === undefined
            ? jsx('p', { className: 'zt_hint', children: t('unloading') })
            : jsx('p', { className: 'zt_status', children: `${t('loadFailed')}: ${error}` }),
          error === undefined ? null : jsx(primitives.Button, {
            variant: 'outline',
            onClick: () => { setReload(n => n + 1) },
            children: t('retry'),
          }),
        ] })
      }

      const value = view.value
      const disabled = false
      const saveField = (key: string, next: unknown) => {
        mutate([{ op: 'set', path: [key], value: next }])
      }
      const endpoints = String(value.endpoints ?? 'coding')
      const useLocal = value.useLocalApiKey === true

      return jsx('div', { className: 'zt_section', children: [
        jsx('h2', { className: 'zt_title', children: t('title') }),
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
              disabled,
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
                      disabled,
                      label: t('localApiKeyLabel'),
                      placeholder: t('localApiKeyPlaceholder'),
                      type: 'password',
                      onDraftChange: (draft: string) => { keyDraftRef.current = draft },
                      onCommit: (next: string) => {
                        // An empty commit keeps the saved key untouched;
                        // a non-empty value overwrites it in place.
                        if (next.trim().length > 0) {
                          callLocalKey('set-local-key', { value: next })
                          setEditingKey(false)
                        }
                      },
                    }) }),
                  jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('saveHint'),
                    title: t('saveHint'),
                    onClick: () => {
                      // Explicit submit: same guard as blur/Enter — an empty
                      // draft leaves the saved key untouched.
                      const draft = keyDraftRef.current
                      if (draft !== undefined && draft.trim().length > 0) {
                        callLocalKey('set-local-key', { value: draft })
                        keyDraftRef.current = undefined
                        setEditingKey(false)
                      }
                    },
                    children: jsx(primitives.IconCheckOutline16, {}),
                  }),
                  localKey?.configured === true ? jsx('button', {
                    type: 'button',
                    className: 'zt_iconBtn',
                    'aria-label': t('clear'),
                    title: t('clear'),
                    onClick: () => {
                      keyDraftRef.current = undefined
                      callLocalKey('unset-local-key', {})
                      setEditingKey(false)
                    },
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
                    onClick: () => { callLocalKey('unset-local-key', {}) },
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
              disabled,
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
              disabled,
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
                  disabled,
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
                  disabled,
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
                disabled,
                label: t('codingBaseLabel'),
                placeholder: 'https://open.bigmodel.cn/api/coding/paas/v4',
                onCommit: (next: string) => { saveField('codingBaseURL', next) },
              }),
            ] }),
            jsx('label', { className: 'zt_field', children: [
              jsx('span', { className: 'zt_fieldLabel', children: t('paasBaseLabel') }),
              jsx(FieldInput, {
                value: value.paasBaseURL,
                disabled,
                label: t('paasBaseLabel'),
                placeholder: 'https://open.bigmodel.cn/api/paas/v4',
                onCommit: (next: string) => { saveField('paasBaseURL', next) },
              }),
            ] }),
          ] }),
        ] }),
        jsx('div', { className: 'zt_footer', children: saved
          ? jsx('p', { className: 'zt_saved', children: [
              jsx(primitives.IconCheckOutline16, {}),
              t('saved'),
            ] })
          : null }),
      ] })
    }

    /** Client-side services required before the card can mount. */
    const inject = ['slots', 'connection', 'locale']

    // The client root context, set by apply(): the card reads the locale
    // service through this accessor rather than a prop (label + copy both
    // follow it; the slot's inject factory supplies only the connection).
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
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-zhipu-toolkit',
        order: 20.5,
        label: () => dictFor(ctx.locale.getLocale().active).nav,
        locale: LOCALE_NS,
        inject: () => ({ connection: ctx.connection }),
      }, SettingsCard))
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    return bundleModule.exports
  },
})
