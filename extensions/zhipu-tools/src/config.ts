/**
 * 共享配置：智谱 API Key（vision 与 mcp-http 共用）+ vision 模型参数 + 远程 MCP 端点。
 *
 * Key 复用 pi「zai-coding-cn」provider 的 ZAI_CODING_CN_API_KEY——vision 直调 API 和
 * search/reader/zread 的远程 HTTP MCP 都用它鉴权（已实测）。
 */

// 智谱 coding plan 接口（ZAI_CODING_CN_API_KEY 走这里，已实测可调 glm-4.6v）
const CODE_ENDPOINT = "https://open.bigmodel.cn/api/coding/paas/v4";
// 智谱标准平台接口（Z_AI_API_KEY 走这里）
const PAAS_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4";

export type KeySource = "ZAI_CODING_CN_API_KEY" | "Z_AI_API_KEY" | "none";

/** 解析智谱 API Key（vision 和 mcp-http 共用）。 */
export function resolveApiKey(): { apiKey: string; keySource: KeySource } {
	const codingKey = process.env.ZAI_CODING_CN_API_KEY;
	const stdKey = process.env.Z_AI_API_KEY ?? process.env.ZAI_API_KEY;
	const apiKey = codingKey ?? stdKey ?? "";
	const keySource: KeySource = codingKey ? "ZAI_CODING_CN_API_KEY" : stdKey ? "Z_AI_API_KEY" : "none";
	return { apiKey, keySource };
}

export interface VisionConfig {
	apiKey: string;
	endpoint: string; // 完整 chat/completions URL
	model: string;
	temperature: number;
	topP: number;
	maxTokens: number;
	timeout: number; // ms
	keySource: KeySource;
}

/** vision 模块：GLM-4.6V 直调配置（复刻 @z_ai/mcp-server environment.js）。 */
export function loadVisionConfig(): VisionConfig {
	const { apiKey, keySource } = resolveApiKey();
	const override = process.env.Z_AI_BASE_URL?.replace(/\/+$/, "");
	const base = override ?? (keySource === "ZAI_CODING_CN_API_KEY" ? CODE_ENDPOINT : PAAS_ENDPOINT);
	return {
		apiKey,
		endpoint: `${base}/chat/completions`,
		model: process.env.Z_AI_VISION_MODEL ?? "glm-4.6v",
		temperature: Number.parseFloat(process.env.Z_AI_VISION_MODEL_TEMPERATURE ?? "0.8"),
		topP: Number.parseFloat(process.env.Z_AI_VISION_MODEL_TOP_P ?? "0.6"),
		maxTokens: Number.parseInt(process.env.Z_AI_VISION_MODEL_MAX_TOKENS ?? "32768", 10),
		timeout: Number.parseInt(process.env.Z_AI_TIMEOUT ?? "300000", 10),
		keySource,
	};
}

/**
 * 智谱远程 HTTP MCP 端点（Streamable HTTP transport）。
 * search/reader/zread 都是云端 HTTP MCP，用同一个 coding plan key 鉴权（已实测）。
 */
export const MCP_ENDPOINTS = {
	search: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
	reader: "https://open.bigmodel.cn/api/mcp/web_reader/mcp",
	zread: "https://open.bigmodel.cn/api/mcp/zread/mcp",
} as const;

export type McpEndpointName = keyof typeof MCP_ENDPOINTS;
