/**
 * Goal Extension for pi — 完成驱动的自主循环（Ralph loop）
 *
 * 设置一个持久目标，agent 每轮结束后由独立裁判判定是否达成；
 * 未达成则自动续行，直到完成 / impossible 连续超限 / 用户清除。
 *
 * 设计文档：extensions/goal/docs/design/design.md
 * 决策记录：extensions/goal/docs/design/adr/
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ============================================================
// 类型定义
// ============================================================

type GoalStatus = "active" | "paused" | "done" | "failed";

interface GoalState {
	condition: string;
	solo: boolean;
	status: GoalStatus;
	turnsUsed: number;
	tokensUsed: number;
	impossibleStreak: number;
	parseFailures: number;
	transportFailures: number;
	lastVerdict: string | null;
	lastReason: string | null;
	createdAt: number;
	// wait 状态（内存，不持久化）
	waitTimer: ReturnType<typeof setTimeout> | null;
}

type VerdictStatus = "done" | "continue" | "wait" | "impossible";

interface Verdict {
	status: VerdictStatus;
	reason: string;
	gaps?: string[];
	evidence?: string[];
	wait?: { seconds?: number };
}

interface GoalConfig {
	solo: boolean;
	judgeModel: string | null;
	judgeMaxTokens: number;
	tokenBudget: number | null;
	maxTurns: number | null;
	soloImpossibleCap: number;
	maxParseFailures: number;
	maxTransportFailures: number;
	maxWaitSeconds: number;
	judgeResponseChars: number;
	maxFormatRetries: number;
	prompts: Record<string, string>;
}

// ============================================================
// 默认配置 + 默认 Prompt 模板
// ============================================================

const DEFAULT_PROMPTS: Record<string, string> = {
	systemSolo: [
		"[GOAL 循环激活]",
		"你有一个活跃的持久目标：",
		"{{goal}}",
		"",
		"这不是普通问答——你处于自主工作循环中，目标是持续推进直到完成。",
		"收到以 [goal 续行] 开头的消息时，那是循环自动注入的信号，不是人类输入——没有人在线等你的回复。",
		"",
		"自主决策，直接采取行动。不使用对话语气（\"好的\"\"我来帮你\"），不要求助。",
		"遇到决策点选择最合理的方案继续推进。",
	].join("\n"),

	systemAttended: [
		"[GOAL 循环激活]",
		"你有一个活跃的持久目标：",
		"{{goal}}",
		"",
		"你处于自主工作循环中，目标是持续推进直到完成。",
		"收到以 [goal 续行] 开头的消息时，那是循环自动注入的信号。",
		"遇到真正需要用户决策的阻塞时，可以明确说明并停下来。",
	].join("\n"),

	start: [
		"[goal 启动] 持久目标已设置：",
		"{{goal}}",
		"",
		"现在开始第一轮工作。自主决策，直接采取行动（读文件/写代码/跑命令）。",
		"完成后用证据说明（命令输出/文件内容/测试结果），不要只说“完成”。",
		"遇到真正需要用户决策的阻塞时才停下；否则持续推进直到目标达成。",
	].join("\n"),

	continueSolo: [
		"[goal 续行] 裁判评估：目标尚未达成。",
		"差距：",
		"{{judgeGaps}}",
		"",
		"继续推进。完成后用证据说明（命令输出/文件内容/测试结果）。",
		"不要停下来等人，遇到决策点自主选择最合理方案继续。",
		"如果你在等待异步工作（build/test/CI），先检查其状态：完成则报告结果；未完成则报告预计剩余秒数然后停下。",
	].join("\n"),

	continueAttended: [
		"[goal 续行] 裁判评估：目标尚未达成。",
		"差距：",
		"{{judgeGaps}}",
		"",
		"继续推进。完成后用证据说明（命令输出/文件内容/测试结果）。",
		"若遇到真正需要用户决策的阻塞，明确说明并停。",
	].join("\n"),

	impossible: [
		"[goal 续行] 裁判评估：当前路径不通。",
		"原因：{{judgeReason}}",
		"换一个方向继续。重新审视目标和当前进展，自己寻找替代的实现路径、工具或假设。",
		"多数\"不可能\"只是\"此路不通\"，不是目标本身不可达。",
	].join("\n"),

	waitResume: [
		"[goal 续行] 你之前报告在等待异步工作，预计等待时间已到。",
		"检查异步工作状态，根据结果继续推进。",
	].join("\n"),

	judgeSystem: [
		"你是一个严格的裁判，评估自主 agent 是否达成用户设定的目标。",
		"你收到：目标文本、agent 最新回复。",
		"",
		"判定为四种之一：",
		"DONE — 目标完全满足：回复明确确认完成且附具体证据（命令输出/文件内容/测试结果），不接受\"做完了\"\"测试通过\"这类无证据自述；或回复说明目标不可达/被阻塞/需用户输入（视为 DONE，reason 说明阻塞）。",
		"CONTINUE — 未达成，有具体下一步。拿不准时返回这个。在 gaps 列出具体还差什么。",
		"WAIT — 未达成，但下一步该等异步工作（CI/build/测试在跑），现在行动是徒劳。只有真正在等异步结果才 WAIT，否则 CONTINUE。wait.seconds 给预计等待秒数。",
		"IMPOSSIBLE — 当前路径走不通。多数\"不可能\"是\"此路不通\"而非\"目标不可达\"。",
		"",
		"判定规则：",
		"- 只接受 tool result 级证据，不接受无证据自述；缺证据 → CONTINUE",
		"- 识别 agent 显式求助（\"需要用户确认/被阻塞\"）→ 不当 DONE",
		"- {{soloRule}}",
		"- reason 一句话，gaps/evidence 简短条目，整体精简",
		"",
		"只回复一行 JSON：",
		"{\"status\":\"done|continue|wait|impossible\",\"reason\":\"...\",\"gaps\":[...],\"evidence\":[...],\"wait\":{\"seconds\":N}}",
		"按 status 填相关字段。不要输出任何其他文字、不要 markdown 代码块。",
	].join("\n"),

	judgeUser: [
		"目标：",
		"{{goal}}",
		"",
		"agent 最新回复：",
		"{{lastResponse}}",
		"",
		"目标是否达成？done / continue / wait / impossible？",
	].join("\n"),

	judgeRetry: [
		"[格式错误，请更正]",
		"上次回复：{{lastRaw}}",
		"错误：{{parseError}}",
		"请只输出一个 JSON 对象（一行），不要其他文字、不要 markdown 代码块。",
	].join("\n"),
};

const DEFAULT_CONFIG: GoalConfig = {
	solo: true,
	judgeModel: null,
	judgeMaxTokens: 1024,
	tokenBudget: null,
	maxTurns: null,
	soloImpossibleCap: 3,
	maxParseFailures: 3,
	maxTransportFailures: 5,
	maxWaitSeconds: 600,
	judgeResponseChars: 4000,
	maxFormatRetries: 2,
	prompts: {},
};

// ============================================================
// 配置加载
// ============================================================

const CONFIG_DIR_NAME = ".pi";
const CONFIG_FILENAME = "goal.json";

/** 从单个 JSON 文件合并配置到 merged（不存在的字段保持原值） */
function mergeConfigFromFile(merged: GoalConfig, path: string): void {
	if (!existsSync(path)) return;
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<GoalConfig>;
		if (raw.solo !== undefined) merged.solo = raw.solo;
		if (raw.judgeModel !== undefined) merged.judgeModel = raw.judgeModel;
		if (raw.judgeMaxTokens !== undefined) merged.judgeMaxTokens = raw.judgeMaxTokens;
		if (raw.tokenBudget !== undefined) merged.tokenBudget = raw.tokenBudget;
		if (raw.maxTurns !== undefined) merged.maxTurns = raw.maxTurns;
		if (raw.soloImpossibleCap !== undefined) merged.soloImpossibleCap = raw.soloImpossibleCap;
		if (raw.maxParseFailures !== undefined) merged.maxParseFailures = raw.maxParseFailures;
		if (raw.maxTransportFailures !== undefined) merged.maxTransportFailures = raw.maxTransportFailures;
		if (raw.maxWaitSeconds !== undefined) merged.maxWaitSeconds = raw.maxWaitSeconds;
		if (raw.judgeResponseChars !== undefined) merged.judgeResponseChars = raw.judgeResponseChars;
		if (raw.maxFormatRetries !== undefined) merged.maxFormatRetries = raw.maxFormatRetries;
		if (raw.prompts && typeof raw.prompts === "object") {
			merged.prompts = { ...merged.prompts, ...raw.prompts };
		}
	} catch {
		// 配置解析失败，静默用已有值
	}
}

