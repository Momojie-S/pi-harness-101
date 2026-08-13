# Web Console 设计文档

## 背景

### 问题

需要从手机或电脑浏览器远程操作 pi coding agent，满足：

- **异步使用**：手机发送任务后可以关闭 App，pi 继续在电脑上执行，回头查看结果
- **多工作目录**：一个常驻服务同时管理多个项目目录、多个会话
- **跨端**：同一套 UI 在电脑（大屏 + 键盘鼠标）和手机（小屏 + 触摸）上都好用

### 为什么不用 SSH + tmux？

原生 Windows 没有 tmux/screen，"进程常驻、断线重连"这条路在纯 Windows 上走不通（除非上 WSL，但本项目选择不依赖 WSL）。

### 为什么用独立的 Web 服务？

Web 服务是一个**常驻进程**，天然替代 tmux 的保活角色：

- 手机只连浏览器，不关心底层进程
- pi 跑在 Web 服务进程内部，Web 服务不退出 pi 就活着
- pi 的会话默认持久化到 `~/.pi/agent/sessions/*.jsonl`（按 cwd 分目录），即使进程意外退出，历史和已完成工作都在磁盘上，重连后可恢复

### 为什么允许构建？（关键例外）

本项目 AGENTS.md 红线 1 要求"无构建步骤"，但**其本意是针对 pi 通过 jiti 加载的资源**（扩展 / skill / prompt / theme）——这些不能有构建步骤，否则 `/reload` 热加载会失效。

Web Console 是**独立 Node 应用**，不在这条加载链路上：它反过来调用 pi 的 SDK，构建与否与 pi 的热加载无关。而要做一个"好用的、适应自己的前端"（React + 现代工具链），构建步骤是必要的。

正式例外记录见 [ADR-001](adr/001-allow-build-step.md)。

## 架构

```
┌──────────────────────────────────────────────────────┐
│  手机浏览器 / 电脑浏览器（React + Tailwind，响应式）    │
│   - 多端断点切换（lg+ 桌面三栏 / <lg 手机单栏抽屉）     │
└───────────────────────┬──────────────────────────────┘
                        │ WebSocket（JSON 消息）
                        ▼
┌──────────────────────────────────────────────────────┐
│  Web Console 服务（单个 Node 进程，常驻）              │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  会话管理器                                      │ │
│  │  Map<cwd::sessionId, AgentSession>              │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐               │ │
│  │  │ pi 实例│ │ pi 实例│ │ pi 实例│ ← SDK 同进程    │ │
│  │  │cwd:D\A │ │cwd:D\B │ │cwd:D\A │   各自独立:    │ │
│  │  │proj1   │ │proj2   │ │proj1   │   messages/    │ │
│  │  └────────┘ └────────┘ └────────┘   model/tools  │ │
│  └─────────────────────────────────────────────────┘ │
│       │ createAgentSession({ cwd, sessionManager })  │
└───────┼───────────────────────────────────────────────┘
        ▼
  ~/.pi/agent/sessions/<cwd-hash>/*.jsonl
  （SessionManager 按 cwd 自动分目录，天然隔离）
```

### 核心机制

1. **SDK 同进程多实例**：Web 服务用 `createAgentSession({ cwd })` 按需创建 pi 实例，放进 Map 管理。每个实例有独立的 messages / model / tools。详见 [ADR-002](adr/002-sdk-in-process-vs-rpc-subprocess.md)。
2. **单进程多会话**：一个 Web 服务进程承载所有会话，SessionManager 按 cwd 自动隔离存储，不同目录/会话互不串扰。详见 [ADR-003](adr/003-single-process-multi-session.md)。
3. **异步执行**：agent 一旦接受 prompt 就独立执行到底（到 `agent_settled`），不依赖客户端连接。手机断开期间产生的工作（写文件、跑命令、会话落盘）已完成；实时 event 流不缓存，但磁盘上的权威状态随时可拉回（`get_entries` 支持 `since` 游标，断线重连只拉增量）。
4. **WebSocket 双向通信**：前端发消息 / 转向 / abort；后端推流式输出 / 工具调用 / 会话事件。

## 技术栈

