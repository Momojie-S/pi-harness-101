# ADR-001: 复刻 @z_ai/mcp-server 源码，纯 HTTP 直调智谱 GLM-4.6V

- 状态：Accepted
- 日期：2026-08-13

## 背景

用户希望给 pi 增加智谱的视觉理解能力（图像分析、OCR、视频理解等）。智谱为 GLM Coding Plan
用户提供了 `@z_ai/mcp-server`（视觉理解 MCP Server），它是一个 **stdio（本地）MCP server**，
通过 `npx -y @z_ai/mcp-server` 启动，暴露 8 个视觉工具（image_analysis、ui_to_artifact、
extract_text_from_screenshot 等）。

但有两个根本约束：

1. **pi 原生不支持 MCP**。pi README「Philosophy」明确写 *"No MCP. ... build an extension
   that adds MCP support."*——pi 的理念是用 skill / 扩展 + 少数强大通用工具，而非 MCP 黑盒。
2. **智谱 MCP server 是 stdio 的，没有 HTTP 端点**。智谱文档索引确认 4 个 MCP server 全是
   `coding-plan/mcp/*`，全是 Local/stdio，无法直接 HTTP 调用。

用户认同 pi「不要 MCP」的理念，但又想要 MCP server 那 8 个工具的封装价值（专业 prompt）。

## 决策

**看 `@z_ai/mcp-server` 源码，把它的 8 个工具「system prompt + HTTP 调用逻辑」原样复刻进 pi 扩展，
纯 HTTP 直调智谱 GLM-4.6V。**

关键事实（已读源码 `build/core/chat-service.js` 实证）：MCP server 底层就是一句
`fetch(url, { headers: { Authorization: Bearer ${key} }, body })` 调智谱 chat completions API，
没有任何魔法。那 8 个工具 = 「特定 system prompt + 这个 fetch」。所以可以零损失复刻：

- **prompt**：原样复刻（`build/prompts/*.js`，这是封装价值所在）
- **API 调用**：原样复刻（model `glm-4.6v`、`thinking:{type:'enabled'}`、temperature 0.8 /
  top_p 0.6 / max_tokens 32768）
- **媒体处理**：原样复刻（URL 直传、本地文件转 base64 dataurl；图片 5MB / 视频 8MB 限制）

## 备选方案

| 方案 | 怎么做 | 优点 | 缺点 |
|------|--------|------|------|
| **A. stdio MCP bridge** | pi 扩展 spawn 子进程 + JSON-RPC over stdio | 完全等价 MCP server，自动跟上其更新 | 要 spawn 子进程、引 MCP 协议、依赖 npx；与 pi「No MCP」理念冲突 |
| **B. 单一通用 vision 工具** | 一个通用工具直调 API，靠 agent 自己组织 prompt | 最简，最符合 pi「少而强」哲学 | 丢失 8 个工具的专业 prompt 封装（OCR 精度、UI diff 双图标注等） |
| **C. 复刻源码 + 纯 HTTP（本决策）** | 抠出 prompt + 调用逻辑，pi 扩展内 fetch | 纯 HTTP 无进程/协议、保留全部 prompt 封装、启动快、可控 | 源码更新（新工具/prompt）需手动同步 |

## 后果

**正面**：
- 无外部子进程、无 MCP 协议依赖、无 npx——纯 Node fetch，启动即用
- 完整保留 8 个工具的专业 prompt 封装（用户要的封装价值）
- 符合 pi「No MCP」理念
- 复用已配置的 `ZAI_CODING_CN_API_KEY`（coding plan 接口），用户无需额外配 key

**负面**：
- `@z_ai/mcp-server` 发布新工具 / 改 prompt / 升级 model 时，本扩展需手动同步源码
  （缓解：README 注明同步方式 + 源码位置；`prompts.ts` 顶部标注复刻自哪个版本）

## 参考

- 源码：`@z_ai/mcp-server@0.1.4`（`.temp/zai-mcp/package/build/`）
- 智谱文档：https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server
- pi 哲学：README「Philosophy — No MCP」
- 实测依据：`ZAI_CODING_CN_API_KEY` + coding plan 接口可调 glm-4.6v（已 curl 验证 200）
