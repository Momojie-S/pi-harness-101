/**
 * mcp-http 模块集成测试：验证 search/reader/zread 三个远程 HTTP MCP 都能调通。
 * 运行：cd extensions/zhipu-tools && node ../../web-console/node_modules/tsx/dist/cli.mjs test/mcp-http.ts
 */
import { callTool } from "../src/mcp-http/client.ts";

async function main() {
	console.log("[1] web_search_prime 联网搜索...");
	const r1 = await callTool("search", "web_search_prime", { search_query: "pi coding agent earendil" });
	console.log("  结果:", r1.slice(0, 180));

	console.log("\n[2] webReader 读网页...");
	const r2 = await callTool("reader", "webReader", { url: "https://pi.dev" });
	console.log("  长度:", r2.length, "| 前120:", r2.slice(0, 120).replace(/\n/g, " "));

	console.log("\n[3] zread/get_repo_structure 仓库结构...");
	const r3 = await callTool("zread", "get_repo_structure", { repo_name: "earendil-works/pi" });
	console.log("  结果:", r3.slice(0, 180));

	console.log("\n[4] zread/read_file 读文件...");
	const r4 = await callTool("zread", "read_file", { repo_name: "earendil-works/pi", file_path: "README.md" });
	console.log("  长度:", r4.length, "| 前120:", r4.slice(0, 120).replace(/\n/g, " "));

	console.log("\n✅ mcp-http 全部通过（search/reader/zread）");
}

main().catch((e) => {
	console.error("❌ FAIL:", e instanceof Error ? e.message : String(e));
	process.exit(1);
});