| 层 | 选型 | 理由 |
|----|------|------|
| 前端框架 | React + TypeScript | 生态最大、参考资料最多；用 AI 辅助开发时可靠性最高 |
| 构建 | Vite | React 官方搭档，HMR 快，产物干净 |
| 样式 / 多端 | Tailwind CSS | 响应式断点（`sm:`/`md:`/`lg:`）天生适配"一套代码多端" |
| 主题 / 设计系统 | CSS 变量语义令牌（亮/暗双主题） | 令牌集中、组件与主题解耦、易换肤（[design-system.md](modules/design-system.md)、[ADR-010](adr/010-frontend-theme-system.md)） |
| 字体 | Inter（自托管）+ 系统中文字体 | 现代精致字形，中英混排兼顾体积与观感 |
| 通信 | WebSocket（`ws`） | 实时双向，适配流式输出 |
| 后端 | Node + TypeScript | 与 SDK 同语言，类型安全 |
| pi 驱动 | `@earendil-works/pi-coding-agent` SDK | 同进程，省资源，直接订阅事件 |

## 多端适配

> 布局结构 + 全屏滚动铁律 + 改动清单见 [modules/layout.md](modules/layout.md)；限宽居中的取舍见 [ADR-011](adr/011-content-maxwidth-center.md)。

不使用偏桌面或偏移动的现成 UI 组件库（会导致维护两套 UI），而是 **Tailwind + 自定义响应式组件**：

```
桌面 (lg+)                    手机 (<lg)
┌────┬──────────────┐         ┌──────────────┐
│ 会话│  消息流      │         │ ☰  消息流    │ ← 侧边栏变抽屉
│ 列表│  (流式)      │         │   (流式)     │
│     ├──────────────┤         ├──────────────┤
│     │ 输入框       │         │ 输入框       │
└────┴──────────────┘         └──────────────┘
```

核心手段：Tailwind 断点（如侧边栏 `hidden lg:block`、网格 `grid-cols-1 lg:grid-cols-[16rem_1fr]`）。

**移动端专项**（[design-system.md §8](modules/design-system.md)）：safe-area 安全区适配（`env(safe-area-inset-*)`）、触摸目标 ≥40px、抽屉滑入动画、移动端顶栏含品牌名。**主题**：亮/暗双主题，跟随系统（`prefers-color-scheme`）+ 手动切换 + localStorage 持久化，无 FOUC（[ADR-010](adr/010-frontend-theme-system.md)、[design-system.md](modules/design-system.md)）。

## 配置

| 配置项 | 说明 | 默认 |
|--------|------|------|
| 监听端口 | Web 服务端口 | `3000` |
| 工作目录范围 | `ALLOWED_DIRS`（分号分隔）限制可操作的目录；未设则不限制（任意目录，靠网络层认证兑底，[ADR-009](adr/009-frontend-cwd-selection.md)） | 未设（任意） |
| 会话空闲回收 | 无客户端订阅且非运行中的会话超过阈值后 `dispose()` 释放内存（ADR-003）。关闭 tab 立即释放；长期空闲（默认 2h）自动回收。会话已落盘，回收后重连从磁盘恢复，数据不丢 | 默认 2h，`WC_SESSION_IDLE_MS` 可调，设 0 关闭 |

### 外网访问

推荐 **Tailscale**：手机和电脑各装一个，自动组网，免路由器端口转发。也可用 frp 等内网穿透方案。

### 常驻（Windows）

用 PM2 for Windows 或 nssm 将 Web 服务注册为开机自启 / 崩溃重启，替代 tmux 的保活角色。

## 功能清单

