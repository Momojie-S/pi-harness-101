# Chrome DevTools Extension

通过 CDP (Chrome DevTools Protocol) 控制已开启调试端口的 Chrome/Edge 浏览器。

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

配置文件格式：

```json
{
  "port": 19999
}
```

## 提供的 Tools

### Phase 1: 核心自动化

| Tool | 功能 |
|------|------|
| `browser_navigate` | 导航到 URL |
| `browser_screenshot` | 截图（支持元素/整页） |
| `browser_get_text` | 获取页面文本 |
| `browser_evaluate` | 执行 JS |
| `browser_click` | 点击元素 |
| `browser_type` | 输入文字 |
| `browser_fill` | 表单填写 (input/select/checkbox/radio) |
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

### Phase 2: 调试能力

| Tool | 功能 |
|------|------|
| `browser_list_console` | 列出控制台消息（支持按类型过滤） |
| `browser_get_console` | 获取单条消息详情 |
| `browser_list_network` | 列出网络请求（支持按资源类型过滤） |
| `browser_get_network` | 获取请求详情（请求头、响应头、请求体、响应体） |

## 提供的 Commands

| Command | 功能 |
|---------|------|
| `/chrome-port <port>` | 运行时切换调试端口 |
| `/chrome-status` | 查看连接状态和配置来源 |

## 设计文档

详见 [docs/design/](./docs/design/) 目录。
