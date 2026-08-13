# Hermes 的 Cron 机制调研

> **调研方式**：读 `NousResearch/hermes-agent` 仓库源码（`cron/scheduler.py` + `hermes_cli/cron.py` + 文档）
> **仓库版本**：`fa83af3`（2026-08-13）｜**调研日期**：2026-08-13
> **姐妹文档**：`cron/claude-code.md`（交互会话内的轻量 cron）、`cron/openclaw.md`（automations+heartbeat 双机制）、`cron/comparison.md`

## 来源标记

| 标记 | 含义 |
|---|---|
| 📦【源码】 | 读仓库源码（`cron/`、`hermes_cli/`）确认 |
| 📄【文档】 | 读 `website/docs/` 确认 |

---

## 0. TL;DR

- Hermes 的 cron 是一个 **headless 的自动化调度服务**，不是「交互会话内的定时注入」📦——gateway daemon 每 60s 独立 tick，在**全新 fresh session** 里跑 job，不依赖任何交互会话是否空闲。
- 与 Claude Code cron 的根本分野 📦：Claude Code 把 cron 当「用户回合之间的提示」（仅 REPL 空闲触发、忙时跳过）；Hermes 把 cron 当「独立的后台调度器」（进程在就触发、独立 session）。这呼应了 `oss-comparison.md` 的洞察——**交互编码 agent 里 cron 罕见，daemon/server 形态才常见**。
- **4 种调度格式** 📦：相对延迟（`30m`）/ 间隔（`every 2h`）/ cron 表达式（5 字段）/ ISO 时间戳。
- **agent 参与可选** 📦：可 `no_agent=True`（纯脚本，stdout 直接交付，零 LLM 调用）；或 `wakeAgent:false` pre-run gate（$0 轮询，状态没变就跳过 agent）。
- **丰富的工程化** 📦：20+ 平台 delivery、skill 附着、job 链（`context_from`）、preflight 验证、model drift guard、provider recovery、silent suppression、continuable jobs、执行历史 ledger、Chronos 托管（scale-to-zero）。
- **安全** 📦：prompt-injection / credential-exfiltration 扫描（create/update 时）+ 递归防护（cron session 内禁用 cron 工具）。

---

## 1. 架构：headless gateway scheduler 📦【源码】

核心在 `cron/scheduler.py`（调度循环）+ `cron/jobs.py`（存储）+ `tools/cronjob_tools.py`（模型工具）+ `gateway/run.py`（gateway 集成）。

```
gateway 进程（常驻 daemon）
  │
  ├── cron ticker 线程：每 60s 调 scheduler.tick()
  │     │
  │     ▼ tick()
  │     │ ① 获取 file lock（~/.hermes/cron/.tick.lock，fcntl/msvcrt 跨进程）
  │     │ ② 从 jobs.json 加载所有 job
  │     │ ③ 过滤 due job（next_run_at <= now AND state == "scheduled"）
  │     │ ④ 每个 due job：
  │     │     claim_dispatch（job 级 dedup flag，防同 job 并发跑）
  │     │     → 独立线程池跑（不持 tick lock，长 job 不阻塞其他 job）
  │     │     → fresh AIAgent session（无历史）+ 注入 skills + 跑 prompt
  │     │     → 交付响应 + 更新 run_count/next_run_at
  │     │ ⑤ 写回 jobs.json（atomic write）
  │     │ ⑥ 释放 lock
  │     ▼
  └── 每个 job 在独立线程，互不阻塞
```

> **关键**：cron 与交互会话**完全解耦**。job 在 fresh session 跑，结果 delivery 到配置的平台——不会注入任何正在进行的对话。这与 Claude Code「注入同 session（queuePriority=later）」截然不同。

---

## 2. 调度模型 📦📄【源码+文档】

**4 种调度格式** 📄：

| 格式 | 示例 | 行为 |
|---|---|---|
| 相对延迟 | `30m` / `2h` / `1d` | one-shot，延迟后触发 |
| 间隔 | `every 2h` | recurring，固定间隔 |
| cron 表达式 | `0 9 * * *` | 标准 5 字段 |
| ISO 时间戳 | `2025-01-15T09:00:00` | one-shot，精确时刻 |

