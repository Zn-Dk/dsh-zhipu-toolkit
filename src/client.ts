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
  IconRightUpOutline16: (props: Record<string, unknown>) => unknown
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
    const SETTINGS_CHANNEL = '/zhipu-toolkit-settings'
    const SETTINGS_NAMESPACE = 'zhipu-toolkit'
    const LOCALE_NS = 'zhipu-toolkit'
    const REASONING_TIERS = ['low', 'medium', 'high', 'xhigh', 'max']
    const ENDPOINT_CHOICES = ['coding', 'paas']
    // Official BigModel console deep links: there is no public usage API
    // (probed endpoints all 404), so the console pages are the authoritative
    // surfaces the card can link to.
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
        cardDescription: 'BigModel GLM 双端点模型目录与用量统计',
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
        usageDisclaimer: '本机 session 日志聚合，非账号权威数据；套餐 5 小时/每周限额以 BigModel 控制台为准。',
        usageLocalTitle: '本机 BigModel 路由用量（累计）',
        usageLoading: '正在扫描本机会话日志…',
        usageScanHint: '首次较慢，取决于会话数量；可先离开此页，扫描在宿主后台进行，已扫描文件不会重复扫描，结果会缓存。',
        usageScanDone: '已扫描 {files} 个会话文件，耗时 {seconds} 秒',
        usageEmpty: '本机暂无 GLM 调用记录',
        usageStatInput: '输入 {n}',
        usageStatOutput: '输出 {n}',
        usageCreditsUnit: '积分',
        usageApprox: '近似系数',
        window5h: '5 小时',
        windowToday: '今天',
        windowWeekly: '本周',
        window5hNote: '滚动窗口近似，非官方套餐窗口边界',
        usageEmptyWindow: '该窗口暂无 GLM 调用记录',
        usageUnparsed: '该窗口无可解析时间戳的记录',
      },
      en: {
        title: 'Zhipu Toolkit',
        cardDescription: 'BigModel GLM dual-endpoint model catalog and usage statistics',
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
        usageDisclaimer: 'Aggregated from local session logs — not authoritative account data; the official BigModel console remains the source for the 5-hour/weekly plan quota.',
        usageLocalTitle: 'Local BigModel-routed usage (cumulative)',
        usageLoading: 'Scanning local session logs…',
        usageScanHint: 'The first scan is slow and depends on how many sessions exist; feel free to leave this page — the scan runs in the host background, already-scanned files are never re-scanned, and results are cached.',
        usageScanDone: 'Scanned {files} session files in {seconds}s',
        usageEmpty: 'No local GLM calls on record',
        usageStatInput: 'in {n}',
        usageStatOutput: 'out {n}',
        usageCreditsUnit: 'credits',
        usageApprox: 'approx factors',
        window5h: '5h',
        windowToday: 'Today',
        windowWeekly: 'This week',
        window5hNote: 'Rolling window approximation — not the official plan window boundary',
        usageEmptyWindow: 'No GLM calls in this window',
        usageUnparsed: 'No records in this window carry a parseable timestamp',
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
      '.zt_usageRows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.zt_usageCard{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.zt_usageModel{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.zt_usageTag{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}',
      '.zt_usageCredits{display:flex;align-items:baseline;gap:4px;min-width:0}',
      '.zt_usageCreditsValue{font-size:20px;line-height:26px;font-weight:600;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.zt_usageCreditsUnit{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.zt_usageLine{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.zt_usageTabs{display:inline-flex;gap:2px;padding:2px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);width:fit-content}',
      '.zt_usageTab{appearance:none;border:0;background:none;font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.zt_usageTab:hover{color:var(--dsw-alias-label-primary)}',
      '.zt_usageTabActive{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}',
      '.zt_usageSlice{display:flex;flex-direction:column;gap:8px}',
      '.zt_usageScan{display:flex;flex-direction:column;gap:2px}',
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

    /** Snapshot the RPC get endpoint returns. */
    interface View { value: Record<string, unknown>, revision: number }

    /** Local-key state the local-key endpoints return. */
    interface LocalKeyView { configured: boolean, writable: boolean, masked: string }

    /** One minimal event row of the local usage detail (src/usage-stats.ts shape). */
    interface UsageEventView {
      model: string
      inputTokens: number
      outputTokens: number
      time: number | null
    }

    /** One per-model row of the local usage aggregate (src/usage-stats.ts shape). */
    interface UsageModelRowView {
      model: string
      requests: number
      inputTokens: number
      outputTokens: number
      credits: number
      approximate: boolean
    }

    /**
     * The slice of UsageStatsResult the card renders: events mode carries
     * the client-sliced detail; aggregated mode carries cumulative rows.
     */
    interface UsageView {
      mode: 'events' | 'aggregated'
      events: UsageEventView[]
      models: UsageModelRowView[] | null
      scannedFiles: number
      scanMs: number
    }

    /** Failed/absent scans degrade to this: the block shows its empty state. */
    const EMPTY_USAGE: UsageView = { mode: 'aggregated', events: [], models: [], scannedFiles: 0, scanMs: 0 }

    /** Credential-ref shape the bridge resolves: letters, digits, underscores. */
    const ENV_REF_PATTERN = /^[A-Za-z0-9_]*$/

    /** Compact number forms for the usage rows (stable across locales). */
    const fmtInt = (value: number): string => Math.round(value).toLocaleString('en-US')
    const fmtCredits = (value: number): string => (Math.round(value * 10) / 10).toLocaleString('en-US')

    /**
     * Window slicing over the event detail — pure helpers, also exported on
     * the bundle (`usageView`) so the unit suite drives the shipped code.
     * K/M/B = 1e3/1e6/1e9 with one decimal; "today"/"week" use the local
     * midnight and the local Monday midnight as boundaries.
     */
    type UsageWindowKind = 'h5' | 'today' | 'week'
    const usageWindowSince = (kind: UsageWindowKind, now: number): number => {
      if (kind === 'h5') return now - 5 * 60 * 60 * 1000
      const day = new Date(now)
      day.setHours(0, 0, 0, 0)
      if (kind === 'today') return day.getTime()
      // Monday-start week: getDay() is Sunday=0, so shift by (day+6)%7.
      day.setDate(day.getDate() - (day.getDay() + 6) % 7)
      return day.getTime()
    }
    const fmtCompactTokens = (value: number): string => {
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value < 1e3) return String(Math.round(value))
      if (value < 1e6) return (value / 1e3).toFixed(1) + 'K'
      if (value < 1e9) return (value / 1e6).toFixed(1) + 'M'
      return (value / 1e9).toFixed(1) + 'B'
    }
    const GLM53_FACTORS = { inputPer10k: 6.9, outputPer10k: 24 }
    const FLASH_FACTORS = { inputPer10k: 2.3, outputPer10k: 8 }
    const factorsFor = (model: string): { inputPer10k: number, outputPer10k: number, approximate: boolean } => {
      const id = model.toLowerCase()
      if (id.includes('flash')) return { ...FLASH_FACTORS, approximate: false }
      if (id === 'glm-5.3') return { ...GLM53_FACTORS, approximate: false }
      return { ...GLM53_FACTORS, approximate: true }
    }
    interface UsageSliceRow {
      model: string
      requests: number
      inputTokens: number
      outputTokens: number
      credits: number
      approximate: boolean
    }
    /** Slice the event detail into per-model rows for one window. */
    const sliceUsageEvents = (
      events: readonly UsageEventView[],
      kind: UsageWindowKind,
      now: number,
    ): { rows: UsageSliceRow[], unparsed: boolean } => {
      const since = usageWindowSince(kind, now)
      const rows = new Map<string, UsageSliceRow>()
      let unparsed = false
      for (const event of events) {
        if (event.time === null) {
          unparsed = true
          continue
        }
        if (event.time < since) continue
        const factors = factorsFor(event.model)
        const credits = (event.inputTokens / 10_000) * factors.inputPer10k + (event.outputTokens / 10_000) * factors.outputPer10k
        const row = rows.get(event.model)
          ?? { model: event.model, requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, approximate: false }
        row.requests++
        row.inputTokens += event.inputTokens
        row.outputTokens += event.outputTokens
        row.credits += credits
        row.approximate = row.approximate || factors.approximate
        rows.set(event.model, row)
      }
      return {
        rows: [...rows.values()].sort((a, b) => b.credits - a.credits),
        unparsed,
      }
    }

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
      const [usage, setUsage] = react.useState<UsageView | undefined>(undefined)
      const [error, setError] = react.useState<string | undefined>(undefined)
      const [readOnly, setReadOnly] = react.useState(false)
      const [saved, setSaved] = react.useState(false)
      const [reload, setReload] = react.useState(0)
      const [editingKey, setEditingKey] = react.useState(false)
      // Card-local disclosure: which card the user has open is a reading
      // gesture — the Host and the tab have no stake in it (official
      // PluginCard behavior).
      const [open, setOpen] = react.useState(false)
      // Selected usage window, sliced client-side from the event detail.
      const [usageWindow, setUsageWindow] = react.useState<'h5' | 'today' | 'week'>('today')
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
        // Local usage aggregate: a failed scan — or an older host without
        // the endpoint — degrades to the empty state, never a stuck spinner.
        connection.rpc.call(SETTINGS_CHANNEL, 'usage-stats', {})
          .then(outcome => {
            if (cancelled) return
            setUsage(outcome.ok ? outcome.value as UsageView : EMPTY_USAGE)
          })
          .catch(() => { if (!cancelled) setUsage(EMPTY_USAGE) })
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

      // The local usage panel: events mode slices the 5h/today/week windows
      // client-side from the event detail (null-time events are dropped and
      // only surface through the unparsed empty state); aggregated mode
      // (payload cap hit) falls back to cumulative rows without switching.
      const renderUsageLocal = (): unknown => {
        if (usage === undefined) {
          // Loading is honest about the cold scan: it names the wait, says
          // leaving the page is safe, and notes the host keeps scanning in
          // the background (already-scanned files are never redone).
          return jsx('div', { className: 'zt_usageScan', children: [
            jsx('p', { className: 'zt_hint', children: t('usageLoading') }),
            jsx('p', { className: 'zt_hint', children: t('usageScanHint') }),
          ] })
        }
        const usageCard = (row: { model: string, inputTokens: number, outputTokens: number, credits: number, approximate: boolean }): unknown =>
          jsx('div', { className: 'zt_usageCard', key: row.model, children: [
            jsx('div', { className: 'zt_usageModel', children: row.model }),
            jsx('div', { className: 'zt_usageCredits', children: [
              jsx('span', { className: 'zt_usageCreditsValue', children: (row.approximate ? '≈' : '') + fmtCredits(row.credits) }),
              jsx('span', { className: 'zt_usageCreditsUnit', children: t('usageCreditsUnit') }),
              row.approximate ? jsx('span', { className: 'zt_usageTag', children: t('usageApprox') }) : null,
            ] }),
            jsx('div', { className: 'zt_usageLine', children:
              `${t('usageStatInput', { n: fmtCompactTokens(row.inputTokens) })} · ${t('usageStatOutput', { n: fmtCompactTokens(row.outputTokens) })}` }),
          ] })
        // Real scan telemetry: grounds the user's expectation for the next
        // cold scan instead of a promised duration.
        const scanDone = jsx('p', { className: 'zt_disclaimer', children: t('usageScanDone', {
          files: fmtInt(usage.scannedFiles),
          seconds: (usage.scanMs / 1000).toFixed(1),
        }) })
        if (usage.mode === 'aggregated') {
          const rows = usage.models ?? []
          return jsx('div', { className: 'zt_usageSlice', children: [
            rows.length === 0
              ? jsx('p', { className: 'zt_hint', children: t('usageEmpty') })
              : jsx('div', { className: 'zt_usageRows', children: rows.map(row => usageCard(row)) }),
            scanDone,
          ] })
        }
        const sliced = sliceUsageEvents(usage.events, usageWindow, Date.now())
        return jsx('div', { className: 'zt_usageSlice', children: [
          jsx('div', { className: 'zt_usageTabs', role: 'group', 'aria-label': t('usageLocalTitle'), children:
            (['h5', 'today', 'week'] as const).map(kind => jsx('button', {
              type: 'button',
              key: kind,
              className: usageWindow === kind ? 'zt_usageTab zt_usageTabActive' : 'zt_usageTab',
              'aria-pressed': usageWindow === kind ? 'true' : 'false',
              onClick: () => { setUsageWindow(kind) },
              children: t(kind === 'h5' ? 'window5h' : kind === 'today' ? 'windowToday' : 'windowWeekly'),
            })),
          }),
          usageWindow === 'h5' ? jsx('p', { className: 'zt_hint', children: t('window5hNote') }) : null,
          sliced.rows.length === 0
            ? jsx('p', { className: 'zt_hint', children: sliced.unparsed ? t('usageUnparsed') : t('usageEmptyWindow') })
            : jsx('div', { className: 'zt_usageRows', children: sliced.rows.map(row => usageCard(row)) }),
          scanDone,
        ] })
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

      if (connection === undefined) {
        return shell(jsx('div', { className: 'zt_section', children: [
          jsx('p', { className: 'zt_notice', children: t('unloading') }),
        ] }))
      }
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
      const disabled = false
      const saveField = (key: string, next: unknown) => {
        mutate([{ op: 'set', path: [key], value: next }])
      }
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
        // Usage & Quota: the public BigModel API exposes no usage endpoints
        // (probed candidates all 404), so the console pages are the
        // authoritative surfaces — the card deep-links to them with the
        // official Button/Icon pair and restates the billing rules as
        // static copy. Data disclaimers live in usageDisclaimer.
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
          // Local aggregate from the session logs (read-only `usage-stats`
          // endpoint, 60s host-side cache, data never leaves the machine).
          renderUsageLocal(),
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
        inject: () => ({ connection: ctx.connection }),
      }, SettingsCard))
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    // Pure usage-view helpers, exported so the unit suite drives the exact
    // shipped slicing/formatting code (no reimplementation drift).
    bundleModule.exports.usageView = {
      windowSince: usageWindowSince,
      fmtCompactTokens,
      sliceUsageEvents,
    }
    return bundleModule.exports
  },
})
