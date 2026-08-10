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

### 为什么完全兼容 chrome-devtools-mcp？

1. **无缝切换**：用户可以从 MCP 无缝切换到 pi，无需改变使用习惯
2. **工具名称一致**：降低学习成本
3. **参数签名一致**：现有 prompt 和 skill 可以直接复用
4. **生态复用**：chrome-devtools-mcp 是 Google 官方维护的成熟项目

## 架构

```
┌─────────────────────────────────────┐
│  pi Extension (TypeScript)          │
│                                     │
│  52 个工具 (与 chrome-devtools-mcp  │
│  完全一致的名称和参数)              │
│         │                           │
│         ▼                           │
│  chrome-remote-interface (CDP)      │
│         │                           │
│         ▼                           │
│  Chrome/Edge (--remote-debugging-port)
└─────────────────────────────────────┘
```

### UID 系统

chrome-devtools-mcp 使用 uid（而非 CSS selector）定位元素：

1. `take_snapshot` 调用 `Accessibility.getFullAXTree` 获取 a11y tree
2. 为每个可交互元素分配唯一 uid
3. 建立 uid -> backendNodeId 映射
4. 后续工具使用 uid 操作元素

```
take_snapshot() -> uid1, uid2, uid3...
click({ uid: "uid1" }) -> 通过 backendNodeId 定位并点击
```

## 配置

支持三层配置，优先级：

1. **环境变量** `CHROME_DEBUG_PORT` - 临时覆盖
2. **项目配置** `.pi/chrome-devtools.json` - 项目级
3. **全局配置** `~/.pi/agent/chrome-devtools.json` - 全局默认
4. **默认值** `19999` - 兜底

## 工具实现

### Input automation (10/10)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `click` | DOM.focus + Input.dispatchMouseEvent | ✅ |
| `drag` | Input.dispatchMouseEvent 序列 | ✅ |
| `fill` | DOM.focus + Runtime.evaluate | ✅ |
| `fill_form` | 批量 fill | ✅ |
| `handle_dialog` | Page.handleJavaScriptDialog | ✅ |
| `hover` | Input.dispatchMouseEvent | ✅ |
| `press_key` | Input.dispatchKeyEvent | ✅ |
| `type_text` | Input.dispatchKeyEvent 序列 | ✅ |
| `upload_file` | DOM.setFileInputFiles | ✅ |
| `click_at` | Input.dispatchMouseEvent | ✅ |

### Navigation automation (6/6)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `close_page` | Target.closeTarget | ✅ |
| `list_pages` | Target.getTargets | ✅ |
| `navigate_page` | Page.navigate / Page.navigateToHistoryEntry / Page.reload | ✅ |
| `new_page` | Target.createTarget | ✅ |
| `select_page` | Target.activateTarget | ✅ |
| `wait_for` | Runtime.evaluate 轮询 | ✅ |

### Emulation (2/2)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `emulate` | Emulation domain | ✅ |
| `resize_page` | Emulation.setDeviceMetricsOverride | ✅ |

### Performance (2/3)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `performance_start_trace` | Tracing.start | ✅ |
| `performance_stop_trace` | Tracing.end | ✅ |
| `performance_analyze_insight` | 解析 trace 数据 | ⏳ |

### Network (2/2)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `list_network_requests` | Network domain | ✅ |
| `get_network_request` | Network.getResponseBody | ✅ |

### Debugging (5/8)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `evaluate_script` | Runtime.evaluate | ✅ |
| `get_console_message` | 内存缓存 | ✅ |
| `list_console_messages` | Log + Runtime.consoleAPICalled | ✅ |
| `take_screenshot` | Page.captureScreenshot | ✅ |
| `take_snapshot` | Accessibility.getFullAXTree | ✅ |
| `lighthouse_audit` | 需要集成 lighthouse | ⏳ |
| `screencast_start` | 需要 ffmpeg | ⏳ |
| `screencast_stop` | 需要 ffmpeg | ⏳ |

### Memory (2/12)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `take_heapsnapshot` | HeapProfiler.takeHeapSnapshot | ✅ |
| `compare_heapsnapshots` | 文件大小对比 | ✅ |
| `close_heapsnapshot` | 释放内存 | ⏳ |
| `get_heapsnapshot_*` (9 个) | 解析快照二进制格式 | ⏳ |

### Extensions (1/5)

| Tool | CDP 实现 | 状态 |
|------|----------|------|
| `list_extensions` | chrome.management API | ✅ |
| `install_extension` | 需要 pipe 连接 | ⏳ |
| `reload_extension` | chrome.management | ⏳ |
| `trigger_extension_action` | 模拟点击 | ⏳ |
| `uninstall_extension` | chrome.management | ⏳ |

### Third-party (0/2)

需要 Chrome 150+ `--enable-features=ThirdPartyDeveloperTools`

### WebMCP (0/2)

需要 Chrome 150+ `--enable-features=WebMCP`

## 已知限制

1. **需要手动启动浏览器** - 用户需要自己启动 Chrome/Edge 并加 `--remote-debugging-port`
2. **Memory 工具不完整** - 堆快照二进制格式解析复杂
3. **Third-party / WebMCP** - 需要 Chrome 150+ 实验特性
4. **Lighthouse / Screencast** - 需要额外依赖

## 架构决策记录

详见 [adr/](./adr/) 目录。
