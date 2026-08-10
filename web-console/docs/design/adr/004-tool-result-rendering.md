# ADR-004: 工具结果按类型差异化渲染

## 状态

Accepted

## 背景

agent 工具调用产生 toolResult 消息，需在 UI 渲染。不同工具的结果性质不同：

- `read`：文件完整内容（可能很大）
- `edit`/`write`：改动结果（edit 返回 unified patch）
- `bash`：命令输出

若统一截断显示，read 的大文件会糊屏，edit 的改动看不清。

## 决策

按工具类型差异化渲染 toolResult：

- **read**：不显示内容，只提示字符数；工具调用卡片（`🔧 read`）的路径可点击 → 文件查看器看完整
- **edit/write**：显示 **diff**（从 `tool_execution_end` 的 `result.details.patch`，unified patch 格式）
- **bash/其他**：显示输出（截断 800 字符）

工具调用卡片：read/edit/write 显示可点击路径，其他显示参数。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 统一截断 800 显示 | 简单 | read 糊屏、diff 看不清 |
| 统一不显示，都点路径 | 干净 | bash 输出也要点（割裂） |
| 按类型差异化（本决策） | 各得其所 | 实现稍复杂 |

## 后果

### 正面

- read 不糊屏（点路径看完整）
- edit/write 直观看到改动（diff）
- bash 输出直接显示

### 负面

- 需从 `tool_execution_end` 缓存 patch（end 事件无 args，要关联 toolCallId）

## 参考

- [pi SDK - edit 工具返回 details.patch](../../../../node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
