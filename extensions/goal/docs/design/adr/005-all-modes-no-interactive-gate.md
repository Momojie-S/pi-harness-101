# ADR-005: 全模式启用，不照搬 Claude Code 交互/非交互 gate

## 状态

Proposed

## 背景

Claude Code 的 `/goal` 有可见性/启用 gate（解包事实，见 `docs/research/goal/claude-code.md` §1）：

```js
get isHidden(){ return !Ln() },      // Ln = !isInteractive → 交互模式隐藏
isEnabled: ()=> Ln() || Ga(),        // 非交互 OR 远程工作区
```

合起来：**普通本地交互终端里 `/goal` 既隐藏又禁用**，只有非交互（headless/CI/程序化 harness）或远程工作区可用。推测理由：交互模式用户在场，agent 停了一眼能看到、手动"继续"即可；非交互/远程无人值守才需要自治完成。

pi 的场景更多元：
- **web-console**：程序化（程序化 harness）但人能看（手机可观察）——既非纯非交互，又非常适合 goal。
- **本地 TUI**：用户可能想"设个 goal 去吃饭，回来干完了"。
- pi 的 `registerCommand` 没有强制 isHidden/isEnabled gate 的需求。

## 决策

`/goal` 在 pi 的**所有模式**（TUI / web-console / SDK）可用，不设交互/非交互 gate。

## 备选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| **全模式启用**（采纳） | 适配 pi 多元场景（web-console/TUI 都能用）；用户自主决定是否用 | 交互模式用户可能误开 goal 导致意外烧 token |
| 照搬 Claude Code gate（仅非交互/远程） | 与 Claude Code 行为一致；防交互模式误触 | 与 pi 场景不符：web-console 既非纯非交互又适合 goal；本地 TUI 用户也被剥夺选择 |
| 仅程序化模式（web-console/SDK）启用 | 精准匹配"无人值守"语义 | 本地 TUI 用户失去"自主跑到完成"能力 |

## 后果

### 正面

- web-console（本项目核心场景之一）可用 goal，价值最大化。
- 本地 TUI 用户也能用，符合 pi"用户自主可控"基调。
- 实现简单（无需判断 mode）。

### 负面

- 交互模式下用户可能误开 goal 导致 token 消耗超出预期。缓解：① 默认 turn 预算（20）+ token 预算兜底（ADR-004）；② `/goal status` 透明展示进度；③ 逃逸键 `/goal clear`/`pause` 随时可停。
- 不与 Claude Code 的 gate 对齐，若有用户从 Claude Code 迁移可能预期不符。可在文档说明差异。

## 参考

- Claude Code gate：`docs/research/goal/claude-code.md` §1（`isHidden`/`isEnabled` 解包）
