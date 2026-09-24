# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-24

### 变更 / Changed（破坏性，适配 DSH 0.1.5-rc.1）

- **Client 半迁移到官方 Remote 架构**：设置卡片不再经自建 `connection.rpc` 通道（`/zhipu-toolkit-settings`）与 Host 通信，改走 api-gateway 暴露的 `ctx.remote.settings` / `ctx.remote.credentials`（`/api` 单通道）。自建通道在 rc.1 下每个调用都会落到静态资源 fallback 返回 HTTP 405（`transport failure …: HTTP 405`），根因是插件 ctx 未声明 `webServer` 服务时 cordis reflect proxy 抛错、异常被 effect runner 静默吞掉。`dsh.client.inject` 增加 `@deepseek-ai/dsh-api-remotes`，卡片依赖声明补齐 `remote` / `remote.credentials` / `remote.settings`。
- **读取形状修正**：`settings.describe()` 的 value 是 `{ namespaces: [...] }` 包装对象（不是裸数组）、`credentials.describe()` 的 value 是按引用键控的 map（不是数组）——已按官方 `dsh-llm-stepfun` 同款写法修正，并写进测试断言防回归。
- **修复 provider 调用即崩**：`ResolvedPiAiProviderProfile` 在 rc.1 新增必需字段 `modelErrors`（`llm-pi-ai` adapter 无守卫消费 `profile.modelErrors.get(model)`），本插件构造 profile 时补 `modelErrors: new Map()`（自建模型目录，无 per-model 失败可申报）。修复前症状：Models 页能列出 BigModel，一选模型调用就 `Cannot read properties of undefined (reading 'get')`。
- **移除本机用量统计面板**（`usage-stats`）：`ctx.remote.*` 架构下没有自定义聚合数据的通道，且官方 console 才是权威来源。原「用量与额度」区块保留两个官方 console 深链（Coding Plan 用量统计、速率限制）+ 静态计费规则说明 + 「以官方控制台为准」的免责说明。
- **删除 `settings-rpc.ts`**（206 行 RPC 桥）与 `usage-stats.ts`（490 行会话日志聚合）及其单测；Host 半 `settings.installSection`、双端点路由、实时模型发现、本地 key 模式**均无改动**。

### 迁移提示 / Migration

- 依赖 DSH **≥ 0.1.5-rc.1**（0.1.2 及更早版本的自建通道已不可用）。
- settings namespace `zhipu-toolkit` 与既有配置**完全兼容**，`~/.dsh/settings.yaml` 无需改动；凭据引用、本地 API key、Base URL、推理档原样保留。

## [0.2.1] - 2026-09-09

### 变更 / Changed

- 设置卡片从侧栏独立导航项迁移到官方「设置 → 插件」配置 tab：卡片改挂 `settings.plugin.item` keyed slot（以 settings namespace `zhipu-toolkit` 为键，宿主按 namespace 与已注册设置节配对枚举），与其他可配置插件并列；侧栏不再有独立入口。卡片自带与官方 PluginCard 对齐的折叠外壳（`<li>` 卡壳 + 标题/描述头部按钮 `aria-expanded` + chevron 旋转开合，内容默认收起）；卡片内部控件（本地 key、用量统计、深链）与 Host 侧 settings 注册零改动。

## [0.2.0] - 2026-09-08

### 新增 / Added

- 本机 BigModel 路由用量统计：聚合本机 DSH session 日志（`~/.dsh/sessions/**/session.jsonl.zstd` 多帧 zstd 按魔数切帧逐帧解码，坏帧容错跳过；裸 `.jsonl` 兼容），按模型汇总请求数与 token（输入含 uncached + cacheRead + cacheWrite），并按官方 BigModel 系数折算积分（GLM-5.3 in 6.9 / out 24、GLM-5.3-Flash in 2.3 / out 8 每万 token；其余 glm-* 借 5.3 系数并标注近似）；附最近 5 小时窗口（仅统计带时间戳的事件，无时间戳保守只给累计值）。数据只在本机聚合与展示，绝无外发。经真实日志验证：729 个会话文件、20628 次请求、坏帧 0。
- 「用量与额度」设置区块：官方 console 深链按钮（Coding Plan 用量统计、速率限制，官方 Button/Icon，`window.open` noopener 新开标签）+ 静态计费规则说明（套餐 5 小时/每周双限额、非高峰 5 折、积分系数、普通 API 按 token 计费）+ 权威数据以 console 为准的免责说明。
- glm-5.3-flash 图像输入支持：官方文档证实 GLM-5.3-Flash 为原生多模态（输入=视频/图像/文本/文件），`glm-5.3-flash` 目录条目 `input` 置 `['text', 'image']`（pi-ai 的 `Model["input"]` 类型暂只认 text/image，视频/文件输入待类型支持后开放）；其余受维护模型保持纯文本。
- 只读 `usage-stats` RPC 端点（`/zhipu-toolkit-settings` 通道，依赖注入式接线，未接线部署返回 typed `unavailable`）。

