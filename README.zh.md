# dsh-zhipu-toolkit

[English](./README.md) | **简体中文**

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，把智谱 BigModel GLM 全家族注册为模型提供方路由——覆盖 **两个** BigModel 端点、同一时间服务其一：Coding Plan 端点（`zai`）或普通 OpenAPI 端点（`zhipu`），附带实时模型发现、卡片内本地 API key 与 Web 设置卡片。

## 特性

- **端点二选一（计费通道）** — 服务 Coding Plan 端点或普通 API 端点；两者暴露的模型与请求语义完全一致，选择只取决于账户走哪个计费通道。
- **自维护 GLM 目录** — 完整 GLM 对话家族（GLM-4.5 → GLM-5.3-Flash），上下文窗口与输出上限经过验证，叠加在 pi-ai 内置目录之上。
- **经过验证的 GLM-5.3 思考语义** — GLM-5.3 系列模型始终思考；插件把选择器档位映射到 API 接受的线上取值（`low`/`medium`/`high` → `high`，`xhigh`/`max` → `max`），绝不发送 `thinking: disabled`（API 以错误 1210 拒绝）。
- **实时模型发现** — 启动时以及每次设置/凭据变更后轮询 `/models`；端点停发的模型自动移出，直连验证过的模型在端点滞后时保留。
- **卡片内本地 API key** — 可选在卡片上直接保存 key（存入 dsh 凭证库 `ZHIPU_TOOLKIT_API_KEY`，绝不写入 settings.yaml）；已保存的 key 以掩码摘要显示（仅末几位）并配图标按钮原地编辑或清除，环境变量引用路径保留为回退。
- **设置卡片（Web GUI）** — `settings.section` 卡片通过白名单 RPC 桥编辑端点、凭据引用、显示名、默认推理档与本地 API key；配置热更新（无需重启）。
- **双语界面** — 卡片跟随宿主 locale 服务（zh-CN / en），locale 服务不可用时回退浏览器语言。

## 安装

```sh
dsh plugin --profile web add dsh-zhipu-toolkit
```

开发期间也可以从打包的 tarball 安装：

```sh
npm pack
dsh plugin --profile web add ./dsh-zhipu-toolkit-<version>.tgz
```

安装后必须重启 `dsh web`（client bundle 与宿主插件树在启动时组装）。

## 配置

插件拥有 `zhipu-toolkit` 设置命名空间。与其他 DSH 设置命名空间一样分层：组合条目（见下）是基础层，用户修改——来自 Web 设置卡片或 `~/.dsh/settings.yaml`——覆盖其上。提交的写入立即重解析路由，无需重启。

```yaml
# ~/.dsh/settings.yaml
zhipu-toolkit:
  endpoints: coding         # coding | paas（同一时间一个计费通道）
  codingApiKeyEnv: BIGMODEL_API_KEY
  paasApiKeyEnv: ZHIPU_API_KEY
  displayName: BigModel
  defaultReasoningTier: low # low | medium | high | xhigh | max
  useLocalApiKey: false     # true = 在设置卡片上保存 key
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `endpoints` | `coding` | 服务哪个计费通道（见下方「端点」）。 |
| `codingApiKeyEnv` | `BIGMODEL_API_KEY` | Coding Plan 路由的凭据引用。 |
| `paasApiKeyEnv` | `ZHIPU_API_KEY` | 普通路由的凭据引用。 |
| `displayName` | `BigModel` | 模型选择器中的提供方名称。 |
| `defaultReasoningTier` | `low` | 未指定 effort 的请求所用的档位。 |
| `useLocalApiKey` | `false` | 本地保存 API key（凭证库）而非环境变量引用。 |
| `codingBaseURL` | `https://open.bigmodel.cn/api/coding/paas/v4` | 代理/网关覆盖。 |
| `paasBaseURL` | `https://open.bigmodel.cn/api/paas/v4` | 代理/网关覆盖。 |
| `streamIdleTimeoutMs` | `300000` | 单次流读取的最大提供方空闲时间。 |
| `maxRequestImageBytes` | `20971520` | 单请求 Base64 图片负载上限。 |
| `requestImagePixelBudget` | `4194304` | 每个内联图片版本的总像素预算。 |
| `requestImageMaxBytes` | `1048576` | 每个内联图片版本的编码字节上限。 |

