/**
 * 智谱 GLM-4.6V 视觉模型 HTTP 调用。
 *
 * 完整复刻自 @z_ai/mcp-server build/core/chat-service.js 的 visionCompletions / chatCompletions：
 * 就是 POST {endpoint}/chat/completions，body 里带 model=glm-4.6v、thinking=enabled。
 * 没有任何协议层封装——纯 fetch。
 */

import { loadVisionConfig } from "../config.ts";

export interface TextPart {
	type: "text";
	text: string;
}
export interface ImagePart {
	type: "image_url";
	image_url: { url: string };
}
export interface VideoPart {
	type: "video_url";
	video_url: { url: string };
}
export type ContentPart = TextPart | ImagePart | VideoPart;

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string | ContentPart[];
}

/**
 * 调 GLM-4.6V 视觉模型，返回生成的文本内容。
 * 抛出 Error（含可读的中文提示）供工具 execute 捕获后回传给 agent。
 */
export async function visionChat(messages: ChatMessage[]): Promise<string> {
	const cfg = loadVisionConfig();
	if (!cfg.apiKey) {
		throw new Error(
			"未配置智谱 API Key。请设置环境变量 ZAI_CODING_CN_API_KEY（coding plan，推荐——" +
				"pi 的 zai-coding-cn provider 用的就是它，若已配默认模型 zai-coding-cn/glm-5.2 则已就绪）" +
				"或 Z_AI_API_KEY。",
		);
	}

	// 请求体与 @z_ai/mcp-server 完全一致
	const body = {
		model: cfg.model,
		messages,
		thinking: { type: "enabled" },
		stream: false,
		temperature: cfg.temperature,
		top_p: cfg.topP,
		max_tokens: cfg.maxTokens,
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), cfg.timeout);
	try {
		const res = await fetch(cfg.endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiKey}`,
				"Content-Type": "application/json",
				"Accept-Language": "en-US,en",
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			// 常见错误给出针对性提示
			if (res.status === 401) {
				throw new Error(`智谱 API 鉴权失败(401)，请检查 API Key（来源 ${cfg.keySource}）：${text}`);
			}
			throw new Error(`智谱 API HTTP ${res.status}：${text.slice(0, 500)}`);
		}

		const json = (await res.json()) as {
			choices?: { message?: { content?: string } }[];
		};
		const content = json.choices?.[0]?.message?.content;
		if (typeof content !== "string" || !content) {
			throw new Error(`智谱 API 返回缺少 content：${JSON.stringify(json).slice(0, 500)}`);
		}
		return content;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(`智谱 API 请求超时（${cfg.timeout}ms），模型可能仍在思考，可重试或调大 Z_AI_TIMEOUT`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}
