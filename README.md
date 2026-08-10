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

**Phase 1 工具** (核心自动化 - 17 个)：

| Tool | 功能 |
|------|------|
| `browser_navigate` | 导航到 URL |
| `browser_screenshot` | 截图（支持元素/整页） |
| `browser_get_text` | 获取页面文本 |
| `browser_evaluate` | 执行 JS |
| `browser_click` | 点击元素 |
| `browser_type` | 输入文字 |
| `browser_fill` | 表单填写 |
| `browser_hover` | 悬停元素 |
| `browser_press_key` | 按键/组合键 |
| `browser_handle_dialog` | 处理弹窗 |
| `browser_wait` | 等待元素/超时 |
| `browser_get_url` | 获取当前 URL |
| `browser_list_tabs` | 列出所有标签页 |
| `browser_switch_tab` | 切换标签页 |
| `browser_new_page` | 新建标签页 |
| `browser_close_page` | 关闭标签页 |
| `browser_drag` | 拖拽元素 |

**Phase 2 工具** (调试能力 - 4 个)：

| Tool | 功能 |
|------|------|
| `browser_list_console` | 列出控制台消息 |
| `browser_get_console` | 获取单条消息详情 |
| `browser_list_network` | 列出网络请求 |
| `browser_get_network` | 获取请求详情 |

**后续计划**：
- Phase 3: 高级功能 (performance, emulation)
- Phase 4: 内存分析 (heap snapshot)
