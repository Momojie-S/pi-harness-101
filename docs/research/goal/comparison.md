# `/goal` 完成驱动循环：跨产品综合对比

> **目的**：把 Claude Code、Codex、Hermes、OpenClaw 四家的 `/goal`（完成驱动循环）放在一起对照，厘清「Ralph loop 家族」的真实谱系，并**纠正 `oss-comparison.md` 早期「goal 基本独一份」的误判**。
> **方式**：读四家源码（见各姐妹文档）。
> **日期**：2026-08-13
> **姐妹文档**：`goal/claude-code.md`、`goal/codex.md`、`goal/hermes.md`、`goal/openclaw.md`

---

## 0. 先纠正一个旧结论

`oss-comparison.md`（2026-08-12 早期对比，调研 AutoGPT/BabyAGI/LangGraph/CrewAI/MetaGPT/OpenHands）曾下结论：

> *"Claude Code 的「独立裁判 + 保守默认」在主流 OSS 里基本独一份。"*

**这个结论在当时调研范围内成立，但那轮漏掉了真正同类的 Codex/Hermes/OpenClaw。** 实际上：

- **Claude Code 的 `/goal` 并非独创**——它属于一个清晰的「Ralph loop / `/goal` 家族」，源头是 **Codex CLI 0.128.0**（Eric Traut, OpenAI）。
- **Hermes 的 `/goal` 明确 credit Codex**（*"our take on the Ralph loop, directly inspired by Codex CLI 0.128.0"*），并**同时借鉴了 Claude Code 的独立裁判思路**。
- **OpenClaw 的 `/goal` 是 Codex ThreadGoal 协议的忠实克隆**。
- 早期那轮调研的对象（AutoGPT/BabyAGI/LangGraph/CrewAI/MetaGPT/OpenHands）确实**都是「agent 自报 done + 固定迭代上限」范式**，没有完成驱动的 goal 循环——那部分结论仍然有效，只是**对照组选错了**：真正的同类是 Codex 系，不是这些通用 agent 框架。

> **修正后的一句话**：`/goal` 完成驱动循环是一个**有明确源头（Codex）、有传承（Hermes/OpenClaw）、有平行演化（Claude Code）的小家族**，不是任何一家的独创。

---

## 1. Ralph loop 家族谱系

```
                  Codex CLI 0.128.0（Eric Traut, OpenAI）
                  ── Ralph loop 源头 ──
                  • continuation loop（idle gate）
                  • 模型自报完成（update_goal）
                  • prompt 严格化自审
                        │
            ┌───────────┴───────────────┐
            ▼                           ▼
        Hermes                      OpenClaw
   （独立实现，credit Codex）       （克隆 Codex 协议）
   • 借 Codex 的 loop 引擎          • 同 get/create/update_goal
   • + 借 Claude Code 的独立 judge   • 同状态机 / blocked≥3 / token 预算
   • + 自创 contract/subgoal/gate   • 自家 runtime 无 loop（纯状态+提醒）
   • + 自创 /goal wait               • 委托 codex runtime 时继承 loop

   ┌─────────────────────────┐
   │  Claude Code（平行演化）  │  ← 不在 Codex 谱系，但与 Hermes 在
   │  • Stop hook（stop gate） │     「独立裁判」上趋同演化
   │  • 独立 Haiku 裁判         │
   │  • 缺证据=未完成保守默认    │
   └─────────────────────────┘
```

- **Codex → Hermes**：明确的灵感传承（Hermes 文档白纸黑字）。
- **Codex → OpenClaw**：协议级克隆（工具签名、状态机、prompt 措辞逐字一致）。
- **Codex ↔ Claude Code**：无直接证据表明互相借鉴；Claude Code 的 Stop-hook 架构与 Codex 的 idle-gate 架构是**独立解决同一问题（完成驱动续跑）的两种工程路径**。
- **Claude Code ↔ Hermes**：Hermes 的独立 judge 与 Claude Code 的 Haiku 裁判在「用一个独立廉价模型判 done」上**趋同**（是否直接借鉴未在文档说明，但设计高度相似）。

---

## 2. 完成判定的两种范式

这是家族内最锋利的分水岭。**「goal 到底什么时候算 done」有两种回答方式**：

### 范式 A：模型自报（agent self-report）

**代表**：Codex、OpenClaw

- 模型通过 `update_goal(status="complete")` 工具**自己**标记完成。
- **保守判定靠 prompt**：把「缺证据=未完成、不许缩范围、不许过早报 blocked」写进工具 description / continuation prompt / context line，靠主模型遵从指令来保守。
- **优点**：省掉一次额外的模型调用（每轮少一次推理），架构简单。
- **缺点**：完全依赖主模型的指令遵从能力——模型若「自我开脱」或「过早乐观」，没有第二道闸。

