# pi-harness-101

> ⚠️ **本仓库已废弃（2026-08-14）**：我已从 pi 迁移到 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)，新的学习工坊在 **[deepseek-harness-101](https://github.com/Momojie-S/deepseek-harness-101)**（含 MCP 配置指南、插件开发指南、[dsh-workspace-mcp](https://github.com/Momojie-S/dsh-workspace-mcp) / [dsh-workspace-env](https://github.com/Momojie-S/dsh-workspace-env) 两个插件）。本仓库仅作历史存档，不再更新。

学习 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的 harness 架构，打造最适合自己的 coding agent。

## 初衷

从 Claude Code 切换到 pi，因为：
- Claude Code 有各种 bug，自定义程度不高
- 想深入理解 harness agent 的实现
- 想通过 extensions、skills、tools 等机制，构建完全可控的 agent 工作流

这个 repo 是我的学习工坊，记录探索过程和产出。

## 目录结构

```
├── extensions/     # pi extensions (TypeScript)
├── web-console/    # 浏览器远程操作 pi 的独立 Web 应用（允许构建）
├── skills/         # 自定义 skills
├── prompts/        # prompt templates
├── themes/         # 自定义主题
└── docs/           # 学习笔记
```

## 使用方式

### 安装整个 package

```bash
pi install git:github.com/Momojie-S/pi-harness-101
```

然后在 `~/.pi/agent/settings.json` 中添加：

```json
{
  "packages": ["git:github.com/Momojie-S/pi-harness-101"]
}
```

### 本地开发

直接引用本地路径：

```json
{
  "extensions": [
    "D:/code/workspace/pi-harness-101/extensions/chrome-devtools/index.ts"
  ]
}
```

## Extensions

### chrome-devtools

**完全兼容 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)**，提供 52 个工具，实现从 MCP 无缝切换。

**配置**：

```json
// .pi/chrome-devtools.json 或 ~/.pi/agent/chrome-devtools.json
{ "port": 19999 }
```

**前提**：启动浏览器时加 `--remote-debugging-port=19999`

**工具分类**：

| 类别 | 数量 | 说明 |
|------|------|------|
| Input automation | 10 | click, fill, hover, drag, press_key 等 |
| Navigation | 6 | navigate_page, list_pages, new_page 等 |
| Emulation | 2 | emulate, resize_page |
| Performance | 3 | performance trace |
| Network | 2 | list/get network requests |
| Debugging | 8 | screenshot, snapshot, console, script, lighthouse, screencast |
| Memory | 12 | heap snapshot 分析 |
| Extensions | 5 | Chrome 扩展管理 |
| Third-party | 2 | 第三方开发者工具 |
| WebMCP | 2 | WebMCP 工具 |
| **总计** | **52** | **完全兼容 chrome-devtools-mcp** |

完整工具列表见 [extensions/chrome-devtools/README.md](./extensions/chrome-devtools/README.md)。
