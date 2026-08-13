# zhipu-tools — 智谱 GLM Coding Plan 工具集

给 pi 接入智谱 GLM Coding Plan 的**全部 4 类能力**（共 13 个工具）：视觉理解、联网搜索、网页读取、开源仓库。

**特点**：按智谱 MCP 的传输方式分两个模块，各用最自然的接入方式——

- **vision（8 工具）**：智谱视觉 MCP 是 stdio 本地的，**复刻其源码纯 HTTP 直调 GLM-4.6V**（不走 MCP、不 spawn 子进程）。
- **mcp-http（5 工具）**：搜索/网页/仓库 MCP 是远程 HTTP MCP，**用 MCP HTTP 客户端直接调用**（它们本身就是 HTTP 端点）。

两大模块都复用你的 Coding Plan Key（`ZAI_CODING_CN_API_KEY`）——已配 pi 默认模型 `zai-coding-cn/glm-5.2` 的话直接可用，无需另配。

> 与 `@z_ai/mcp-server` 的关系：vision 模块是它的「纯 HTTP 复刻版」（工具名/参数/prompt 完全一致）；mcp-http 模块则是用 MCP 协议调它的 3 个兄弟 server。详见 [ADR-001](docs/design/adr/001-replicate-source-pure-http.md)、[ADR-002](docs/design/adr/002-zhipu-tools-scope-and-dual-impl.md)。

## 快速开始

```bash
# 1. 配 Key（若已配 pi 默认模型 zai-coding-cn/glm-5.2 则跳过——同一个 key）
export ZAI_CODING_CN_API_KEY=你的智谱CodingPlanKey

# 2. 注册扩展：在 ~/.pi/agent/settings.json 的 extensions 数组加
#    "D:/code/workspace/pi-harness-101/extensions/zhipu-tools/index.ts"

# 3. reload（/reload）。启动会提示：
#    "zhipu-tools 就绪：13 个工具已注册（8 视觉 + 5 搜索/网页/仓库）"
```

**不用记命令**——这些是工具，不是 `/` 命令。你用自然语言说需求，agent 自动选合适的工具。

## 怎么用（场景示例）

### 视觉（vision）——给图/视频，说要分析什么

图片来源支持**本地文件路径**或 **http(s) URL**，本地文件自动转 base64。

```text
# 看图理解
帮我看看这张截图里是什么  D:/screenshots/error.png
→ agent 调 analyze_image

# UI 截图转代码
把这张设计稿转成 React + Tailwind 代码  design.png
→ agent 调 ui_to_artifact（output_type=code）

# OCR 提取代码
把这张截图里的 Python 代码提取出来  code.png
→ agent 调 extract_text_from_screenshot（programming_language=python）

# 错误诊断
这个报错截图怎么回事，怎么修  error.png
→ agent 调 diagnose_error_screenshot

# 技术图解读
解读一下这张架构图  arch.png
→ agent 调 understand_technical_diagram

# 数据图表分析
这张图表说明了什么趋势  chart.png
→ agent 调 analyze_data_visualization

# UI 对比（两张图）
对比一下设计稿 design.png 和实现截图 impl.png 的差异
→ agent 调 ui_diff_check（expected + actual 两张图）

# 视频理解
这段视频 demo.mp4 讲了什么
→ agent 调 analyze_video
```

### 联网搜索（web_search_prime）

```text
搜一下 "pi coding agent" 最新的资料
→ agent 调 web_search_prime（search_query）

只搜 github.com 上的、最近一周的
→ agent 调 web_search_prime（search_domain_filter + search_recency_filter）
```

### 网页读取（webReader）

```text
帮我读一下 https://pi.dev 这个网页的内容
→ agent 调 webReader（url）
```

### 开源仓库（zread）——读 GitHub 仓库

```text
看一下 earendil-works/pi 这个仓库的目录结构
→ agent 调 get_repo_structure（repo_name）

读一下 vitejs/vite 的 src/index.ts 文件
→ agent 调 read_file（repo_name + file_path）

搜一下 facebook/react 仓库里关于 hooks 的文档和 issue
→ agent 调 search_doc（repo_name + query）
```

## 工具一览（13 个）

### vision 模块（8，直调 GLM-4.6V）

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `analyze_image` | 通用图像理解（兜底，其他不适用时用） | image_source, prompt |
| `ui_to_artifact` | UI 截图转 代码/prompt/规范/描述 | image_source, **output_type**(code/prompt/spec/description), prompt |
| `extract_text_from_screenshot` | OCR 文字提取（代码/终端/文档） | image_source, prompt, programming_language? |
| `diagnose_error_screenshot` | 错误截图诊断（根因+修复） | image_source, prompt |
| `understand_technical_diagram` | 技术图纸解读（架构图/UML/ER） | image_source, prompt |
| `analyze_data_visualization` | 数据图表分析（趋势/异常/建议） | image_source, prompt |
| `ui_diff_check` | 双图 UI 对比（设计 vs 实现） | expected_image_source, actual_image_source, prompt |
| `analyze_video` | 视频内容理解（≤8MB） | video_source, prompt |

### mcp-http 模块（5，调远程 HTTP MCP）

