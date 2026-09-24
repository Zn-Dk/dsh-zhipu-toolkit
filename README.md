# dsh-zhipu-toolkit

**English** | [简体中文](./README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that registers the Zhipu BigModel GLM family as a model-provider route — covering **both** BigModel endpoints with one served at a time: the Coding Plan endpoint (`zai`) or the ordinary OpenAPI endpoint (`zhipu`), with live model discovery, a locally-holdable API key, and a Web settings card.

## Features

- **Endpoint choice (one of two billing channels)** — serve the Coding Plan endpoint or the ordinary API endpoint; both expose the same models and the same request semantics, so the choice is purely which billing channel your account uses.
- **Self-maintained GLM catalog** — the full GLM chat family (GLM-4.5 → GLM-5.3-Flash) with verified context windows and output caps, overlaid on pi-ai's builtin catalog.
- **glm-5.3-flash native multimodality (image input enabled)** — the official docs list GLM-5.3-Flash input as video, image, text, and file (multiple `image_url` parts in `messages[].content[]`, URL or Base64); pi-ai's `Model["input"]` type only knows `text`/`image` today, so image input ships first and video/file input stays pending until the type grows those modes, while every other maintained model remains text-only.
- **Usage & quota (console deep links)** — BigModel exposes no public usage API, so the card deep-links straight to the official console's Coding Plan usage and rate-limit pages and restates the billing rules as static copy (5-hour + weekly dual limits, 50% off off-peak, credit factors, per-token billing for the ordinary API); the console remains the source of truth.
- **Verified GLM-5.3 thinking semantics** — GLM-5.3-series models always think; the plugin maps picker tiers onto the wire values the API accepts (`low`/`medium`/`high` → `high`, `xhigh`/`max` → `max`) and never wires `thinking: disabled` (the API refuses it with error 1210).
- **Live model discovery** — `/models` is polled at startup and after every settings/credential change; models the endpoint stopped serving drop out, while directly-verified models survive endpoint lag.
- **Local API key on the settings card** — optionally hold the key right on the card (stored in the dsh credentials store as `ZHIPU_TOOLKIT_API_KEY`, never in settings.yaml); a saved key shows as a masked summary (last characters only) with icon actions to edit-in-place or clear, and the env-reference path stays as fallback.
- **Settings card (Web GUI)** — the card lives in the official **Settings → Plugins** configuration tab (a `settings.plugin.item` slot keyed by the settings namespace, alongside the other configurable plugins) and edits the endpoint, credential refs, display name, default reasoning tier, and the local API key through the official `ctx.remote.settings` / `ctx.remote.credentials` Remote surface; configuration is hot-reloadable (no restart).
- **Bilingual UI** — the card follows the host locale service (zh-CN / en) with a browser-language fallback.

## Install

```sh
dsh plugin --profile web add dsh-zhipu-toolkit
```

Or install from a packed tarball during development:

```sh
npm pack
dsh plugin --profile web add ./dsh-zhipu-toolkit-<version>.tgz
```

Restart `dsh web` after installing (client bundles and the host plugin tree are assembled at startup).

## Configuration

The plugin owns the `zhipu-toolkit` settings namespace. Layered like every DSH settings namespace: the composition entry (below) is the base layer, and user edits — from the Web settings card or `~/.dsh/settings.yaml` — override it. Committed writes re-resolve the routes without a restart.

```yaml
# ~/.dsh/settings.yaml
zhipu-toolkit:
  endpoints: coding         # coding | paas (one billing channel at a time)
  codingApiKeyEnv: BIGMODEL_API_KEY
  paasApiKeyEnv: ZHIPU_API_KEY
  displayName: BigModel
  defaultReasoningTier: low # low | medium | high | xhigh | max
  useLocalApiKey: false     # true = hold the key on the settings card
```

| Field | Default | Notes |
|---|---|---|
| `endpoints` | `coding` | Which billing channel to serve (see Endpoints below). |
| `codingApiKeyEnv` | `BIGMODEL_API_KEY` | Credential reference for the Coding Plan route. |
| `paasApiKeyEnv` | `ZHIPU_API_KEY` | Credential reference for the ordinary route. |
| `displayName` | `BigModel` | Provider label shown in model selectors. |
| `defaultReasoningTier` | `low` | Tier wired for requests that name no effort. |
| `useLocalApiKey` | `false` | Hold the API key locally (credentials store) instead of an env ref. |
| `codingBaseURL` | `https://open.bigmodel.cn/api/coding/paas/v4` | Override for proxies/gateways. |
| `paasBaseURL` | `https://open.bigmodel.cn/api/paas/v4` | Override for proxies/gateways. |
| `streamIdleTimeoutMs` | `300000` | Max provider idle time per stream read. |
| `maxRequestImageBytes` | `20971520` | Base64 image payload bound per request. |
| `requestImagePixelBudget` | `4194304` | Total-pixel budget per inline image version. |
| `requestImageMaxBytes` | `1048576` | Encoded-byte cap per inline image version. |

Two ways to provide the API key:

- **Env reference (default)** — store the key under the env-var-like reference (`BIGMODEL_API_KEY` / `ZHIPU_API_KEY`, or whichever you configured) through the credentials service: `dsh credentials set BIGMODEL_API_KEY`.
- **Local key (card)** — switch `useLocalApiKey` on and paste the key into the card's password field. It is stored in the dsh credentials store as `ZHIPU_TOOLKIT_API_KEY` (never in settings.yaml), takes effect immediately, and falls back to the env reference if unset. A saved key displays as a masked summary (e.g. `••••••••abcd`); the edit icon re-opens the input so a new value overwrites the saved one on blur/Enter (an empty edit leaves it untouched), and the clear icon removes it.

## Endpoints

The two endpoints expose **identical model lists and parameter behavior** (verified live 2026-09-06: both `/models` return the same 10 chat models; `thinking`/`reasoning_effort: max` behave identically). The difference is billing:

| Route id | Endpoint | Billing |
|---|---|---|
| `zai` | `https://open.bigmodel.cn/api/coding/paas/v4` | Coding Plan: subscription quota (Lite/Pro/Max), 5-hour + weekly dual limits that reset with the window and never touch the balance; 50% discount off-peak; scoped to official coding tools. |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | Ordinary API: per-token billing (resource packs / balance), no scene restriction. |

A deployment picks the one its account is billed on; the plugin serves that single route.

## Reasoning tiers

GLM-5.3-series models **cannot turn thinking off** — the API rejects `thinking: disabled` with error 1210. The plugin therefore:

- removes `off` (and `minimal`) from the picker for GLM-5.3 / GLM-5.3-Flash;
- maps `low`/`medium`/`high` onto the `high` wire tier and `xhigh`/`max` onto `max`;
- defaults the profile to the configured tier (lowest offered, `low`) so effort-undefined requests stay valid.

All other maintained models keep pi-ai's builtin tier maps. The full offered picker set is `low | medium | high | xhigh | max`.

## Troubleshooting

- **`no API key for provider route ...`** — no key is stored on any path. Store the env reference (`dsh credentials set <ENV>`), or switch `useLocalApiKey` on and paste the key on the card.
- **Models missing from the picker** — live discovery filters against what the endpoint's `/models` reports. Directly-verified models (`glm-5.3`, `glm-5.3-flash`) survive endpoint lag; everything else must be reported by the endpoint. Check the plugin logs for `live refresh failed; keeping the maintained catalog`.
- **Error 1210 (`请使用 low、high 或 max`)** — a request tried to disable thinking on a GLM-5.3-series model. Keep the default reasoning tier at `low` or above; do not select `off`.
- **Settings card shows "read-only"** — the deployment's settings document is read-only (e.g. a managed profile); edit the composition entry instead.
- **Card never appears** — confirm `dsh web` was restarted after install, and that the plugin loaded (`dsh plugin list`).

## Credits

- The catalog design, the GLM-5.3 thinking-level mapping, the compat flags, and the append-override merge semantics are derived from [dsh-bigmodel-catalog](https://github.com/Zn-Dk/dsh-bigmodel-catalog) (commit `d8189e3`), verified live against both BigModel endpoints on 2026-09-06 — including `reasoning_effort: max` and `max_tokens: 131072` round-trips with SSE `reasoning_content`.
- Message conversion and provider plumbing ride on [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai).

## License

[MIT](./LICENSE)