API key 有两种提供方式：

- **环境变量引用（默认）** — 通过凭证服务把 key 存到类环境变量名下（`BIGMODEL_API_KEY` / `ZHIPU_API_KEY` 或你配置的名字）：`dsh credentials set BIGMODEL_API_KEY`。
- **本地 key（卡片）** — 打开 `useLocalApiKey`，把 key 粘贴进卡片的密码框。它存入 dsh 凭证库 `ZHIPU_TOOLKIT_API_KEY`（绝不写入 settings.yaml），立即生效；未设置时回退到环境变量引用。已保存的 key 显示掩码摘要（如 `••••••••abcd`）；点编辑图标重新打开输入框，新值失焦/回车即覆盖保存（留空则保持原值不动），点清除图标删除。

## 端点

两个端点暴露 **完全一致的模型列表与参数行为**（2026-09-06 实测：两 `/models` 同 10 个对话模型；`thinking`/`reasoning_effort: max` 行为一致）。区别仅在计费：

| 路由 id | 端点 | 计费 |
|---|---|---|
| `zai` | `https://open.bigmodel.cn/api/coding/paas/v4` | Coding Plan：套餐积分制（Lite/Pro/Max），5 小时+每周双限额，耗尽后等周期恢复、不扣余额；非高峰时段 5 折；场景限官方编码工具。 |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | 普通 API：按 token 计费（资源包/余额），无场景限制。 |

部署选择账户计费的那一个；插件只服务该单一路由。

## 推理档位

GLM-5.3 系列模型 **无法关闭思考** —— API 以错误 1210 拒绝 `thinking: disabled`。因此插件：

- 为 GLM-5.3 / GLM-5.3-Flash 从选择器中移除 `off`（与 `minimal`）；
- 把 `low`/`medium`/`high` 映射到 `high` 线上档，`xhigh`/`max` 映射到 `max`；
- 把 profile 默认档设为配置档位（默认提供最低档 `low`），保证未指定 effort 的请求合法。

其余维护模型保留 pi-ai 内置档位映射。完整可选档位集合为 `low | medium | high | xhigh | max`。

## 故障排查

- **`no API key for provider route ...`** — 任何路径都没存 key。存环境变量引用（`dsh credentials set <ENV>`），或打开 `useLocalApiKey` 在卡片上粘贴 key。
- **选择器里缺模型** — 实时发现按端点 `/models` 的返回过滤。直连验证过的模型（`glm-5.3`、`glm-5.3-flash`）在端点滞后时保留；其余必须由端点报告。检查插件日志中的 `live refresh failed; keeping the maintained catalog`。
- **错误 1210（`请使用 low、high 或 max`）** — 请求试图在 GLM-5.3 系列模型上关闭思考。把默认推理档保持在 `low` 及以上；不要选择 `off`。
- **设置卡片显示只读** — 当前部署的设置文档只读（如托管 profile）；请改为编辑组合条目。
- **卡片不出现** — 确认安装后重启过 `dsh web`，且插件已加载（`dsh plugin list`）。

## 致谢

- 目录设计、GLM-5.3 思考档位映射、compat 标志与 append 覆盖合并语义均取自 [dsh-bigmodel-catalog](https://github.com/Zn-Dk/dsh-bigmodel-catalog)（提交 `d8189e3`），2026-09-06 对两个 BigModel 端点做过实测验证——包括 `reasoning_effort: max` 与 `max_tokens: 131072` 的往返以及 SSE `reasoning_content`。
- 消息转换与提供方装配基于 [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)。

## 许可证

[MIT](./LICENSE)
