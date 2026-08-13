# ADR-002: 范围扩展为 zhipu-tools，双实现并存

- 状态：Accepted
- 日期：2026-08-13
- 关联：ADR-001（vision 模块的复刻决策）

## 背景

ADR-001 时扩展名为 `zhipu-vision`，只复刻「视觉理解 MCP」。但用户要智谱 Coding Plan 的
**全部 4 个 MCP 能力**：视觉理解、联网搜索、网页读取、开源仓库。扩展改名 `zhipu-tools`。

调研中发现一个关键事实——**这 4 个 MCP server 的传输方式根本不同**：

| MCP server | 传输 | 底层 |
|-----------|------|------|
| 视觉理解 | **stdio（Local）**，`npx -y @z_ai/mcp-server` | 本地跑，底层 fetch GLM-4.6V API |
| 联网搜索 | **HTTP（Remote）**，`open.bigmodel.cn/api/mcp/web_search_prime/mcp` | 云端 HTTP MCP 端点 |
| 网页读取 | **HTTP（Remote）**，`open.bigmodel.cn/api/mcp/web_reader/mcp` | 云端 HTTP MCP 端点 |
| 开源仓库 | **HTTP（Remote）**，`open.bigmodel.cn/api/mcp/zread/mcp` | 云端 HTTP MCP 端点 |

所以不能一刀切，两种 MCP 要用**两种截然不同的接入方式**。

## 决策

**双实现并存**，按 MCP 的传输方式分到两个模块：

1. **`src/vision/`（8 工具）**——视觉 MCP 是 stdio 本地的。沿用 ADR-001：复刻 `@z_ai/mcp-server`
   源码，**纯 HTTP 直调 GLM-4.6V chat completions API**。

2. **`src/mcp-http/`（5 工具：web_search_prime / webReader / search_doc / read_file / get_repo_structure）**
   ——搜索/网页/仓库 MCP 是远程 **HTTP MCP**，本身就是 HTTP 端点。实现一个**极简 MCP
   Streamable HTTP 客户端**（`client.ts`）：initialize → 拿 `Mcp-Session-Id` → tools/call，
   响应是 SSE。每个 endpoint 维护一个 session（懒初始化 + 复用）。

> 注意：这正是用户最初想要的「通过 http 调用 mcp server」——对这 3 个 HTTP MCP 完全成立。
> 它们天生是 HTTP 的，不存在 stdio 的复杂度。

**工具发现策略**：mcp-http 模块用**静态声明**（基于实测 `tools/list` 的真实工具名/schema），
而非每次动态发现。理由：①工具少且稳定；②启动快（无需 3 次握手）；③文档已过时
（如文档写 `webSearchPrime`，实测是 `web_search_prime`），实测更可靠。

**鉴权**：两大模块都复用 `ZAI_CODING_CN_API_KEY`（coding plan key）。vision 直调 API 用 Bearer；
mcp-http 调远程端点也用 Bearer（已实测 3 个 endpoint 均可鉴权 + tools/call 返回结果）。

## 备选方案

| 方案 | 做法 | 不选的原因 |
|------|------|-----------|
| 全部用 MCP HTTP 客户端 | 视觉也走 MCP 协议 | 视觉是 stdio 本地 MCP，没有 HTTP 端点，此路不通 |
| 全部复刻源码直调 API | 搜索/网页/仓库也抠源码 | 这 3 个是云端闭源 HTTP MCP，没有本地源码包可复刻 |
| mcp-http 动态 tools/list | 启动时握手发现工具 | 启动要 3 次握手偏慢；工具少，静态声明足够且快 |

## 后果

**正面**：
- 一个扩展覆盖智谱 Coding Plan 全部 4 类能力（13 工具），名字 `zhipu-tools` 名实相符
- 两种 MCP 各用最自然的接入方式（stdio→复刻直调；HTTP→MCP 客户端），无强行统一
- 共享 config（key + endpoint），结构清晰（vision / mcp-http 两个子模块）

**负面**：
- 代码有两种范式（直调 API vs MCP 协议），认知成本略高（用模块隔离 + 本 ADR 记录缓解）
- mcp-http 静态声明：智谱更新 HTTP MCP 工具时需手动同步（重跑 `tools/list` 实测 + 改 tools.ts）

## 参考

- 智谱 MCP 文档：search/reader/zread 均注明「基于 HTTP 协议的远程 MCP 服务，无需本地安装」
- 实测验证：`web_search_prime` 的 initialize + tools/list + tools/call 全部通过（见调研记录）
