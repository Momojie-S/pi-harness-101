# goal — 自主循环直到目标完成

让 agent 自主工作直到你写的**自然语言条件**被满足。基于"Ralph loop"模式（同 Codex `/goal`、Hermes `/goal`、Claude Code `/goal`）：独立裁判模型每轮检查 agent 的进展，决定 **done / continue / wait / impossible**。

## 快速开始

```bash
# 安装（任选一种）
pi install git:github.com/Momojie-S/pi-harness-101   # GitHub 仓库
pi install /path/to/pi-harness-101                   # 本地路径

# 用法
/goal 修完所有 lint 错误，ruff check 通过为止
/goal 把 tests/ 下所有测试跑通
/goal --no-solo 帮我重构 auth 模块，每步都问我要做什么

# 查看状态
/goal status

# 暂停 / 恢复
/goal pause
/goal resume

# 清除目标
/goal clear
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `/goal <条件>` | 设置目标并启动循环。条件是自然语言——直接写"什么情况才算完成" |
| `/goal --solo <条件>` | 强制 solo 模式（无人值守，不求助） |
| `/goal --no-solo <条件>` | 强制非 solo 模式（每轮可交互） |
| `/goal status` | 查看当前目标、轮次、token、上次裁决 |
| `/goal pause` | 暂停循环（保留状态） |
| `/goal resume` | 恢复已暂停/失败的循环 |
| `/goal clear` | 清除目标 |
| `/goal solo on\|off` | 切换 solo 模式 |

## 停止条件怎么写

停止条件就是自然语言，**不要**用结构化语法。直接写清楚"什么情况才算完成"：

```bash
# ✅ 好的条件
/goal 修复 src/ 下所有 TypeScript 编译错误，tsc --noEmit 通过为止
/goal 把 auth 模块的测试覆盖率提到 80% 以上，pytest tests/auth/ 通过
/goal 把 README 翻译成英文，确保没有遗漏的中文段落

# ✅ solo 模式（默认）——不求助，自主决策
/goal 清理所有未使用的 import，确保 eslint 无 warning

# ❌ 不需要写结构化语法
/goal verify: npm test   # 不支持，直接写在条件里
```

裁判 LLM 会据此判断 agent 的回复是否提供了**工具结果级别的证据**（命令输出、文件内容、测试结果）。不接受无证据的自述（如只说"完成了"但没有输出）。

## solo 模式

**默认开启**（`solo: true`）。适合无人值守场景：

- agent 不向用户求助，自主决策
- `impossible` 连续 3 次（可配）→ 自动失败，不会无限空转
- 裁判证据要求更严格（防止自吹）

```bash
# 全局关闭 solo
echo '{"solo": false}' > ~/.pi/agent/goal.json

# 单次关闭
/goal --no-solo 帮我重构数据库层

# 运行时切换
/goal solo off
```

## 配置

两级合并，优先级：**内置默认 < 全局 < 项目级**。

### 全局配置 `~/.pi/agent/goal.json`

```jsonc
{
  "solo": true,                  // 无人值守默认（全局，含 TUI）
  "judgeModel": "zai-coding-cn/glm-4.7",  // 裁判模型；null=用当前模型
  "judgeMaxTokens": 1024,        // 裁判输出 token 上限（reasoning 模型建议调大）
  "tokenBudget": null,           // token 预算；null=不限
  "maxTurns": null,              // turn 预算；null=不限
  "soloImpossibleCap": 3,        // solo 连续 impossible 上限
  "maxParseFailures": 3,         // 裁判连续解析失败上限
  "maxTransportFailures": 3,     // 裁判连续 API 错误上限
  "maxWaitSeconds": 600,         // wait 最长等待秒数
  "judgeResponseChars": 4096,    // 读取 agent 最后回复的字符数
  "maxFormatRetries": 3,         // 裁判输出格式重试次数
  "prompts": {
    // 所有 prompt 模板均可覆盖，详见 design.md
  }
}
```

### 项目级配置 `{cwd}/.pi/goal.json`

同结构，覆盖全局。适合项目特定需求：

```jsonc
{
  "judgeModel": "openai/gpt-4o",
  "maxTurns": 50
}
```

## 裁判怎么工作

每轮 agent 空闲后：

1. 读取 agent 最后一条回复（`judgeResponseChars` 字符）
2. 裁判模型判断：done / continue / wait / impossible
3. **done** → 通知用户，循环结束
4. **continue** → 注入续行 prompt，agent 继续工作
5. **wait** → 等待指定秒数后恢复（agent 在等异步任务时）
6. **impossible** → solo 模式累计 3 次自动失败；非 solo 模式续行再试

裁判要求证据：只接受 tool result 级证据（命令输出、文件内容、测试结果），不接受无证据自述。

## 预算与安全

| 类型 | 默认 | 说明 |
|------|------|------|
| token 预算 | `null`（不限） | 总量预算，达到后停止 |
| turn 预算 | `null`（不限） | 总轮次预算，达到后停止 |
| impossible 上限 | 3 | solo 模式连续 impossible 自动失败 |
| 解析失败上限 | 3 | 裁判连续输出无法解析的格式 |
| API 错误上限 | 3 | 裁判连续 API 调用失败 |
| wait 超时 | 600s | wait 态最长等待 |

**推荐**：长任务设 token/turn 预算防失控。裁判用廉价模型省钱（如 GLM-4.7）。

## 进程重启恢复

goal 状态持久化在 session 文件中。web-console 或 TUI 重启后，`session_start` 检测到活跃 goal 会自动恢复循环。

## web-console 集成

- **notify** → 前端绿色系统通知（done/failed 等）
- **setStatus** → 状态栏显示 `goal 进行中 turns:N`
- 通过 UIContext 桥接，详见 [web-console extension-ui.md](../../web-console/docs/design/modules/extension-ui.md)

## 设计文档

- [完整设计](docs/design/design.md)：架构、数据流、裁判逻辑、prompt 模板、ADR
- [ADR-001](docs/design/adr/001-trigger-agent-settled-not-stop-hook.md)：为什么用 `agent_settled` 而非 Stop hook
- [ADR-002](docs/design/adr/002-judge-route-not-agent-self-managed.md)：为什么用独立裁判
- [ADR-003](docs/design/adr/003-anti-self-praise-gates-and-contract.md)：防自吹策略（已废弃 gates/contract，改用裁判硬性要求证据）
- [ADR-004](docs/design/adr/004-budget-token-and-turn-dual-track.md)：预算设计
- [ADR-005](docs/design/adr/005-all-modes-no-interactive-gate.md)：全模式启用
- [ADR-006](docs/design/adr/006-solo-attribute-and-judge-state-system.md)：solo 属性与裁判状态系统

## 参考

本扩展是对 Claude Code `/goal`、Codex `/goal`、Hermes `/goal` 的 pi 实现调研后设计的。详见 `docs/research/` 下的调研文档。