### 范式 B：独立裁判（separate judge model）

**代表**：Hermes、Claude Code

- 每轮后**单独跑一个（廉价）模型**读 transcript / 上一轮 response，判是否 done。
- **保守判定靠独立裁判 + 结构化裁决**：裁判和主模型利益分离，用结构化 schema（`{ok, reason, impossible?}` / `{verdict, reason}`）输出，默认「缺证据=未完成」。
- **优点**：第二道独立闸，抗主模型的自我开脱；可施加更强的保守默认。
- **缺点**：每轮多一次模型调用（成本、延迟、失败面）；judge 本身可能误判（Hermes 用 fail-open + 连续失败 auto-pause 兜底，Claude Code 用连续阻止上限兜底）。

> **趋同演化**：Hermes 选 B 但明确说借 Codex 的 loop 骨架——说明「loop 引擎」和「完成判定」是**两个正交的设计维度**，可以自由组合。Codex 给了 A+loop，Claude Code 给了 B+stop-hook，Hermes 拿 Codex 的 loop 换上 B 的裁判。

---

## 3. 续 turn 的三种触发点（循环的本质）

「完成驱动循环」的核心是「**不靠用户再发消息就继续**」。四家的触发点不同：

| 家族 | 触发点 | 机制 | 类比 |
|---|---|---|---|
| Codex | **idle gate**（线程空闲） | `continue_if_idle` → 注入 continuation steering → `start_turn_if_idle` | 主动续 |
| Hermes | **turn gate**（轮结束） | `evaluate_after_turn` → 返回 decision → caller 调 `run_conversation(continuation_prompt)` | 轮后判定续 |
| Claude Code | **stop gate**（想停止） | Stop hook 拦截 → 裁判判未达成 → **不结束 turn，置旗标重跑同 turn** | 拦截式续 |
| OpenClaw（自家 runtime） | **无 gate** | 靠用户/模型自然多轮；goal 只是状态+提醒 | 无循环 |

- **Codex 的 idle gate** 最「无缝」：线程一闲就续，用户无感。
- **Claude Code 的 stop gate** 最「硬」：不结束 turn、置 `stopHookActive` 旗标重跑——是「拦截停止」而非「发新消息」。
- **Hermes 的 turn gate** 最「对称」：每轮结束统一走 `evaluate_after_turn`，judge/gate/wait 都在这个决策点汇聚。
- **OpenClaw 最「轻」**：自家 runtime 根本不自动续——goal 是「让目标保持可见」，推进留给自然交互或 codex runtime。

> 这三种触发点对应三种哲学：**idle 即续**（Codex，最激进）、**轮后判定续**（Hermes，最可控）、**拦截停止续**（Claude Code，最贴 agent 意图）。

---

## 4. 四家逐维对照表

| 维度 | Claude Code | Codex | Hermes | OpenClaw |
|---|---|---|---|---|
| **完成判定** | 独立 Haiku 裁判 | 模型自报（update_goal） | 独立 judge（auxiliary.goal_judge） | 模型自报（update_goal，克隆 Codex） |
| **续 turn 触发** | stop gate（Stop hook） | idle gate（continue_if_idle） | turn gate（evaluate_after_turn） | 无（自家 runtime）；idle gate（codex runtime） |
| **裁决输出** | `{ok, reason, impossible?}` | （无裁决，工具调用） | `{verdict: done\|continue\|wait, reason}` | （无裁决，工具调用） |
| **保守默认** | 缺证据=未完成；impossible 门槛极高 | prompt 自审（continuation.md 强指令） | 缺证据=未完成；contract/subgoal 逐条核对 | prompt 自审（context line 指令） |
| **预算上限** | max_turns=200 + 连续阻止>8 | token_budget（可选）+ time | **max_turns=20** + judge 连续失败 auto-pause + gate retries | token_budget（可选） |
| **防死循环** | 连续阻止 cap + max_turns | blocked ≥3 次连续 + 预算 | max_turns + judge 失败 auto-pause + gate 耗尽 | blocked ≥3 次连续 + 预算 |
| **「永不可达」逃生** | ✅ impossible（独立判，门槛高） | ✅ blocked（模型自报，≥3 次） | ✅ judge 判 blocked/needs-input 算 done | ✅ blocked（模型自报，≥3 次） |
| **持久化** | 跨 resume（restored_on_resume） | state DB + restore_after_resume | SessionDB.state_meta（跨 resume + 压缩） | session store（session-key 维度，跨 channel） |
| **结构化契约** | ❌（自然语言条件） | ❌ | ✅ **completion contracts**（5 字段） | ❌ |
| **中途加验收** | ❌ | ❌ | ✅ **/subgoal** | ❌ |
| **确定性门** | ❌ | ❌ | ✅ **quality gates**（judge 前跑，exit 0） | ❌ |
| **后台等待** | ❌ | ❌ | ✅ **/goal wait** + judge 的 wait verdict | ❌ |
| **形态** | Stop hook（session-scoped） | Rust 扩展 + app-server 协议 | Python（2156 行）+ 全 gateway | TS + 模型工具 + 命令 + UI |
| **血缘** | 平行演化 | **家族源头** | 借 Codex loop + 借 Claude Code 裁判 + 自创护栏 | 克隆 Codex 协议 |

