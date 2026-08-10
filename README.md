# pi-harness-101

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

通过 CDP 控制已开启调试端口的 Chrome/Edge 浏览器。参考 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 实现。

**配置**（优先级：环境变量 > 项目配置 > 全局配置 > 默认值）：

```json
// .pi/chrome-devtools.json 或 ~/.pi/agent/chrome-devtools.json
{ "port": 19999 }
```

**前提**：启动浏览器时加 `--remote-debugging-port=19999`

**提供 31 个工具**：

| 阶段 | 工具数 | 说明 |
|------|--------|------|
| Phase 1 | 17 | 核心自动化：导航、截图、点击、输入、表单、拖拽等 |
| Phase 2 | 4 | 调试能力：控制台消息、网络请求 |
| Phase 3 | 4 | 高级功能：性能追踪、设备模拟 |
| Phase 4 | 2 | 内存分析：堆快照 |
| Phase 5 | 4 | 扩展功能：Chrome 扩展管理 |

完整工具列表见 [extensions/chrome-devtools/README.md](./extensions/chrome-devtools/README.md)。