**repeat 行为** 📄：one-shot 默认跑 1 次；interval/cron 默认 forever；可用 `repeat=N` 覆盖（跑 N 次后 state→completed）。

**模型面是单个统一工具** 📄：`cronjob(action=create|list|update|pause|resume|run|remove, ...)`——action 风格，而非分离的 schedule/list/remove 工具。自然语言、`/cron` 命令、`hermes cron` CLI 都走这个工具。

---

## 3. 漏触发与并发处理 📦【源码】—— 关键对比点

| 问题 | Hermes 的处理 |
|---|---|
| **tick 重叠**（多进程同时 tick） | **跨进程 file lock**（fcntl.flock on Unix / msvcrt.locking on Windows）：获取不到锁 → tick 立即返回 0，不跑 |
| **同 job 并发**（同 job racing） | **job 级 dedup flag**（`claim_dispatch` + running flag）：racing thread 看到 flag 就 skip，同 job 同时只跑一次 |
| **长 job 阻塞 tick** | job 在**独立线程池**跑（不持 tick lock），15+ min 的 job 不影响其他 due job 触发 |
| **daemon 挂了恢复** | next_run_at 是未来时间 → 恢复后等下一个边界，**不补跑过去的**（不 catch-up） |
| **ticker 静默死亡** | **健康监测**：heartbeat + last-successful-tick 标记；>200s（3 tick + slack）无心跳或无成功 tick → `hermes cron status` 报警 *"ticker STALLED"* |

> 对比 Claude Code：Claude Code 的「漏触发」是**忙时跳过**（REPL 忙就丢这次，等下一个）；Hermes 的「漏触发」是**daemon 停了恢复后等下一个**。两者都**不补跑、不排队**，但触发前提不同：Claude Code 要 REPL 空闲，Hermes 只要 daemon 在跑。这正是 `oss-comparison.md` 说的「daemon/server 形态 vs 交互会话内」的分野。

---

## 4. job 执行与会话隔离 📦【源码】

每个 due job 📄📦：
1. 创建**全新 fresh AIAgent session**（无对话历史、无之前 cron 执行的记忆）
2. 按序**注入附着的 skills**（SKILL.md 作为 context）
3. 跑 job prompt 到完成
4. 交付响应到配置的 `deliver` 目标
5. 更新 run_count + 计算 next_run_at

**隔离要点** 📦：
- **递归防护**：cron session 内禁用 `cronjob` 工具——防 job 创建新 job 的 scheduling loop。
- **memory 跳过**：cron agent 构造时 `skip_memory=True`（不读写持久记忆），除非 job 显式需要。
- **prompt 必须自包含**：cron job 不能问澄清问题（没人回答）。

---

## 5. agent 参与的可控性 📦📄—— Hermes 的独特点

### no-agent 模式（纯脚本，零 LLM）

`no_agent=True` 📄：scheduler 直接跑脚本，stdout（trimmed）原样交付，**完全不碰 inference 层**。空 stdout → 静默 tick（watchdog 模式：只在出错时说话）。非零退出/超时 → 错误告警（防坏 watchdog 静默失败）。

### wakeAgent gate（$0 轮询）

pre-run script（`script=`）在 agent 之前跑 📄，最后一行输出 `{"wakeAgent": false}` → 跳过 agent turn，**零 token**。脚本可返回 `{"wakeAgent": true, "context": {...}}` 把状态透传给 agent。

适用：每 1-5 min 的频繁轮询，只在状态真变了时唤醒 LLM。文档给了三种 recipe 📄：file-change gate（文件 mtime 变才跑）、external-flag gate（外部信号）、SQL-count gate（新行数 >0 才跑）。

> 这两层是 Hermes 对「cron 不该为每个 tick 烧 token」的直接回答——Claude Code 没有这个维度（每次 cron 都是一次 agent turn）。

---

## 6. 交付模型 📄【文档】

**20+ 平台** 📄：telegram / discord / slack / whatsapp / signal / matrix / email / sms / mattermost / dingtalk / feishu / wecom / weixin / bluebubbles(iMessage) / qqbot / homeassistant / origin / local + `all`（fan-out 所有已连接平台）。

