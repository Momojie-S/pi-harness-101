/**
 * 极简 MCP Streamable HTTP 客户端。
 *
 * 智谱的 search/reader/zread 是远程 HTTP MCP（云端，本身即 HTTP 端点），用 MCP 协议
 * （JSON-RPC over HTTP）调用：initialize → 拿 Mcp-Session-Id → tools/call。响应是 SSE。
 * 用同一个 coding plan key 鉴权（已实测）。
 *
 * 每个 endpoint 维护一个 session：首次调用时懒初始化（initialize + initialized），
 * 之后复用 session id。无需 spawn 子进程、无需 stdio——纯 HTTP。
 */

import { resolveApiKey, MCP_ENDPOINTS, type McpEndpointName } from "../config.ts";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params?: unknown;
}

const sessions = new Map<McpEndpointName, string>();
let idCounter = 1;

/** 发送一条 JSON-RPC，自动带/捕获 session。响应可能是 SSE（取最后一条 data）或 JSON。 */
async function rpc(name: McpEndpointName, req: JsonRpcRequest): Promise<any> {
	const { apiKey } = resolveApiKey();
	if (!apiKey) {
		throw new Error(
			"未配置智谱 API Key。请设置 ZAI_CODING_CN_API_KEY（coding plan，推荐）或 Z_AI_API_KEY。",
		);
	}
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${apiKey}`,
	};
	const sid = sessions.get(name);
	if (sid) headers["Mcp-Session-Id"] = sid;

	const res = await fetch(MCP_ENDPOINTS[name], {
		method: "POST",
		headers,
		body: JSON.stringify(req),
	});

	// initialize 响应里带 session id
	const newSid = res.headers.get("mcp-session-id");
	if (newSid && newSid !== sid) sessions.set(name, newSid);

	const text = await res.text();
	if (!text.trim()) return null; // notifications/initialized 等无响应体

	if (!res.ok) {
		throw new Error(`智谱 MCP[${name}] HTTP ${res.status}：${text.slice(0, 300)}`);
	}

	const ct = res.headers.get("content-type") ?? "";
	let payload: any;
	if (ct.includes("event-stream")) {
		// SSE：取最后一条 data: 行
		const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
		if (dataLines.length === 0) return null;
		payload = JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
	} else {
		payload = JSON.parse(text);
	}

	if (payload?.error) {
		throw new Error(`智谱 MCP[${name}] 协议错误：${JSON.stringify(payload.error)}`);
	}
	return payload;
}

/** 确保 endpoint 已完成 MCP 握手（懒初始化，仅首次）。 */
async function ensureInitialized(name: McpEndpointName): Promise<void> {
	if (sessions.has(name)) return;
	await rpc(name, {
		jsonrpc: "2.0",
		id: idCounter++,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "zhipu-tools", version: "0.1.0" },
		},
	});
	await rpc(name, { jsonrpc: "2.0", method: "notifications/initialized" });
}

/**
 * 调用远程 MCP 工具，返回拼好的文本结果。
 * 抛出 Error（含可读提示）供工具 execute 捕获。
 */
export async function callTool(
	name: McpEndpointName,
	toolName: string,
	args: Record<string, unknown>,
): Promise<string> {
	await ensureInitialized(name);
	const res = await rpc(name, {
		jsonrpc: "2.0",
		id: idCounter++,
		method: "tools/call",
		params: { name: toolName, arguments: args },
	});

	const result = res?.result;
	if (result?.isError) {
		const t = result.content?.[0]?.text ?? "未知错误";
		throw new Error(`智谱 MCP[${name}/${toolName}] 返回错误：${t}`);
	}
	const content = result?.content;
	if (!content?.length) {
		throw new Error(`智谱 MCP[${name}/${toolName}] 返回空结果`);
	}
	// 拼接所有 text 段
	return content.map((c: { text?: string }) => c.text ?? "").join("\n");
}