/** 加载配置：默认值 < 全局（~/.pi/agent/goal.json）< 项目级（{cwd}/.pi/goal.json） */
function loadGoalConfig(cwd: string): GoalConfig {
	const merged: GoalConfig = { ...DEFAULT_CONFIG, prompts: { ...DEFAULT_PROMPTS } };
	// 全局
	mergeConfigFromFile(merged, join(homedir(), ".pi", "agent", CONFIG_FILENAME));
	// 项目级（覆盖全局）
	mergeConfigFromFile(merged, join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME));
	return merged;
}

// ============================================================
// 占位符渲染
// ============================================================

/** 将列表渲染为 bullet 块 */
function renderList(items: string[] | undefined): string {
	if (!items || items.length === 0) return "";
	return items.map((g) => `- ${g}`).join("\n");
}

/** 渲染 prompt 模板：替换 {{name}} 占位符。无值→空串；未知占位符→原样保留 */
function renderPrompt(template: string, vars: Record<string, string | undefined>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
		const val = vars[name];
		return val !== undefined ? val : `{{${name}}}`;
	});
}

// ============================================================
// 文本提取
// ============================================================

/** 从 message content 提取纯文本（content 可能是 string 或 content block 数组） */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const text = (block as { text?: string }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("\n");
}

/** 截断文本到指定字符数，超长加省略标记 */
function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return text.slice(0, limit) + "… [truncated]";
}