- **target 解析在 fire time** 📄：job 可命名一个还没连接的平台，连接后自动开始交付。
- **`all` 扩展在 fire time** 📄：连接新平台后下次 tick 自动纳入。
- **silent suppression** 📄：响应含 `[SILENT]` → 不交付（但本地存档）；失败 job 总是交付（不受 `[SILENT]` 影响）。
- **continuable jobs** 📄（opt-in）：delivery 可变成可回复会话（thread-preferred，recurring job 每次开新 thread）。
- **response wrapping** 📄：默认包 header/footer（标注来自 scheduled task），可关。

---

## 7. 工程化护栏 📦📄

| 护栏 | 作用 |
|---|---|
| **preflight 验证** 📄 | dispatch 前检查配置（API key 解析、skills 就绪、delivery target 有凭证）；失败 → `blocked_config`，**不花 token**，只告警一次 |
| **model drift guard** 📄 | unpinned job 的 model 变化时 **fail-closed**：跳过运行、不调 inference、告警用户 pin 模型（防无人值守 job 静默继承付费模型） |
| **provider recovery** 📄 | job 继承 fallback_providers + credential pool rotation（rate-limit 时自动切 key/provider） |
| **execution ledger** 📄 | `~/.hermes/cron/executions.db` 记每次 attempt（claimed→running→completed/failed/unknown）；重启后 abandoned attempt 标 `unknown`（审计记录，不自动重跑） |
| **context_from（job 链）** 📄 | Job B 的 prompt 自动 prepend Job A 最近成功输出——多阶段 pipeline（collect→filter→format→deliver） |

---

## 8. Chronos 托管 cron（scale-to-zero） 📄【文档】

hosted gateway 可用 `cron.provider: chronos` 📄：让 idle gateway **scale to zero** 仍能 fire cron——不为每个 job 跑 60s in-process loop（会让进程常驻），而是让 Nous 基础设施在 job 的真实 next-fire 时间 arm **一个 managed one-shot**；fire 时 Nous 通过认证 webhook（`POST /api/cron/fire`）回调 gateway，gateway 跑完 job 再 arm 下一个 one-shot。fire 之间进程可完全停止。

> 这是 Hermes 把「cron 触发」做成**可插拔 provider** 的体现 📦：`resolve_cron_scheduler()` 按 `cron.provider` 选 built-in in-process ticker 还是 Chronos；provider 挂了自动 fallback 到 built-in（cron 永远不会没 trigger）。execution/delivery 逻辑共享（`run_job()`），provider 只控制 **trigger**。

---

## 9. 安全 📦📄

- **prompt-injection / credential-exfiltration 扫描** 📄：create/update 时扫 prompt（不可见 Unicode 技巧、SSH 后门、秘密外泄载荷 → 阻止）。注意：是**创建时**扫，不是 fire 时（Claude Code 是 fire 时过 auto-mode 分类器）。
- **递归防护** 📦：cron session 内禁用 `cronjob` 工具。
- **subprocess env 清理** 📄：no-agent 脚本的 env 被清理（provider API credentials 等 Hermes 管理的 secret **不继承**给 cron 脚本）。

---

## 10. 在 cron 家族里的定位

| 维度 | Hermes cron |
|---|---|
| 架构 | **headless gateway daemon**（独立调度服务） |
| 触发前提 | daemon 在跑即可（不依赖交互会话） |
| 漏触发 | daemon 恢复后等下一个（不补跑）+ 健康监测 |
| 存储 | `~/.hermes/cron/jobs.json`（atomic write）+ `executions.db`（ledger） |
| 调度格式 | 4 种（相对/间隔/cron/ISO） |
| agent 参与 | 可选（no-agent / wakeAgent gate） |
| 交付 | 20+ 平台 + origin/local + all |
| 安全 | prompt 扫描（create 时）+ 递归防护 |
| 独有 | Chronos 托管、job 链、preflight、model drift guard、skill 附着 |

> Hermes 的 cron 是一个**完整的自动化平台**——从 $0 轮询（wakeAgent gate）到托管 scale-to-zero（Chronos），从 job 链到 provider recovery。它的复杂度远超 Claude Code 的会话内定时注入，因为它的定位是「无人值守的自治调度」，不是「对话中的定时提醒」。