---

## 5. OpenCode：确认不在家族内

为 completeness，确认 `sst/opencode`（196k★）**没有 `/goal` 或任何完成驱动循环**：

- `packages/codemode/` 看似相关，实则是**工具编排语言**（给模型一个 `execute` 工具，在受限 JS 解释器里串联/并发多个工具调用，减少 agent round-trip）——和 goal/loop 无关。
- 全仓搜 `ralph` / `autonomous` / `continue_until` / `goal loop` 在 `src` 无实现命中。
- OpenCode 的「循环」就是标准的 agent tool-loop（模型自报 done + 无 goal 概念），与早期 `oss-comparison.md` 描述的通用 agent 范式一致。

⇒ OpenCode **不属于 Ralph loop 家族**。

---

## 6. 设计洞察

### 6.1 「loop 引擎」与「完成判定」是正交维度

Codex 证明了「模型自报 + loop」可行；Claude Code 证明了「独立裁判 + stop-hook」可行；Hermes 把两者拆开重组（Codex 的 loop + Claude Code 的裁判）。这说明这两个维度可以独立选型——未来的实现可以「Codex loop + Claude Code 裁判 + Hermes 的 gate」自由组合。

### 6.2 保守判定有三种落地，成本递增

1. **prompt 自审**（Codex/OpenClaw）：零额外调用，依赖指令遵从——最便宜、最依赖模型。
2. **独立裁判 + 保守默认**（Claude Code）：每轮一次廉价调用，裁判利益分离——中等成本、最抗开脱。
3. **独立裁判 + 结构化契约 + 确定性门**（Hermes）：judge 按 contract 逐条核对 + gate 机械验证——最贵、最强保证。

⇒ 「保守程度」≈「额外调用量」≈「工程复杂度」。选型是这三者的权衡。

### 6.3 预算单位反映信任模型

- **Codex/OpenClaw 用 token budget**：信「goal 花多少 token」可预测，给精确的 token 上限。
- **Hermes 用 turn budget（max_turns=20）**：信「轮数」比「token」更可控（token 受上下文长度/压缩影响波动大）。
- **Claude Code 用 max_turns=200 + 连续阻止>8**：双重上限——总轮数 + 连续被拦次数，后者专防「judge 死活不放行」。

> Claude Code 的 200 远大于 Hermes 的 20，反映**判定粒度不同**：Claude Code 每轮都拦（轻判定），Hermes 每轮跑完整 judge（重判定）——重判定下 20 轮已经是很长的自主运行。

### 6.4 Hermes 的「确定性门」是质变

其他三家的 done 判定**都是 LLM**（裁判或自审）。Hermes 的 quality gate 是**确定性 shell 命令必须 exit 0**——把「done」从「LLM 觉得 done」推进到「机械可验证 done」。这是家族里唯一引入非 LLM 判定层的实现，直接解决「LLM 判定不可靠」的根本问题。

### 6.5 跨 resume 是共识，跨 runtime 是新维度

- **跨 resume 持久化**：四家都做（goal 不随 session 结束丢失）。
- **跨 runtime 可移植**（OpenClaw 独有）：goal 状态与具体循环引擎解耦——自家 runtime 用轻量语义，codex runtime 继承完整 loop。这预示一个趋势：**goal 作为「runtime 无关的会话状态」**，而非绑死某种循环。

---

## 7. 给本仓（pi harness）的启示

若要在 pi 上实现 `/goal`，家族已给出成熟模板：

- **最小可行**：Codex 式（模型自报 + prompt 自审 + idle/turn gate 续跑）——最简单，无额外模型调用。
- **保守增强**：加 Claude Code 式独立裁判（用快速模型判 `{ok, reason, impossible?}`）——抗主模型开脱。
- **最强保证**：再加 Hermes 式 quality gate（shell 命令 exit 0 才算 done）——机械可验证。
- **别忽视**：跨 resume 持久化 + 预算上限 + 永不可达逃生（blocked/impossible）是任何实现的安全底线——四家都做。

> 详见各姐妹文档的实现细节。本仓若落地，建议先记 ADR（选「自报 vs 裁判」「idle/turn/stop gate」「预算单位」三个决策点），再实现。
