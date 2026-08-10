# Web Console

通过浏览器（手机 / 电脑）远程操作 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的独立 Web 服务。支持多工作目录、多会话，断线后 pi 继续执行。

> 这是一个**独立 Node 应用**，消费 pi 的 SDK，不属于 pi 的扩展体系。它允许构建步骤（见 [docs/design/adr/001](docs/design/adr/001-allow-build-step.md)），是项目"无构建"红线的正式例外。

## 特性

- 📱 **跨端**：同一套 UI 在手机和电脑上都好用（Tailwind 响应式）
- 🗂️ **多工作目录 / 多会话**：一个常驻服务管理所有项目
- ⚡ **异步执行**：手机发完任务可以关闭，pi 在电脑上继续跑，回头查看结果
- 🔌 **实时流式**：助手回复、工具调用实时显示

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 后端：Node + TypeScript + pi SDK（`@earendil-works/pi-coding-agent`）
- 通信：WebSocket

## 快速开始

> 待实现。骨架与文档已就绪，代码随后补齐。

```bash
# 安装依赖（待 package.json 就位）
npm install

# 开发模式（前后端）
npm run dev

# 生产构建
npm run build
```

## 部署（Windows 常驻）

- **常驻**：用 PM2 for Windows 或 nssm 注册为开机自启 / 崩溃重启
- **外网**：推荐 Tailscale（手机和电脑各装一个，免端口转发）

## 设计文档

- [完整设计](docs/design/design.md)
- [ADR（架构决策记录）](docs/design/adr/)
  - [001 - 允许构建步骤](docs/design/adr/001-allow-build-step.md)
  - [002 - SDK 同进程 vs RPC 子进程](docs/design/adr/002-sdk-in-process-vs-rpc-subprocess.md)
  - [003 - 单进程多会话](docs/design/adr/003-single-process-multi-session.md)

## 安全提醒

Web 服务暴露的是对 pi 的**完全控制权**（文件读写、命令执行）。务必：

- 限制访问范围（Tailscale 内网 / 认证）
- 配置工作目录白名单
- **不要**直接暴露到公网无认证
