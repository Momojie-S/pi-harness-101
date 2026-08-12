# Web Console

通过浏览器（手机 / 电脑）远程操作 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的独立 Web 服务。支持多工作目录、多会话，断线后 pi 继续执行。

> 这是一个**独立 Node 应用**，消费 pi 的 SDK，不属于 pi 的扩展体系。它允许构建步骤（见 [docs/design/adr/001](docs/design/adr/001-allow-build-step.md)），是项目"无构建"红线的正式例外。

## 特性

- 📱 **跨端**：同一套 UI 在手机和电脑上都好用（Tailwind 响应式）
- 🗂️ **多工作目录 / 多会话**：一个常驻服务管理所有项目，后台并发执行
- ⚡ **异步执行**：手机发完任务可以关闭，pi 在电脑上继续跑，回头查看结果
- 🔌 **实时流式**：助手回复、工具调用实时显示
- 🛠️ **工具结果差异化渲染**：read 点路径查看 / edit·write 显示 diff / bash 显示输出（[ADR-004](docs/design/adr/004-tool-result-rendering.md)）
- 📁 **目录树浏览 + 文件查看**：懒加载展开，二进制三层过滤拒绝（[ADR-005](docs/design/adr/005-file-preview-safety.md)）
- 💬 **`/command` 完整覆盖 CLI**：skills/prompts/extension + model/compact/thinking/resume/tree/fork（[ADR-006](docs/design/adr/006-slash-command.md)）
- 🔁 **断线自动重连**：恢复所有会话订阅

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 后端：Node + TypeScript + pi SDK（`@earendil-works/pi-coding-agent`）
- 通信：WebSocket

## 快速开始

**环境要求**：Node 20+；pi 已配置（`~/.pi/agent/auth.json` 里有 provider 的 API key）。

```bash
npm install

# 开发模式（前端 30001 + 后端 30000，vite 代理 /ws → 30000；web 服务统一走 30000 段，避开线上）
npm run dev

# 生产构建（产物 dist/client/）
npm run build
```

**生产启动**（单端口：后端 serve dist/client + /ws）：
```bash
npm run build
ALLOWED_DIRS="D:/my/project" PORT=3000 npm start   # = npx tsx server/index.ts
```
浏览器打开 `http://localhost:3000`。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 服务端口 | `3000` |
| `ALLOWED_DIRS` | 允许操作的工作目录（`;` 分隔，安全白名单；未设则允许任意，仅限受信网络） | （未设） |
| `WC_MODEL` | 默认模型（`provider/id` 格式） | `zai-coding-cn/glm-5.2` |
| `PI_CODING_AGENT_DIR` | pi 的 agent 配置目录（见下方说明） | `~/.pi/agent`（由 `homedir()` 推断） |

### `PI_CODING_AGENT_DIR` 何时需要？

web-console 通过 pi SDK 驱动 agent，而 pi 的 **API key 存在 `~/.pi/agent/auth.json`**。当 web-console 以**系统服务 / 非用户账户**方式运行时（如 Windows 计划任务用 `SYSTEM` 身份、Linux systemd 等），进程的 home 目录不是你的用户目录，pi 的 `getAgentDir()` 会读到一个**空的** `.pi` → 报 `No API key found`。

此时需显式设 `PI_CODING_AGENT_DIR` 指向你实际的 pi agent 目录（绝对路径）：
```bash
# Windows 计划任务（SYSTEM 身份）的启动脚本里
$env:PI_CODING_AGENT_DIR = "C:\Users\<你的用户名>\.pi\agent"
# Linux systemd
Environment=PI_CODING_AGENT_DIR=/home/<你>/.pi/agent
```

> **交互方式运行**（用你自己的账户 `npm start` / `npm run dev`）则**不需要**设它——pi 能正常读到你的 `~/.pi/agent`。

## 生产部署（常驻 + 外网）

web-console 需**常驻**（替代 tmux 的保活角色）才能随时远程访问。

- **Windows 常驻**：计划任务推荐 `AtLogOn` 触发 + `Interactive` 身份（当前登录用户）——进程落在 **Session 1**（交互式桌面会话），home/PATH 天然正确（无需 `PI_CODING_AGENT_DIR`），且 pyautogui / SendInput 等桌面自动化可用。若改用 `AtStartup` + `SYSTEM` 则落在 **Session 0**，桌面自动化失效且需额外设 `PI_CODING_AGENT_DIR`。也可用 PM2。需配开机自动登录才能无人值守恢复。**具体部署脚本**（路径、账户名、env 值）属运维实例，不随制品分发。
- **外网访问**：frp 内网穿透 + 云服务器 nginx 反代 + HTTPS 证书；或 Tailscale 组网（免端口转发）。

> 本仓只记**通用方式**。**某台机器的具体部署实例**（域名、frp/nginx 配置、计划任务名、Basic Auth 凭据）属于该机器的运维文档，不写死在本仓——例如本作者的实例记录在 `ops/docs/pi-web-console.md`（`pi.momojie.online`）。

## 设计文档

- [完整设计](docs/design/design.md)
- [ADR（架构决策记录）](docs/design/adr/)：001 允许构建 · 002 SDK 同进程 · 003 单进程多会话 · 004 工具结果渲染 · 005 文件预览安全 · 006 斜杠命令
- [前端架构（重构蓝图）](docs/design/modules/frontend-architecture.md)

## 安全提醒

Web 服务暴露的是对 pi 的**完全控制权**（文件读写、命令执行）。务必：

- 限制访问范围（Tailscale 内网 / 反代认证 / 工作目录白名单）
- 暴露到公网时**必须加认证**（nginx Basic Auth / token）
- 配置 `ALLOWED_DIRS` 白名单，避免暴露任意目录
