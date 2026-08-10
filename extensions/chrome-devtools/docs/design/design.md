# Chrome DevTools Extension 设计文档

## 背景

### 问题

需要从 coding agent 中控制浏览器，用于：
- 抓取网页数据
- 自动化测试
- 页面截图
- 性能分析
- 网络调试

### 为什么不用 MCP？

pi 不支持 MCP，采用 extension + custom tools 机制。

### 参考实现

[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 是 Google 官方的 Chrome DevTools MCP Server，提供 52 个工具。我们以其为参考，实现相同的功能集。

## 架构

```
┌─────────────────────────────────────┐
│  pi Extension (TypeScript)          │
│                                     │
│  pi.registerTool("browser_xxx")     │
│         │                           │
│         ▼                           │
│  chrome-remote-interface (CDP)      │
│         │                           │
│         ▼                           │
│  Chrome/Edge (--remote-debugging-port)
└─────────────────────────────────────┘
```

### 数据流

1. LLM 发起 tool_call
2. pi 路由到对应的 browser_xxx tool
3. tool 通过 chrome-remote-interface 发送 CDP 命令
4. 浏览器执行并返回结果
5. tool 格式化结果返回给 LLM

## 配置

支持三层配置，优先级：

1. **环境变量** `CHROME_DEBUG_PORT` - 临时覆盖
2. **项目配置** `.pi/chrome-devtools.json` - 项目级
3. **全局配置** `~/.pi/agent/chrome-devtools.json` - 全局默认
4. **默认值** `19999` - 兜底

## 功能规划

### 与 chrome-devtools-mcp 功能对比

| 类别 | 工具数 | 已实现 | 待实现 |
|------|--------|--------|--------|
| Input automation | 10 | 7 | 3 |
| Navigation | 6 | 6 | 0 |
| Emulation | 2 | 0 | 2 |
| Performance | 3 | 0 | 3 |
| Network | 2 | 0 | 2 |
| Debugging | 8 | 3 | 5 |
| Memory | 12 | 0 | 12 |
| Extensions | 5 | 0 | 5 |
| Third-party | 2 | 0 | 2 |
| WebMCP | 2 | 0 | 2 |
| **总计** | **52** | **16** | **36** |

### 已实现的工具

| Tool | 对应 MCP 工具 | CDP Domain |
|------|--------------|------------|
| `browser_navigate` | `navigate_page` | Page.navigate |
| `browser_screenshot` | `take_screenshot` | Page.captureScreenshot |
| `browser_get_text` | - | Runtime.evaluate |
| `browser_evaluate` | `evaluate_script` | Runtime.evaluate |
| `browser_click` | `click` | Runtime.evaluate |
| `browser_type` | `type_text` | Runtime.evaluate |
| `browser_fill` | `fill` | Runtime.evaluate |
| `browser_hover` | `hover` | Input.dispatchMouseEvent |
| `browser_press_key` | `press_key` | Input.dispatchKeyEvent |
| `browser_handle_dialog` | `handle_dialog` | Page.handleJavaScriptDialog |
| `browser_wait` | `wait_for` | Runtime.evaluate |
| `browser_get_url` | - | Runtime.evaluate |
| `browser_list_tabs` | `list_pages` | Target.getTargets |
| `browser_switch_tab` | `select_page` | Target.activateTarget |
| `browser_new_page` | `new_page` | Target.createTarget |
| `browser_close_page` | `close_page` | Target.closeTarget |
| `browser_drag` | `drag` | Input.dispatchMouseEvent 序列 |

### 分阶段实现计划

#### Phase 1: 核心自动化（✅ 已完成）

| 工具 | 说明 | CDP 实现 |
|------|------|----------|
| `browser_fill` | 表单填写 | Runtime.evaluate + input event |
| `browser_hover` | 悬停元素 | Input.dispatchMouseEvent |
| `browser_press_key` | 按键 | Input.dispatchKeyEvent |
| `browser_handle_dialog` | 处理弹窗 | Page.handleJavaScriptDialog |
| `browser_new_page` | 新建标签页 | Target.createTarget |
| `browser_close_page` | 关闭标签页 | Target.closeTarget |
| `browser_drag` | 拖拽 | Input.dispatchMouseEvent 序列 |

#### Phase 2: 调试能力

| 工具 | 说明 | CDP 实现 |
|------|------|----------|
| `browser_take_snapshot` | a11y tree 快照 | Accessibility.getFullAXTree |
| `browser_list_console` | 控制台消息列表 | Log/Console domain |
| `browser_get_console` | 获取单条消息 | 内存缓存 |
| `browser_list_network` | 网络请求列表 | Network domain |
| `browser_get_network` | 获取请求详情 | Network domain |

#### Phase 3: 高级功能

| 工具 | 说明 | CDP 实现 |
|------|------|----------|
| `browser_performance_start` | 开始性能追踪 | Tracing.start |
| `browser_performance_stop` | 停止性能追踪 | Tracing.end |
| `browser_emulate` | 设备模拟 | Emulation domain |
| `browser_resize` | 调整窗口大小 | Emulation.setDeviceMetricsOverride |

#### Phase 4: 内存分析

| 工具 | 说明 | CDP 实现 |
|------|------|----------|
| `browser_heap_snapshot` | 堆快照 | HeapProfiler domain |
| `browser_heap_compare` | 堆对比 | 解析快照文件 |
| ... | 其他 heap 工具 | HeapProfiler domain |

#### Phase 5: 扩展功能（可选）

- Chrome Extensions 管理
- Lighthouse 审计
- Screencast 录制
- Third-party 开发者工具

## 已知限制

1. **需要手动启动浏览器** - 用户需要自己启动 Chrome/Edge 并加 `--remote-debugging-port`
2. **无自动重连** - 浏览器关闭后需要手动重连
3. **截图格式** - 当前只支持 PNG，后续可加 JPEG/WebP

## 架构决策记录

详见 [adr/](./adr/) 目录。
