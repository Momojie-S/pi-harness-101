# ADR-002: 功能范围对齐 chrome-devtools-mcp

## 状态

Accepted

## 背景

chrome-devtools-mcp 是 Google 官方的 Chrome DevTools MCP Server，提供 52 个工具，覆盖：
- Input automation (10)
- Navigation (6)
- Emulation (2)
- Performance (3)
- Network (2)
- Debugging (8)
- Memory (12)
- Extensions (5)
- Third-party (2)
- WebMCP (2)

我们需要决定实现哪些功能。

## 决策

分阶段实现，优先覆盖最常用的自动化和调试功能：

1. **Phase 1**: 核心自动化 - 补齐 input/navigation 工具
2. **Phase 2**: 调试能力 - console、network 监控
3. **Phase 3**: 高级功能 - performance、emulation
4. **Phase 4**: 内存分析 - heap snapshot 系列
5. **Phase 5**: 扩展功能（可选）- extensions、lighthouse

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 一次性实现全部 52 个 | 功能完整 | 工作量大，很多工具不常用 |
| 只实现最常用的 10 个 | 快速可用 | 功能不足，需要频繁扩展 |
| 分阶段实现 | 渐进式，可验证 | 需要规划 |

## 后果

### 正面

- 快速获得核心功能可用
- 每个阶段可验证设计是否合理
- 可根据实际使用调整优先级

### 负面

- 前期功能不完整
- 需要多次迭代

## 参考

- [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [Tool Reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
