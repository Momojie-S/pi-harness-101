# Chrome DevTools Extension

完全兼容 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 的 pi extension，实现无缝切换。

## 前提

启动浏览器时加 `--remote-debugging-port`：

```bash
# Edge
msedge.exe --remote-debugging-port=19999 --user-data-dir="D:\path\to\profile"

# Chrome
chrome.exe --remote-debugging-port=9222
```

## 配置

端口配置优先级（高→低）：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 环境变量 `CHROME_DEBUG_PORT` | 运行时覆盖 |
| 2 | 项目配置 `.pi/chrome-devtools.json` | 项目级配置 |
| 3 | 全局配置 `~/.pi/agent/chrome-devtools.json` | 全局默认 |
| 4 | 默认值 `19999` | 兜底 |

## 工具列表 (52/52)

与 chrome-devtools-mcp 完全一致的工具名称和参数。

### Input automation (10/10)

| Tool | 说明 |
|------|------|
| `click` | 点击元素 (uid) |
| `drag` | 拖拽元素 |
| `fill` | 填写单个表单 |
| `fill_form` | 批量填写表单 |
| `handle_dialog` | 处理弹窗 |
| `hover` | 悬停元素 |
| `press_key` | 按键/组合键 |
| `type_text` | 输入文字 |
| `upload_file` | 上传文件 |
| `click_at` | 点击坐标 |

### Navigation automation (6/6)

| Tool | 说明 |
|------|------|
| `close_page` | 关闭页面 |
| `list_pages` | 列出页面 |
| `navigate_page` | 导航 (URL/前进/后退/刷新) |
| `new_page` | 新建页面 |
| `select_page` | 选择页面 |
| `wait_for` | 等待文字出现 |

### Emulation (2/2)

| Tool | 说明 |
|------|------|
| `emulate` | 设备模拟 (视口/UA/颜色/网络/位置) |
| `resize_page` | 调整页面大小 |

### Performance (3/3)

| Tool | 说明 |
|------|------|
| `performance_start_trace` | 开始性能追踪 |
| `performance_stop_trace` | 停止性能追踪 |
| `performance_analyze_insight` | 分析性能洞察 |

### Network (2/2)

| Tool | 说明 |
|------|------|
| `list_network_requests` | 列出网络请求 |
| `get_network_request` | 获取请求详情 |

### Debugging (8/8)

| Tool | 说明 |
|------|------|
| `evaluate_script` | 执行 JavaScript |
| `get_console_message` | 获取控制台消息 |
| `list_console_messages` | 列出控制台消息 |
| `take_screenshot` | 截图 |
| `take_snapshot` | 获取 a11y tree 快照 |
| `lighthouse_audit` | Lighthouse 审计 |
| `screencast_start` | 开始录屏 |
| `screencast_stop` | 停止录屏 |

### Memory (12/12)

| Tool | 说明 |
|------|------|
| `take_heapsnapshot` | 捕获堆快照 |
| `close_heapsnapshot` | 关闭堆快照 |
| `compare_heapsnapshots` | 比较堆快照 |
| `get_heapsnapshot_details` | 获取快照详情 |
| `get_heapsnapshot_summary` | 获取快照摘要 |
| `get_heapsnapshot_class_nodes` | 获取类的实例 |
| `get_heapsnapshot_dominators` | 获取支配树 |
| `get_heapsnapshot_duplicate_strings` | 获取重复字符串 |
| `get_heapsnapshot_edges` | 获取出边 |
| `get_heapsnapshot_object_details` | 获取对象详情 |
| `get_heapsnapshot_retainers` | 获取保留者 |
| `get_heapsnapshot_retaining_paths` | 获取保留路径 |

### Extensions (5/5)

| Tool | 说明 |
|------|------|
| `install_extension` | 安装扩展 |
| `list_extensions` | 列出扩展 |
| `reload_extension` | 重载扩展 |
| `trigger_extension_action` | 触发扩展动作 |
| `uninstall_extension` | 卸载扩展 |

### Third-party (2/2)

| Tool | 说明 |
|------|------|
| `list_3p_developer_tools` | 列出第三方工具 |
| `execute_3p_developer_tool` | 执行第三方工具 |

### WebMCP (2/2)

| Tool | 说明 |
|------|------|
| `list_webmcp_tools` | 列出 WebMCP 工具 |
| `execute_webmcp_tool` | 执行 WebMCP 工具 |

## 使用方式

### 基本流程

1. 先调用 `take_snapshot` 获取页面快照和元素 uid
2. 使用 uid 操作元素（click, fill, hover 等）
3. 操作后可选择 `includeSnapshot: true` 获取新快照

### 示例

```
1. take_snapshot() -> 获取 uid 列表
2. click({ uid: "uid5" }) -> 点击按钮
3. fill({ uid: "uid12", value: "hello" }) -> 填写输入框
4. take_screenshot() -> 截图查看结果
```

## 命令

| Command | 说明 |
|---------|------|
| `/chrome-port <port>` | 切换调试端口 |

## 特殊功能要求

| 功能 | 要求 |
|------|------|
| Third-party tools | Chrome 150+ `--enable-features=ThirdPartyDeveloperTools` |
| WebMCP | Chrome 150+ `--enable-features=WebMCP` |
| Lighthouse | 需要安装 `npm install -g lighthouse` |
| Screencast | 需要 ffmpeg |
