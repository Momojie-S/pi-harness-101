# ADR-003: 防自吹用裁判硬性要求证据，废弃 gates/contract

## 状态

**Superseded** — 原"gates 确定性短路 + contract"方案已废弃，改为"裁判 prompt 硬性要求证据"。

## 背景

独立裁判路线（ADR-002）仍有一个残留风险：裁判读的是 agent 的回复文本，而 agent 可能在回复里**自吹**（"我已完成重构""测试全部通过"）。若裁判把这些自述当证据，仍会误判完成。

## 原方案（已废弃）

原 ADR-003 提出三层防御：
1. 裁判只读最后回复（不读 transcript）
2. contract verification 字段（`verify: npm test`）
3. quality gates 确定性短路（裁判前跑 shell 命令，失败直接续行）

## 废弃原因

1. **用户输入门槛太高**：contract 的多行 `verify:`/`constraints:`/`boundaries:`/`stop when:` 语法对普通用户来说太重，实际使用中几乎不会手写。
2. **行业无先例**：Claude Code 和 Codex 都没有确定性验证——Claude Code 用纯 LLM 裁判，Codex 靠 agent 自报。只有 Hermes 做了 gates/contract，但同样面临用户输入困难。
3. **MVP 裁判已足够**：纯 LLM 裁判在 prompt 里硬性要求"tool result 级证据（命令输出/文件内容/测试结果），不接受无证据自述"，实测效果良好（裁判多次判定 continue，理由是"agent 仅为自述完成，无命令输出级别证据"）。

## 现方案

**裁判 prompt 硬性要求证据**：

- 裁判 system prompt 明确规定：只接受 tool result 级证据，不接受"完成"/"测试通过"等无证据自述
- 缺证据 → continue（保守默认）
- goal 条件是自然语言，用户直接在里面写停止标准（如"修完 lint 错误，ruff check 通过为止"）
- 裁判 LLM 据此判断 done/continue，无需结构化语法

## 后果

### 正面

- 用户零学习成本：`/goal 修完 lint 错误，ruff check 通过为止`，停止标准直接写在条件里
- 实现简单：不需要 contract 解析器、gate 执行器、workspace fingerprint
- 对齐 Claude Code 主流做法

### 负面

- 没有"确定性短路"：裁判仍靠 LLM 判断证据是否充分，理论上可被骗（但实测裁判很严格）
- 无法 100% 防自吹（但 Claude Code 也没有，纯 LLM 判断在实测中已足够保守）

## 参考

- 三家对比：Claude Code（纯 LLM 裁判）、Codex（agent 自报）、Hermes（gates + contract）
- 废弃决策讨论：用户反馈"contract 让人输入有点困难"
