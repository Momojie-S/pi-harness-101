# ADR-012: 消息分页加载（首屏 50 条 + 向上滚动加载更早）

## 状态

Accepted

## 背景

### 现状

`session_opened` 一口气把整个 `session.messages` 序列化经 WS 发给前端，前端一次性渲染。实测会话文件大小：

| 对话 | jsonl 大小 | 条目 |
|------|-----------|------|
| pi-harness-101（最大） | **4.2 MB** | ~上千条 |
| StarRailOneDragon | 3.8 MB | — |
| 中等对话 | 1.2 MB | 320 行 |

打开大对话时：WS 传输数 MB JSON + 前端 `JSON.parse` + React 一次渲染上千条消息，**体感明显卡顿**（用户反馈"打开一个会话还是很慢"）。

### 问题

长对话是常态（coding agent 单会话经常上百轮、上千条消息）。全量传输 + 全量渲染的耗时随对话长度线性增长，大对话体验不可接受。

## 面临的选择

| 方案 | 做法 |
|------|------|
| **A. 分页加载** | 首屏只返回最近 N 条；滚动到顶部时按需加载更早的片段 |
| B. 全量加载（维持现状） | 一次性返回所有消息 |
| C. 虚拟列表 | 全量传输但前端只渲染可视区域（虚拟滚动） |

## 决策

**选 A（分页加载）。**

- 首屏 `MSG_INITIAL_PAGE = 50` 条（`session_opened` 只带 `messages.slice(offset)`）
- 每次加载 `MSG_PAGE_SIZE = 50` 条（前端 `load_earlier` → 后端 `earlier_messages`）
- `session_opened` 新增 `messageTotal`（总数）+ `messageOffset`（本次返回的起始索引）

### 为什么分页而非虚拟列表（C）

1. **WS 传输是大头**：4.2MB 的 JSON 经 WebSocket 序列化 + 传输 + 前端 parse，即使前端虚拟列表不卡，传输和解析本身就慢。分页把首屏传输量从 MB 级降到 KB 级。
2. **实现简单**：分页只需后端 slice + 前端滚动检测，不引入虚拟列表库（react-virtual 等），不改现有 MessageView 渲染逻辑。
3. **大多数场景够用**：用户打开会话通常只看最近的对话，向上翻历史是低频操作，按需加载即可。

### 索引稳定性（关键设计点）

分页用**绝对索引**（`messageOffset`），不用负索引或相对偏移。原因：session 是 append-only 的，历史消息一旦写入，其在数组中的索引**永久不变**；agent 追加新消息只在末尾加，不改变已有消息的索引。所以 `[offset, total)` 这个区间语义稳定，`load_earlier` 的 `before` 参数（前端已知的最早偏移）不会因 agent 同时追加消息而漂移。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 分页（本决策）** | 首屏快（KB 级）、实现简单、不引依赖 | 向上翻历史需等待加载（有 loading 提示） |
| B. 全量 | 一次到位、滚动无中断 | 大对话传输+渲染卡；随对话增长恶化 |
| C. 虚拟列表 | 滚动流畅、全量数据在手 | 传输/解析仍慢；需引库；改动 MessageView |

## 放弃了什么

- **一次到位的全量数据**：向上翻历史时需要等待分页加载（用顶部"⏳ 加载中…"提示缓解）。换来首屏从秒级降到毫秒级。
- **虚拟列表的极致滚动流畅**：当前消息量（首屏 50 条）用普通渲染足够流畅；若日后单条消息极重（如巨型 diff），可叠加虚拟列表。

## 后果

### 正面

- 大对话首屏从"卡几秒"降到"几乎秒开"（传输量 4.2MB → 几十 KB）。
- 首屏 50 条覆盖大多数"看最近对话"的场景，向上翻历史按需加载。
- 滚动位置保持：加载更早消息后，用户看到的内容不跳变（`pendingScrollAdj` 记录加载前 scrollHeight，dispatch 后补差值）。

### 负面

- **后端 SDK 耗时不减**：`createAgentSession` 加载历史、构建 context 是 SDK 内部完整操作，分页只减少 WS 传输 + 前端渲染，不减少 SDK 初始化耗时（见 `session_opened.timing` 诊断字段）。如果 SDK 耗时是大头，分页效果有限——需后续在 SDK 层或 loader 缓存上优化。
- **滚动位置保持的复杂度**：前置插入消息后要精确补差值 scrollTop，和现有"新消息滚到底"逻辑要区分（`pendingScrollAdj` 标志），增加了一点状态管理复杂度。

## 关联改动（同一批次的契约变更）

本次 `session_opened` 一并新增了：
- `sessionFile: string | undefined`——会话文件路径，供前端判断历史会话是否已打开（已打开的直接 `set_active`，不再重复 `open_history`）。
- `messageTotal` / `messageOffset`——分页元数据。

## 参考

- 整体架构：[../design.md](../design.md)
- 布局与滚动铁律：[modules/layout.md](../modules/layout.md)（消息流 `overflow-y-auto` 内部滚动）
- 前端架构：[modules/frontend-architecture.md](../modules/frontend-architecture.md)（state / reducer）