| 功能 | 说明 | 状态 |
|------|------|------|
| 多会话并发 | 多 tab，后台继续 + 切换查看（按 sessionId） | ✅ |
| 流式聊天 | 实时显示助手回复（`message_update`） | ✅ |
| 工具调用展示 | 实时进度卡片 + 结果 | ✅ |
| 工具结果差异化渲染 | read 点路径 / edit·write diff / bash 输出（ADR-004） | ✅ |
| 转向 / 跟进 / abort | steering / follow_up / 停止 | ✅ |
| 目录树浏览 | 工作目录文件树，懒加载展开 | ✅ |
| 目录浏览选择 | 侧边栏 📁 跨盘浏览选目录；选定后内联显示该目录历史会话列表（滚动分页），可恢复或新建（`list_sessions`+`open_history`，[ADR-009](adr/009-frontend-cwd-selection.md)） | ✅ |
| 文件查看 | 点击查看，二进制三层过滤拒绝（ADR-005）；markdown 类（.md/.markdown/.mdx）按格式渲染，代码文件按语言语法高亮，其余纯文本（ADR-013 / ADR-014） | ✅ |
| /command | 完整：skills/prompts/extension + model/compact/thinking/resume/tree/fork（ADR-006） | ✅ |
| 断线重连 | 自动重连 + 恢复所有会话订阅 | ✅ |
| 多端响应式 | 桌面三栏 / 手机单栏（safe-area / 触摸目标 / 抽屉动画见 [design-system.md §8](modules/design-system.md)） | ✅ |
| 全屏布局 | flex 三层结构 + 视口锁死 + 限宽居中（[modules/layout.md](modules/layout.md)、[ADR-011](adr/011-content-maxwidth-center.md)） | ✅ |
| 主题切换 | 亮/暗双主题，跟随系统 + 手动切换（[ADR-010](adr/010-frontend-theme-system.md)） | ✅ |
| extension 命令 | 扩展注册的 /cmd（runtime.getCommands） | ✅ |
| 扩展 UIContext 桥接 | ctx.ui.notify 转发到前端（system-notice/error）；其余 no-op 待支持（[modules/extension-ui.md](modules/extension-ui.md)） | ✅ notify |
| /reload | 重载当前会话的扩展/skills/prompts（保留对话，调 AgentSession.reload）；前端 / 补全 + 完成反馈 | ✅ |
| 状态栏 | 当前模型 + context 占用百分比/进度条（[modules/status-bar.md](modules/status-bar.md)） | ✅ |
| 会话列表分组 | 打开的会话按目录分组 + 显示首条消息简述（`sessionUtils.getSummary`/`groupByCwd`） | ✅ |
| 历史会话恢复 | 点击恢复历史会话；已打开的直接切换不重复加载；loading + 防重复点击 | ✅ |
| 会话生命周期 | 关闭 tab 即 `dispose()` 释放后端会话（SDK 资源 + GC）；长期无客户端的非运行中会话定时自动回收（ADR-003，防单进程多会话 OOM） | ✅ |
| Compact 反馈 | /compact 触发后显示旋转加载提示（基于 SDK 的 `compaction_start`/`compaction_end` event） | ✅ |
| Markdown 渲染 | assistant 输出按 markdown 渲染（代码块/标题/列表/表格/行内代码），react-markdown + remark-gfm（[ADR-013](adr/013-markdown-rendering.md)） | ✅ |
| Steer 补充 | agent 工作中可发补充消息（不打断当前工作；输入框自动切换为「补充」模式，走后端 `steer` WS） | ✅ |
| 消息分页加载 | 首屏 50 条 + 向上滚动加载更早（避免大对话全量传输，[ADR-012](adr/012-message-pagination.md)） | ✅ |
| 首屏代码分割 | Markdown/highlight.js 拆 lazy chunk 按需加载，首屏 gzip 164KB→59KB（[ADR-015](adr/015-code-splitting-vs-cdn.md)） | ✅ |
| 服务自重启 | agent 触发重启（spawn 接班 + 补 toolResult + agent 继续）（[modules/restart.md](modules/restart.md)） | ✅ |

## 已知限制

- **实例隔离是进程级而非 OS 级**：所有 pi 实例共享一个 Node 进程，一个实例抛未捕获异常理论上可能影响整体（实际 SDK 各 AgentSession 状态独立，风险可控）。若需更强隔离，可改用多 `pi --mode rpc` 子进程（见 ADR-002 备选）。
- **实时 event 不缓存**：手机断开期间产生的 event 不被服务端缓存；但任务结果已落盘，重连后可拉取完整状态。若要看到中间过程，需在服务端额外缓存 event。
- **bash 要求**：pi 在 Windows 需要 bash（Git Bash 等），Web 服务所在环境需满足。
- **安全**：Web 服务暴露的是对 pi 的完全控制权（文件读写、命令执行），务必限制访问范围（Tailscale 内网 / 认证 / 工作目录白名单），不要直接暴露到公网无认证。

## 路线图（待办）

> 以下为已规划、暂未执行的工作（2025-01 暂存，优先做阿里云部署）。

- ~~**补分模块设计文档**~~：✅ `ws-protocol.md`（WS 通信与前端性能方法论）已完成；`session-management.md`（会话管理）、`command-system.md`（/command 分流）、`tool-rendering.md`（工具结果渲染）仍待补
- **前端重构**：按 `modules/frontend-architecture.md` 拆分 `App.tsx`（`useReducer` 消除 ref 镜像 + 拆组件 + 类型贯穿），5 步有序小步
- ~~**前端主题系统落地**~~：✅ 已完成（亮/暗双主题 + Linear 风视觉 + 移动端专项，见 [ADR-010](adr/010-frontend-theme-system.md) + [modules/design-system.md](modules/design-system.md)）
- ~~**前端布局文档**~~：✅ 已完成（全屏 flex 结构 + 三条铁律 + 限宽居中取舍，见 [modules/layout.md](modules/layout.md) + [ADR-011](adr/011-content-maxwidth-center.md)）
- ~~**消息分页加载**~~：✅ 已完成（首屏 50 条 + 向上滚动加载，避免大对话全量传输，见 [ADR-012](adr/012-message-pagination.md)）
