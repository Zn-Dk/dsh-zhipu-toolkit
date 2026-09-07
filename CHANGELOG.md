# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Zn-Dk/dsh-zhipu-toolkit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Zn-Dk/dsh-zhipu-toolkit/releases/tag/v0.1.0
