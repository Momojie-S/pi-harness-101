# 0009. description:触发为主 + 可带 purpose + 要 pushy(对齐 Anthropic 官方)

- **Status**: accepted
- **Date**: 2026-08-09

## Context
本 skill 原 §1.3 规定 description「**只写触发,不写 purpose**」。但查 Anthropic 官方(skill-creator SKILL.md、platform docs best-practices)发现冲突:

1. **description 是调用主机制(primary mechanism)**:Claude 凭它决定是否调用 skill。
2. **应含 purpose + trigger 两块**(官方):不只触发,还要一句「做什么」。
3. **要 pushy 防 under-trigger**(官方原话):Claude 倾向**漏触发** skill,description 要显式「凡是 X/Y/Z 都用,即使没明说要」。

**实测证据(为何要改)**:`od-dev-progress-tracking` 的 description 原只写「做复杂任务时用」,**没说「写/改进度记录时」必看** → 写进度记录时 skill 根本不触发 → 进度文件被写成线性流水(违反其任务树状态机规范),被用户连纠正两次。根因之一是 description 不 pushy、没覆盖「写进度记录」这个次场景。

## Decision Drivers
- **对齐官方**:官方是 skill 机制的权威,自造规则(只写触发)不应与之冲突。
- **实测有效**:progress-tracking 的 under-trigger 证明「不 pushy / 漏次场景」会直接导致 skill 不被调用 → 形同没有。

## Considered Options
1. **保持「只写触发不写 purpose」**:与官方冲突 + 已证实 under-trigger(否)。
2. **description 写完整 purpose 总结 + workflow**:official 明确反对 —— 写流程 agent 照 description 行事、不读正文(否;见 §1.3 陷阱)。
3. **触发为主 + 可带一句 purpose + 要 pushy**(选中):对齐官方 + 防 under-trigger + 不写 workflow。
4. **全盘照搬官方、删本地细化**:官方是高层 best-practice,本 skill 的「边界测试 / 负向路由 / keyword」等细化是补充,不冲突,保留。

## Decision
选 3:description = **主触发器**(primary mechanism);**以触发为主 + 可带一句 purpose(做什么);绝不总结 workflow;要 pushy**(显式列触发场景 +「凡是 X 都用,即使没明说」)。本 skill §1.3(line 26 / 规则1 / SKILL.md 摘要)已按此改。具体项目事故(如 progress-tracking under-trigger)不进 SKILL.md 正文(守 ADR-0003),只进本 ADR 作证据。

## Consequences
- **正向**:skill 更易在正确时机触发(尤其次场景 / 写记录类低显性触发);对齐官方不易再被质疑。
- **负向**:pushy 措辞略增 description 长度(守 ~100 词 / 1024 上限);过度 pushy 可能误触发 —— 靠「不写 workflow + 负向路由」平衡。
- **边界**:不写 workflow 这条不变(官方同);purpose 只能一句,非总结。

## Links
- 本 skill §1.3(line 26 + 规则1 + 长度)+ SKILL.md 摘要;ADR-0003(方法论不写例子 —— 故事故进 ADR 不进 skill)。
- 官方来源:[Anthropic skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)、[best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)。
