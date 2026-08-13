/**
 * zhipu-tools：智谱 GLM Coding Plan 工具集（13 个工具，两大模块）。
 *
 * - vision（8 工具）：复刻 @z_ai/mcp-server，纯 HTTP 直调 GLM-4.6V。见 src/vision/、adr/001。
 * - mcp-http（5 工具）：智谱远程 HTTP MCP（search/reader/zread），MCP Streamable HTTP 客户端。见 src/mcp-http/、adr/002。
 *
 * 两大模块都复用 ZAI_CODING_CN_API_KEY（coding plan key）鉴权。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveApiKey } from "./src/config.ts";
import { registerVisionTools } from "./src/vision/tools.ts";
import { registerMcpHttpTools } from "./src/mcp-http/tools.ts";

export default function zhipuToolsExtension(pi: ExtensionAPI) {
	registerVisionTools(pi);
	registerMcpHttpTools(pi);

	// 启动反馈：告知 key 就绪状态（AGENTS.md 纪律：操作要有可见反馈）
	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" && event.reason !== "reload") return;
		const { keySource } = resolveApiKey();
		if (keySource === "none") {
			ctx.ui.notify(
				"zhipu-tools：未配置智谱 API Key，13 个工具将无法调用。请设置 ZAI_CODING_CN_API_KEY（coding plan）或 Z_AI_API_KEY。",
				"warning",
			);
		} else {
			ctx.ui.notify(
				`zhipu-tools 就绪：13 个工具已注册（8 视觉 + 5 搜索/网页/仓库，key 来源 ${keySource}）。`,
				"info",
			);
		}
	});
}
