# zhipu-tools 设计文档

## 背景

给 pi 接入智谱 GLM Coding Plan 的**全部 4 个 MCP 能力**：视觉理解、联网搜索、网页读取、开源仓库。

调研中发现这 4 个 MCP 的传输方式分两类，必须用两种接入方式（详见 [adr/002](adr/002-zhipu-tools-scope-and-dual-impl.md)）：

| MCP | 传输 | 接入方式 |
|-----|------|---------|
| 视觉理解（8 工具） | **stdio（Local）**，`npx -y @z_ai/mcp-server` | 复刻源码 → 纯 HTTP 直调 GLM-4.6V |
| 联网搜索 / 网页读取 / 开源仓库（5 工具） | **HTTP（Remote）**，云端端点 | MCP Streamable HTTP 客户端 |

## 架构

```
                              zhipu-tools 扩展（index.ts）
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
        src/vision/（8 工具）                  src/mcp-http/（5 工具）
   复刻 @z_ai/mcp-server 源码                  MCP Streamable HTTP 客户端
   纯 HTTP 直调 GLM-4.6V API                  调远程 HTTP MCP 端点
                │                                       │
   resolveImage/Video: url 或 base64       client.ts: initialize→session→tools/call
   visionChat: POST chat/completions        每个 endpoint 一个 session（懒初始化+复用）
                │                                       │
                ▼                                       ▼
   open.bigmodel.cn/api/coding/paas/v4      open.bigmodel.cn/api/mcp/{web_search_prime,web_reader,zread}/mcp
```

- **无 stdio 子进程**：vision 是复刻源码后直调 API；mcp-http 是纯 HTTP 调远程端点。
- **共享 key**：两大模块都用 `ZAI_CODING_CN_API_KEY`（coding plan key）鉴权（已实测）。
- **共享 config**：`src/config.ts` 统一管理 key + vision 模型参数 + 3 个 MCP endpoint。

## 配置

环境变量（vision 沿用 `@z_ai/mcp-server` 命名）：

| 变量 | 说明 | 默认 |
|------|------|------|
| `ZAI_CODING_CN_API_KEY` | Coding Plan Key（**推荐**，pi zai-coding-cn provider 用的就是它） | 必填之一 |
| `Z_AI_API_KEY` | 标准平台 Key（备选） | — |
| `Z_AI_BASE_URL` | 强制覆盖 vision 接口前缀 | 按 key 自动选 |
| `Z_AI_VISION_MODEL` | vision 视觉模型 | `glm-4.6v` |
| `Z_AI_VISION_MODEL_TEMPERATURE` / `_TOP_P` / `_MAX_TOKENS` | vision 采样参数 | `0.8` / `0.6` / `32768` |
| `Z_AI_TIMEOUT` | 请求超时 ms | `300000` |

vision 接口按 key 自动选：coding plan key → `coding/paas/v4`；标准 key → `paas/v4`。
mcp-http 的 3 个 endpoint 固定（智谱云端 URL）。

## 工具清单（13 个）

**vision 模块（8，直调 GLM-4.6V）**——见 [adr/001](adr/001-replicate-source-pure-http.md)：

| 工具 | 用途 |
|------|------|
| `analyze_image` | 通用图像理解（兜底） |
| `ui_to_artifact` | UI 截图转 代码/prompt/规范/描述 |
| `extract_text_from_screenshot` | OCR 文字提取（可选语言提示） |
| `diagnose_error_screenshot` | 错误截图诊断 |
| `understand_technical_diagram` | 技术图纸解读 |
| `analyze_data_visualization` | 数据图表分析 |
| `ui_diff_check` | 双图 UI 对比 |
| `analyze_video` | 视频内容理解 |

**mcp-http 模块（5，调远程 HTTP MCP）**——见 [adr/002](adr/002-zhipu-tools-scope-and-dual-impl.md)：

| 工具 | MCP | 用途 |
|------|-----|------|
| `web_search_prime` | search | 联网搜索（标题/URL/摘要） |
| `webReader` | reader | 抓取网页转 markdown/text |
| `search_doc` | zread | 搜索 GitHub 仓库文档/issue/commit |
| `read_file` | zread | 读 GitHub 仓库指定文件 |
| `get_repo_structure` | zread | 获取 GitHub 仓库目录结构 |

## 模块详解

### src/vision/（复刻直调）
- `api.ts`：`visionChat(messages)` —— POST `{base}/chat/completions`，body 带 `model=glm-4.6v` + `thinking:{type:'enabled'}`。
- `media.ts`：`resolveImage/resolveVideo` —— url 直传 / 本地文件转 base64 dataurl（图片≤5MB / 视频≤8MB）。
- `prompts.ts` + `prompts/*.txt`：8 工具的 system prompt，从 `@z_ai/mcp-server` 源码提取（`scripts/sync-prompts.mjs`）。
- `tools.ts`：`registerVisionTools(pi)` —— 注册 8 工具。

### src/mcp-http/（MCP HTTP 客户端）
- `client.ts`：`callTool(endpoint, toolName, args)` —— 极简 MCP Streamable HTTP 客户端。
  每个 endpoint 维护一个 session（首次调用懒 initialize + `notifications/initialized`，之后复用 `Mcp-Session-Id`）。
  响应是 SSE，取最后一条 `data:` 解析。
- `tools.ts`：`registerMcpHttpTools(pi)` —— 静态声明 5 工具（基于实测 `tools/list`，文档已过时）。

**错误处理**：两大模块都遵循 pi 约定——成功 `return { content, details }`；失败 `throw`。

## 已知限制

1. vision prompt 静态复刻自 `@z_ai/mcp-server@0.1.4`，源码更新需跑 `scripts/sync-prompts.mjs` 同步。
2. mcp-http 工具静态声明，智谱更新 HTTP MCP 工具时需重跑 `tools/list` 实测 + 改 `tools.ts`。
3. vision 无自动重试（智谱 API 失败由 agent 决定是否重试）；mcp-http 的 session 过期未做自动重连（首次失败重试即可）。
4. vision 媒体格式限制：图片 jpg/jpeg/png ≤5MB；视频 mp4/mov/m4v/avi/wmv/webm ≤8MB。

## ADR 索引

- [ADR-001](adr/001-replicate-source-pure-http.md)：vision 模块——复刻源码纯 HTTP 直调（而非 MCP bridge）
- [ADR-002](adr/002-zhipu-tools-scope-and-dual-impl.md)：范围扩展为 zhipu-tools + 双实现并存
