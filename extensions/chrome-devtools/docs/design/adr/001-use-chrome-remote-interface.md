# ADR-001: 使用 chrome-remote-interface 作为 CDP 客户端

## 状态

Accepted

## 背景

需要通过 CDP (Chrome DevTools Protocol) 控制浏览器，Node.js 生态有多个选择。

## 决策

使用 `chrome-remote-interface` 作为 CDP 客户端库。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| `chrome-remote-interface` | 轻量、纯 CDP 封装、类型完善 | 需要自己处理底层细节 |
| `puppeteer-core` | 高层 API、自带浏览器管理 | 体积大 (~180MB)、引入不需要的抽象 |
| `playwright` | 自动管理浏览器、跨浏览器 | 体积更大 (~200MB)、过于重量级 |
| 原生 WebSocket | 零依赖 | 需要自己实现 CDP 协议，工作量大 |

## 后果

### 正面

- 依赖轻量，安装快
- 直接操作 CDP，灵活度高
- 用户已有浏览器，不需要自动管理
- TypeScript 类型完善

### 负面

- 需要自己处理一些底层细节（如元素定位）
- 用户需要手动启动浏览器

## 参考

- [chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
