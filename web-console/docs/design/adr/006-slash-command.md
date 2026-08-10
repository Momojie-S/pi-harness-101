# ADR-006: /command 支持——prompt 与 SDK 方法分流

## 状态

Accepted

## 背景

需支持类似 CLI 的 `/command`。CLI 的命令分四类，执行机制不同：

- skills（`/skill:xxx`）、prompt 模板（`/name`）：prompt 展开
- extension 命令（`/mycommand`）：prompt 执行
- 内置命令（`/model` `/compact` `/new` `/tree` ...）：TUI 交互，**SDK 不通过 prompt 执行**

sdk.md 明确：内置 TUI 命令"不会通过 prompt 执行"。

## 决策

按命令类型分流：

- **skills/prompts**：走 `prompt`（SDK 自动展开/执行，与 CLI 完全一致）
- **内置命令**：model/compact/thinking 走 SDK 方法（setModel/compact/setThinkingLevel）；resume 走 SessionManager.list + open；tree 走 session.navigateTree + getTree；fork 走 sessionManager.createBranchedSession
- **extension 命令**：从 `extensionsResult.runtime.getCommands()` 提取，走 `prompt` 执行（与 CLI 一致）

命令列表来源：后端从 ResourceLoader 提取 skills/prompts；前端硬编码内置命令；输入 `/` 时合并 + 过滤 + 自动补全（↑↓ 选，Tab/Enter/点击 触发）。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 全部走 prompt | 简单 | 内置命令不执行 |
| 全部单独接 SDK | 一致 | skills/prompts 重复造轮子 |
| 分流（本决策） | 各用合适机制 | 实现复杂 |

## 后果

### 正面

- skills/prompts 与 CLI 完全一致（同 prompt 机制）
- 内置命令接 SDK 方法（model/compact/thinking 可用）

### 负面

- extension 命令已支持（`runtime.getCommands()`）
- 内置命令全部支持；new/abort 有 UI 等价（＋/停止）

## 参考

- [pi SDK - prompt 处理命令](../../../../node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- [pi RPC - get_commands](../../../../node_modules/@earendil-works/pi-coding-agent/docs/rpc.md)