| 工具 | MCP | 用途 | 关键参数 |
|------|-----|------|---------|
| `web_search_prime` | search | 联网搜索 | search_query, search_domain_filter?, search_recency_filter?, content_size?, location? |
| `webReader` | reader | 抓取网页转 markdown/text | url, return_format?, retain_images?, with_links_summary? ... |
| `search_doc` | zread | 搜索 GitHub 仓库文档/issue/commit | repo_name, query, language? |
| `read_file` | zread | 读 GitHub 仓库指定文件 | repo_name, file_path |
| `get_repo_structure` | zread | 获取 GitHub 仓库目录结构 | repo_name, dir_path? |

## 配置

全部通过环境变量（vision 沿用 `@z_ai/mcp-server` 的命名，可直接迁移）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ZAI_CODING_CN_API_KEY` | — | **Coding Plan Key（推荐）**。pi 的 `zai-coding-cn` provider 用的就是它 |
| `Z_AI_API_KEY` | — | 标准平台 Key（备选） |
| `Z_AI_BASE_URL` | 自动 | 强制覆盖 vision 接口前缀 |
| `Z_AI_VISION_MODEL` | `glm-4.6v` | vision 视觉模型 |
| `Z_AI_VISION_MODEL_TEMPERATURE` | `0.8` | 采样温度 |
| `Z_AI_VISION_MODEL_TOP_P` | `0.6` | top_p |
| `Z_AI_VISION_MODEL_MAX_TOKENS` | `32768` | 最大输出 token |
| `Z_AI_TIMEOUT` | `300000` | 请求超时 ms |

**接口自动选择**：
- 用 `ZAI_CODING_CN_API_KEY`（coding plan）→ vision 走 `open.bigmodel.cn/api/coding/paas/v4`
- 用 `Z_AI_API_KEY`（标准）→ vision 走 `open.bigmodel.cn/api/paas/v4`
- mcp-http 的 3 个 endpoint 固定（智谱云端 URL），都用同一个 key 鉴权

vision 请求固定带 `thinking: { type: "enabled" }`（启用 glm-4.6v 思考模式）。

## 两个模块怎么工作

### vision —— 复刻源码，纯 HTTP 直调

智谱「视觉理解 MCP」是 **stdio 本地 server**（`npx -y @z_ai/mcp-server`），底层就是 fetch 调 GLM-4.6V API。
本模块**复刻它的源码**（8 工具的 system prompt + 调用逻辑），在扩展内直接 HTTP 调智谱服务器：

```
agent → pi 工具 → resolveImage(url 或本地→base64) → POST chat/completions(model=glm-4.6v) → 结果
```

- prompt 原样复刻自 `@z_ai/mcp-server@0.1.4`（`scripts/sync-prompts.mjs` 从源码提取）
- 无 MCP 协议、无子进程——纯 Node fetch（零运行时依赖）

### mcp-http —— MCP HTTP 客户端，调远程端点

智谱「搜索/网页/仓库 MCP」是 **远程 HTTP MCP**（云端，本身即 HTTP 端点）。本模块实现一个极简
MCP Streamable HTTP 客户端，用 MCP 协议调用：

```
agent → pi 工具 → callTool: initialize→拿 session→tools/call → 远程 MCP 端点 → 结果
```

- 每个 endpoint 维护一个 session（首次调用懒初始化，之后复用）
- 响应是 SSE，取最后一条 `data` 解析
- 工具名/schema 基于**实测 `tools/list`**（文档已过时，如文档写 `webSearchPrime`，实测是 `web_search_prime`）

## 限制

- **vision prompt 静态复刻**自 `@z_ai/mcp-server@0.1.4`；源码更新需跑 `scripts/sync-prompts.mjs` 同步。
- **mcp-http 工具静态声明**；智谱更新 HTTP MCP 工具时需重跑 `tools/list` 实测 + 改 `src/mcp-http/tools.ts`。
- vision 无自动重试（API 失败由 agent 决定是否重试）；mcp-http 的 session 过期未做自动重连（重试即可）。
- vision 媒体格式：图片 jpg/jpeg/png ≤5MB；视频 mp4/mov/m4v/avi/wmv/webm ≤8MB。

## 开发

- **无构建步骤**（pi 经 jiti 直接加载 TypeScript），改完 `/reload` 热加载。
- 测试：
  ```bash
  cd extensions/zhipu-tools
  node ../../web-console/node_modules/tsx/dist/cli.mjs test/smoke.ts       # vision
  node ../../web-console/node_modules/tsx/dist/cli.mjs test/mcp-http.ts    # mcp-http
  ```
- 同步 vision prompt：`node extensions/zhipu-tools/scripts/sync-prompts.mjs`

## 设计文档

- [完整设计](docs/design/design.md)：双模块架构、配置、13 工具清单、模块详解、限制
- [ADR-001](docs/design/adr/001-replicate-source-pure-http.md)：vision 模块——为什么复刻源码纯 HTTP 直调（而非 MCP bridge）
- [ADR-002](docs/design/adr/002-zhipu-tools-scope-and-dual-impl.md)：范围扩展为 zhipu-tools + 双实现并存