### 优化 / Changed

- 用量扫描状态可见化：加载态双语明确「首次约 30 秒，可先离开此页稍后回来；扫描在宿主后台进行，已扫描的文件不会重复扫描」。
- Host 启动后台预扫（fire-and-forget，不阻塞插件装配）+ 60 秒结果缓存 + 按文件增量缓存（size+mtime 失效键）：实测重扫已扫描集合仅 ~36ms（冷扫 729 文件约 29s），重开设置页通常秒出结果。
- 用量数字排版卡片化：每模型一张紧凑卡片（2 列网格、tabular-nums 等宽数字），近似系数以小徽章标注在模型名旁；设置卡整体样式与宿主一致（`--dsw-alias-*` 令牌）。
- 大文件保护：超过 10MB 的会话文件跳过并告警；扫描文件数上限 1500，并发 3。

## [0.1.0] - 2026-09-07

### 新增 / Added

- Zhipu BigModel GLM provider route covering both BigModel endpoints with one served at a time (`endpoints: coding | paas`, default `coding`): the Coding Plan endpoint (`zai`, subscription billing) or the ordinary OpenAPI endpoint (`zhipu`, per-token billing); both expose identical model lists and parameter behavior, so the choice is purely the billing channel.
- Self-maintained GLM chat-family catalog (GLM-4.5, GLM-4.5-Air, GLM-4.6, GLM-4.7, GLM-5, GLM-5-Turbo, GLM-5.1, GLM-5.2, GLM-5.3, GLM-5.3-Flash) with verified context windows and output caps, overlaid on pi-ai's builtin catalog through a map-carrying-descriptor-wins merge.
- Verified GLM-5.3-series thinking semantics: `off`/`minimal` removed from the picker, `low`/`medium`/`high` collapse onto the `high` wire tier, `xhigh`/`max` unlock `max`; profile defaults to the configured tier (`low`) so effort-undefined requests never wire `thinking: disabled` (API error 1210).
- Verified compat flags for both endpoints: `supportsReasoningEffort: true`, `maxTokensField: 'max_tokens'`, `thinkingFormat: 'zai'`, `zaiToolStream: true`.
- Live model discovery over `/models` at startup, after credential updates, and after every committed settings change; directly-verified models (`glm-5.3`, `glm-5.3-flash`) survive endpoint lag.
- Local API key mode (`useLocalApiKey`): hold the key on the settings card through the credentials service (stored as `ZHIPU_TOOLKIT_API_KEY`, never in settings.yaml), with the env-reference path as fallback; writing the key re-runs live discovery immediately. A saved key shows as a masked summary (last characters only) with official-icon actions — edit-in-place (new value overwrites on blur/Enter; empty keeps the saved one), visibility toggle, and clear.
- Hot-reloadable `zhipu-toolkit` settings namespace (composition entry as base layer, `~/.dsh/settings.yaml` user layer) with write-time serviceability validation.
- Web settings card (`settings.section` slot, titled "Zhipu Toolkit" / 「智谱工具箱」) over a whitelisted `/zhipu-toolkit-settings` RPC bridge: endpoint choice with per-channel billing help, display name, default reasoning tier, credential refs with env-name validation, local API key password field with show/hide/clear, and advanced base-URL overrides; bilingual (zh-CN/en) copy following the host locale service.
- Invariant companion (`dsh-zhipu-toolkit-invariant`) asserting every maintained thinking-level map routes offered tiers into the verified wire whitelist.

### 变更 / Changed

- `endpoints: both` is no longer accepted (schema rejects it): a deployment serves exactly one billing channel.

[Unreleased]: https://github.com/Zn-Dk/dsh-zhipu-toolkit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Zn-Dk/dsh-zhipu-toolkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Zn-Dk/dsh-zhipu-toolkit/releases/tag/v0.1.0