// ============================================================
// 裁判回复解析
// ============================================================

interface ParseResult {
	verdict?: Verdict;
	parseError?: string;
}

/** 解析裁判回复：兼容纯 JSON / markdown 块 / 正则提取；验证必填字段 */
function parseJudgeResponse(raw: string): ParseResult {
	if (!raw || !raw.trim()) return { parseError: "empty response" };

	let text = raw.trim();
	// 剥离 markdown code fence
	text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "").trim();

	// 尝试直接解析
	let data: unknown = null;
	try {
		data = JSON.parse(text);
	} catch {
		// 失败则正则提取首个 {...}
		const match = text.match(/\{[\s\S]*\}/);
		if (match) {
			try {
				data = JSON.parse(match[0]);
			} catch {
				data = null;
			}
		}
	}

	if (!data || typeof data !== "object") {
		return { parseError: `not valid JSON (${truncate(raw, 120)})` };
	}

	const obj = data as Record<string, unknown>;
	const status = obj.status;
	if (typeof status !== "string" || !["done", "continue", "wait", "impossible"].includes(status)) {
		return { parseError: `status "${status}" not valid (expected done/continue/wait/impossible)` };
	}
	if (typeof obj.reason !== "string") {
		return { parseError: "reason missing or not a string" };
	}

	const verdict: Verdict = {
		status: status as VerdictStatus,
		reason: obj.reason,
	};
	if (Array.isArray(obj.gaps)) verdict.gaps = obj.gaps.map(String);
	if (Array.isArray(obj.evidence)) verdict.evidence = obj.evidence.map(String);
	if (obj.wait && typeof obj.wait === "object") {
		const w = obj.wait as { seconds?: unknown };
		if (typeof w.seconds === "number") verdict.wait = { seconds: w.seconds };
	}
	return { verdict };
}

// ============================================================
// 扩展主体
// ============================================================

