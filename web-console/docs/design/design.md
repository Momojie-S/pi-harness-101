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
| 通信 | WebSocket（`ws`） | 实时双向，适配流式输出 |
| 后端 | Node + TypeScript | 与 SDK 同语言，类型安全 |
| pi 驱动 | `@earendil-works/pi-coding-agent` SDK | 同进程，省资源，直接订阅事件 |

## 多端适配

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

## 配置

| 配置项 | 说明 | 默认 |
|--------|------|------|
| 监听端口 | Web 服务端口 | `3000` |
| 工作目录白名单 | 允许通过 Web 操作的目录（安全：避免暴露任意目录） | 启动时指定 |
| 会话空闲回收 | 长时间不活跃的 AgentSession 是否 `dispose()` 释放内存 | 可配（会话已落盘，回收不影响恢复） |

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
| 文件查看 | 点击查看，二进制三层过滤拒绝（ADR-005） | ✅ |
| /command | 完整：skills/prompts/extension + model/compact/thinking/resume/tree/fork（ADR-006） | ✅ |
| 断线重连 | 自动重连 + 恢复所有会话订阅 | ✅ |
| 多端响应式 | 桌面三栏 / 手机单栏 | ✅ |
| extension 命令 | 扩展注册的 /cmd（runtime.getCommands） | ✅ |
| 状态栏 | 当前模型 + context 占用百分比/进度条（[modules/status-bar.md](modules/status-bar.md)） | ✅ |
| 服务自重启 | agent 触发重启（spawn 接班 + 补 toolResult + agent 继续）（[modules/restart.md](modules/restart.md)） | ✅ |

## 已知限制

- **实例隔离是进程级而非 OS 级**：所有 pi 实例共享一个 Node 进程，一个实例抛未捕获异常理论上可能影响整体（实际 SDK 各 AgentSession 状态独立，风险可控）。若需更强隔离，可改用多 `pi --mode rpc` 子进程（见 ADR-002 备选）。
- **实时 event 不缓存**：手机断开期间产生的 event 不被服务端缓存；但任务结果已落盘，重连后可拉取完整状态。若要看到中间过程，需在服务端额外缓存 event。
- **bash 要求**：pi 在 Windows 需要 bash（Git Bash 等），Web 服务所在环境需满足。
- **安全**：Web 服务暴露的是对 pi 的完全控制权（文件读写、命令执行），务必限制访问范围（Tailscale 内网 / 认证 / 工作目录白名单），不要直接暴露到公网无认证。

## 路线图（待办）

> 以下为已规划、暂未执行的工作（2025-01 暂存，优先做阿里云部署）。

- **补分模块设计文档**：`modules/` 下补充 `ws-protocol.md`（WS 消息契约）、`session-management.md`（会话管理）、`command-system.md`（/command 分流）、`tool-rendering.md`（工具结果渲染）
- **前端重构**：按 `modules/frontend-architecture.md` 拆分 `App.tsx`（`useReducer` 消除 ref 镜像 + 拆组件 + 类型贯穿），5 步有序小步
