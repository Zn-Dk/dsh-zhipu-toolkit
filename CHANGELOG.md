# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