export default function goalExtension(pi: ExtensionAPI) {
	let config: GoalConfig = DEFAULT_CONFIG;
	// goal 状态：per session（内存快速访问 + appendEntry 持久化）
	const goalBySession = new Map<string, GoalState>();
	// 并发控制：防止裁判重入
	let judging = false;
	// 当前 session id（从 session_start 获取）
	let currentSessionId = "";

	// --- 状态读写 ---

	function getGoal(): GoalState | undefined {
		return goalBySession.get(currentSessionId);
	}

	function setGoal(state: GoalState) {
		goalBySession.set(currentSessionId, state);
		persistGoal(state);
	}

	function clearGoal() {
		const g = getGoal();
		if (g?.waitTimer) clearTimeout(g.waitTimer);
		goalBySession.delete(currentSessionId);
		pi.appendEntry("pi-goal", { action: "clear", ts: Date.now() });
	}

	function persistGoal(state: GoalState) {
		// waitTimer 不可序列化，存时剔除
		const { waitTimer: _w, ...serializable } = state;
		pi.appendEntry("pi-goal", { action: "set", state: serializable, ts: Date.now() });
	}

	// --- session_start：恢复 goal 状态 ---

	pi.on("session_start", async (_event, ctx) => {
		currentSessionId = ctx.sessionManager.getSessionFile() ?? "default";
		// 首次加载配置
		config = loadGoalConfig(ctx.cwd);
		// 从 entries 恢复最后一条有效 goal
		let restored: GoalState | null = null;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "pi-goal") {
				const data = entry.data as { action?: string; state?: GoalState };
				if (data?.action === "set" && data.state) {
					restored = { ...data.state, waitTimer: null };
				} else if (data?.action === "clear") {
					restored = null;
				}
			}
		}
		if (restored) {
			goalBySession.set(currentSessionId, restored);
			// 重启恢复后循环会断：recoverPendingSession 不自动 continue（防 restart_server 自循环），
			// 导致 agent idle 无 agent_settled，goal 循环卡死。这里主动踢一脚恢复循环。
			if (restored.status === "active") {
				setTimeout(() => {
					const g = getGoal();
					if (!g || g.status !== "active") return;
					sendContinuation(ctx, "continueSoloOrAttended", { judgeGaps: "服务重启后恢复，继续推进" }, { force: true });
				}, 2000); // 延迟 2s 等 session 完全 ready（bind、recoverPendingSession 补 toolResult 等）
			}
		}
	});

	// --- before_agent_start：注入 system 框架（goal active 时）---

	pi.on("before_agent_start", async (event, _ctx) => {
		const goal = getGoal();
		if (!goal || goal.status !== "active") return event;
		const tpl = goal.solo ? config.prompts.systemSolo : config.prompts.systemAttended;
		const framework = renderPrompt(tpl, { goal: goal.condition });
		return {
			systemPrompt: event.systemPrompt + "\n\n" + framework,
		};
	});

	// --- agent_start：wait 取消（agent 被外部驱动）---

	pi.on("agent_start", async (_event, _ctx) => {
		const goal = getGoal();
		if (goal?.waitTimer) {
			clearTimeout(goal.waitTimer);
			goal.waitTimer = null;
		}
	});

	// --- session_compact：压缩后恢复 goal 循环 ---

	pi.on("session_compact", async (_event, ctx) => {
		const goal = getGoal();
		if (!goal || goal.status !== "active") return;
		// 手动压缩（agent idle）时 goal 循环会断：agent_settled 已触发过，不会再触发
		// overflow recovery 时 agent 会自己重试（isIdle=false → sendContinuation 自动跳过）
		sendContinuation(ctx, "continueSoloOrAttended", {
			judgeGaps: `上下文已压缩，继续推进（已用 ${goal.turnsUsed} 轮，上次裁决：${goal.lastVerdict ?? "-"}）`,
		});
	});

	// --- agent_settled：裁判 + 循环 ---

	pi.on("agent_settled", async (_event, ctx) => {
		const goal = getGoal();
		if (!goal || goal.status !== "active") return;
		if (judging) return; // 防重入
		if (goal.waitTimer) return; // wait 中，不跑裁判（等定时器恢复）

		judging = true;
		try {
			await runJudgeCycle(ctx);
		} finally {
			judging = false;
		}
	});

	// --- 裁判循环 ---

	async function runJudgeCycle(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]) {
		const goal = getGoal();
		if (!goal || goal.status !== "active") return;

		// 读 agent 最后回复
		const branch = ctx.sessionManager.getBranch();
		const lastEntry = [...branch].reverse().find(
			(e) => e.type === "message" && e.message?.role === "assistant",
		);
		const lastResponse = lastEntry?.message
			? truncate(extractText(lastEntry.message.content), config.judgeResponseChars)
			: "";
		if (!lastResponse.trim()) return; // 无实质回复，不判

		// 累加 token 预算（从最后一条 assistant 的 usage 读取）
		const usage = (lastEntry?.message as any)?.usage;
		if (usage?.totalTokens && typeof usage.totalTokens === "number") {
			const g0 = getGoal();
			if (g0) {
				g0.tokensUsed += usage.totalTokens;
				setGoal(g0);
			}
		}

		// 跑裁判（含重试）
		const result = await callJudge(ctx, lastResponse);
		if (!result) return; // 传输失败已处理

		const g = getGoal();
		if (!g || g.status !== "active") return; // 期间可能被 clear/pause

		// 处理 verdict
		handleVerdict(ctx, result, g);
	}

	/** 调用裁判（含格式重试），返回 verdict 或 null（传输失败） */
	async function callJudge(
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
		lastResponse: string,
	): Promise<Verdict | null> {
		const judgeModel = resolveJudgeModel(ctx);
		if (!judgeModel) {
			notify(ctx, "goal: 裁判模型不可用，跳过判定");
			return null;
		}

		const soloRule = getGoal()?.solo
			? "无人值守，误判完成代价大——证据不充分时倾向 CONTINUE 而非 DONE"
			: "正常力度判定";
		const systemPrompt = renderPrompt(config.prompts.judgeSystem, {
			soloRule,
		});
		const baseUserPrompt = renderPrompt(config.prompts.judgeUser, {
			goal: getGoal()?.condition ?? "",
			lastResponse,
		});

		// 多轮 messages（重试时累积历史）
		const messages: Array<{ role: string; content: unknown; timestamp: number }> = [
			{ role: "user", content: baseUserPrompt, timestamp: Date.now() },
		];

		for (let attempt = 0; attempt <= config.maxFormatRetries; attempt++) {
			let raw: string;
			try {
				const response = await ctx.modelRegistry.complete(
					judgeModel,
					{ systemPrompt, messages },
					{ cacheRetention: "none", sessionId: randomUUID() },
				);
				raw = response.content
					.filter((c: { type: string }) => c.type === "text")
					.map((c: { text?: string }) => c.text ?? "")
					.join("\n");
			} catch {
				// 传输失败（API/超时）
				const g = getGoal();
				if (g) {
					g.transportFailures++;
					if (g.transportFailures >= config.maxTransportFailures) {
						g.status = "failed";
						notify(ctx, `goal: 裁判连续传输失败 ${g.transportFailures} 次，已停止。用 /goal resume 重试`);
						setGoal(g);
					}
				}
				return null;
			}

			const parsed = parseJudgeResponse(raw);
			if (parsed.verdict) {
				// 成功：重置失败计数
				const g = getGoal();
				if (g) {
					g.parseFailures = 0;
					g.transportFailures = 0;
				}
				return parsed.verdict;
			}

			// 解析失败
			if (attempt < config.maxFormatRetries) {
				// 还有重试机会：追加格式反馈，多轮继续
				messages.push(
					{ role: "assistant", content: truncate(raw, 500), timestamp: Date.now() },
					{
						role: "user",
						content: renderPrompt(config.prompts.judgeRetry, {
							lastRaw: truncate(raw, 200),
							parseError: parsed.parseError ?? "unknown",
						}),
						timestamp: Date.now(),
					},
				);
			} else {
				// 重试用尽
				const g = getGoal();
				if (g) {
					g.parseFailures++;
					if (g.parseFailures >= config.maxParseFailures) {
						g.status = "failed";
						notify(ctx, `goal: 裁判连续输出格式错误 ${g.parseFailures} 次，已停止。考虑换裁判模型`);
						setGoal(g);
					}
				}
				// fail-open：当 continue
				return { status: "continue", reason: parsed.parseError ?? "format error, assuming continue", gaps: [] };
			}
		}
		return null;
	}

	/** 解析裁判模型：config.judgeModel > ctx.model */
	function resolveJudgeModel(
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
	): ReturnType<typeof ctx.modelRegistry.find> | typeof ctx.model | null {
		if (config.judgeModel) {
			const [provider, modelId] = config.judgeModel.split("/");
			if (!provider || !modelId) {
				notify(ctx, `⚠ goal: judgeModel 格式错误 "${config.judgeModel}"（应为 provider/modelId），改用默认模型`);
			} else {
				const m = ctx.modelRegistry.find(provider, modelId);
				if (m && ctx.modelRegistry.hasConfiguredAuth(m)) return m;
				notify(ctx, `⚠ goal: judgeModel ${config.judgeModel} 不可用或未配置认证，改用默认模型`);
			}
		}
		return ctx.model ?? null;
	}

	/** 处理裁判 verdict */
	function handleVerdict(
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
		verdict: Verdict,
		goal: GoalState,
	) {
		goal.lastVerdict = verdict.status;
		goal.lastReason = verdict.reason;
		goal.turnsUsed++;

		switch (verdict.status) {
			case "done":
				goal.status = "done";
				setGoal(goal);
				ctx.ui.setStatus("goal", undefined);
				notify(ctx, `✅ goal 达成：${verdict.reason}`);
				return;

			case "impossible": {
				if (!goal.solo) {
					// 非 solo：直接暂停
					goal.status = "paused";
					setGoal(goal);
					ctx.ui.setStatus("goal", "goal 已暂停");
					notify(ctx, `⏸ goal 判定不可达（非 solo）：${verdict.reason}。用 /goal resume 或 /goal clear`);
					return;
				}
				// solo：韧性，换方向
				goal.impossibleStreak++;
				if (goal.impossibleStreak >= config.soloImpossibleCap) {
					goal.status = "paused";
					setGoal(goal);
					ctx.ui.setStatus("goal", "goal 已暂停");
					notify(
						ctx,
						`⏸ goal 连续 ${goal.impossibleStreak} 次判定不可达，已暂停。用 /goal resume 继续，/goal clear 停止`,
					);
					return;
				}
				setGoal(goal);
				sendContinuation(ctx, "impossible", { judgeReason: verdict.reason });
				return;
			}

			case "wait": {
				const seconds = verdict.wait?.seconds;
				if (!seconds || seconds <= 0) {
					// 无目标：降级 continue
					sendContinuation(ctx, "continueSoloOrAttended", {
						judgeGaps: renderList(verdict.gaps?.length ? verdict.gaps : [verdict.reason]),
					});
					return;
				}
				// park：截断秒数 + setTimeout
				const waitSec = Math.min(seconds, config.maxWaitSeconds);
				goal.waitTimer = setTimeout(() => {
					const g = getGoal();
					if (!g || g.status !== "active") return;
					g.waitTimer = null;
					setGoal(g);
					// 到期检查：goal 仍 active 且 agent idle 才续行
					if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return;
					sendContinuation(ctx, "waitResume", {});
				}, waitSec * 1000);
				setGoal(goal);
				notify(ctx, `⏳ goal 等待异步工作（~${waitSec}s），到期自动续行`);
				return;
			}

			case "continue":
			default: {
				// continue 重置 impossible streak（取得了进展）
				goal.impossibleStreak = 0;
				// turn 预算检查
				if (config.maxTurns !== null && goal.turnsUsed >= config.maxTurns) {
					goal.status = "paused";
					setGoal(goal);
					ctx.ui.setStatus("goal", "goal 已暂停");
					notify(ctx, `⏸ goal 达到 turn 上限 ${config.maxTurns}，已暂停。用 /goal resume 继续`);
					return;
				}
				// token 预算检查
				if (config.tokenBudget !== null && goal.tokensUsed >= config.tokenBudget) {
					goal.status = "paused";
					setGoal(goal);
					ctx.ui.setStatus("goal", "goal 已暂停");
					notify(ctx, `⏸ goal 达到 token 上限 ${config.tokenBudget}（已用 ${goal.tokensUsed}），已暂停。用 /goal resume 继续`);
					return;
				}
				setGoal(goal);
				ctx.ui.setStatus("goal", `goal 进行中 turns:${goal.turnsUsed}`);
				sendContinuation(ctx, "continueSoloOrAttended", {
					judgeGaps: renderList(verdict.gaps?.length ? verdict.gaps : [verdict.reason]),
				});
				return;
			}
		}
	}

	/**
	 * 发送续行消息（user 触发器）
	 * @param opts.force 跳过 isIdle 检查——用于 start 场景（命令刚执行完，agent 处理完命令后必然 idle，
	 *   消息排队即可，不该因命令还在 turn 中就丢弃启动消息）
	 */
	function sendContinuation(
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
		kind: string,
		vars: Record<string, string | undefined>,
		opts?: { force?: boolean },
	) {
		const goal = getGoal();
		if (!goal || goal.status !== "active") return;
		// 发续行前再检查 idle（防竞态：裁判跑期间用户可能发了消息）；force 场景跳过
		if (!opts?.force && typeof ctx.isIdle === "function" && !ctx.isIdle()) return;

		let template: string;
		switch (kind) {
			case "start":
				template = config.prompts.start;
				break;
			case "impossible":
				template = config.prompts.impossible;
				break;
			case "waitResume":
				template = config.prompts.waitResume;
				break;
			case "continueSoloOrAttended":
				template = goal.solo ? config.prompts.continueSolo : config.prompts.continueAttended;
				break;
			default:
				template = goal.solo ? config.prompts.continueSolo : config.prompts.continueAttended;
		}
		const prompt = renderPrompt(template, { goal: goal.condition, ...vars });
		// setTimeout 异步发送：脱离 agent_settled handler 调用栈，避免在 settled 同步链路里触发新 turn 的时序风险。
		// 回调里复查 goal 状态 + idle（期间可能被 clear/pause/抢占）
		setTimeout(() => {
			const g = getGoal();
			if (!g || g.status !== "active") return;
			if (!opts?.force && typeof ctx.isIdle === "function" && !ctx.isIdle()) return;
			try {
				pi.sendUserMessage(prompt);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (msg.includes("compaction")) {
					// compaction 进行中（_compactionAbortController 锁），静默——session_compact handler 会恢复循环
				} else {
					// 非预期异常：通知用户，循环会中断
					notify(ctx, `⚠ goal 续行失败：${msg}。用 /goal resume 恢复`);
				}
			}
		}, 0);
	}

	/** 通知（兼容 TUI / 非 TUI） */
	function notify(
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
		msg: string,
	) {
		// 直接调 ctx.ui.notify：web-console 已注入 UIContext（ctx.ui 始终是 webConsoleUIContext）。
		// 不检查 ctx.hasUI——hasUI 可能在某些事件（如 agent_settled）中为 false（时序问题），
		// 但 ctx.ui 本身仍有效。hasUI 的 false 分支（console.log）只在真正无 UI 的环境（如纯 CLI print 模式）需要。
		ctx.ui.notify(msg, "info");
	}

	// ============================================================
	// 命令注册
	// ============================================================

	pi.registerCommand("goal", {
		description: "设置持久目标，自主循环直到完成",
		handler: async (args, ctx) => {
			// /goal status 或无参：显示状态
			if (!args.trim() || args.trim() === "status") {
				const g = getGoal();
				if (!g || g.status === "done" || g.status === "failed") {
					ctx.ui.notify("当前无活跃 goal", "info");
				} else {
					ctx.ui.notify(
						`goal: ${g.condition}\n状态: ${g.status} | solo: ${g.solo} | turns: ${g.turnsUsed} | impossible连击: ${g.impossibleStreak}/${config.soloImpossibleCap}\n上次: ${g.lastVerdict ?? "-"} ${g.lastReason ?? ""}`,
						"info",
					);
				}
				return;
			}

			// /goal clear
			if (args.trim() === "clear") {
				const g = getGoal();
				if (!g) {
					ctx.ui.notify("当前无活跃 goal，无需清除", "info");
					return;
				}
				clearGoal();
				ctx.ui.notify("goal 已清除", "info");
				return;
			}

			// /goal pause
			if (args.trim() === "pause") {
				const g = getGoal();
				if (!g || g.status !== "active") {
					ctx.ui.notify("当前无活跃 goal，无需暂停", "info");
					return;
				}
				if (g.waitTimer) {
						clearTimeout(g.waitTimer);
						g.waitTimer = null;
					}
				g.status = "paused";
					setGoal(g);
					ctx.ui.notify("goal 已暂停（用 /goal resume 恢复）", "info");
				return;
			}

			// /goal resume
			if (args.trim() === "resume") {
				const g = getGoal();
				if (!g || (g.status !== "paused" && g.status !== "failed")) {
					ctx.ui.notify("当前无可恢复的 goal（需 paused 或 failed 状态）", "info");
					return;
				}
				g.status = "active";
					g.impossibleStreak = 0;
					g.parseFailures = 0;
					g.transportFailures = 0;
					setGoal(g);
					ctx.ui.notify("goal 已恢复，继续循环", "info");
					// 触发一轮续行
					sendContinuation(ctx, "continueSoloOrAttended", { judgeGaps: "从暂停恢复，继续推进" });
				return;
			}

			// /goal solo on|off
			const trimmed = args.trim();
			if (trimmed === "solo" || trimmed.startsWith("solo ")) {
				const val = trimmed.slice(5).trim();
				const g = getGoal();
				if (!g) {
					ctx.ui.notify("无活跃 goal", "warning");
					return;
				}
				if (val === "on") g.solo = true;
				else if (val === "off") g.solo = false;
				else {
					ctx.ui.notify(`当前 solo: ${g.solo}（用 /goal solo on|off 切换）`, "info");
					return;
				}
				setGoal(g);
				ctx.ui.notify(`goal solo 已切换为 ${g.solo}`, "info");
				return;
			}

			// /goal <条件> 或 /goal --solo <条件> 或 /goal --no-solo <条件>
			let solo = config.solo;
			let condition = args;
			if (args.trim().startsWith("--solo")) {
				solo = true;
				condition = args.trim().slice(6).trim();
			} else if (args.trim().startsWith("--no-solo")) {
				solo = false;
				condition = args.trim().slice(9).trim();
			}
			if (!condition) {
				ctx.ui.notify("用法: /goal <条件>（可选 --solo / --no-solo）", "warning");
				return;
			}

			// 如果有旧 goal 在跑，先清
			const old = getGoal();
			if (old?.waitTimer) clearTimeout(old.waitTimer);

			const state: GoalState = {
				condition,
				solo,
				status: "active",
				turnsUsed: 0,
				tokensUsed: 0,
				impossibleStreak: 0,
				parseFailures: 0,
				transportFailures: 0,
				lastVerdict: null,
				lastReason: null,
				createdAt: Date.now(),
				waitTimer: null,
			};
			setGoal(state);
			ctx.ui.notify(
				`⊙ goal 已设置（solo=${solo}）：${condition}\nagent 工作后会自动循环判定。用 /goal clear 停止`,
				"info",
			);
			// 触发第一轮工作（force：命令刚执行完，绕过 isIdle 竞态检查；无 agent turn = 无 agent_settled = 循环死在起点）
			ctx.ui.setStatus("goal", "goal 进行中");
			sendContinuation(ctx, "start", {}, { force: true });
		},
	});
}
