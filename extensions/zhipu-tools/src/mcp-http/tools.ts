/**
 * 注册智谱远程 HTTP MCP 的 5 个工具（search/reader/zread）。
 *
 * 工具名、参数 schema 全部来自实测 tools/list（文档有过时，如 webSearchPrime 实为 web_search_prime）。
 * 静态声明而非每次 tools/list：这些 HTTP MCP 工具少且稳定，启动快、实现简单；execute 时直接 tools/call。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callTool } from "./client.ts";

export function registerMcpHttpTools(pi: ExtensionAPI) {
	// ---- web_search_prime：智谱联网搜索 ----
	pi.registerTool({
		name: "web_search_prime",
		label: "智谱联网搜索",
		description: `Search web information via Zhipu, returns results including web page title, URL, summary, site name and icon.
Use this tool when the user wants to search the web for up-to-date information. Powered by Zhipu's web search.`,
		parameters: Type.Object({
			search_query: Type.String({ description: "Content to be searched, recommended ≤ 70 characters" }),
			search_domain_filter: Type.Optional(
				Type.String({ description: "Limit results to specified domain, e.g. www.example.com" }),
			),
			search_recency_filter: Type.Optional(
				Type.String({
					description: "Time range: oneDay / oneWeek / oneMonth / oneYear / noLimit (default)",
				}),
			),
			content_size: Type.Optional(
				Type.String({ description: "Summary length: medium (400-600 words, default) / high (2500 words)" }),
			),
			location: Type.Optional(Type.String({ description: "Region: cn (default) / us" })),
		}),
		async execute(_id, params) {
			const text = await callTool("search", "web_search_prime", params);
			return { content: [{ type: "text" as const, text }], details: { source: "zhipu web_search_prime" } };
		},
	});

	// ---- webReader：抓取并转换网页为 LLM 友好格式 ----
	pi.registerTool({
		name: "webReader",
		label: "智谱网页读取",
		description: `Fetch a URL and convert its content to LLM-friendly markdown/text via Zhipu. Returns title, body content, metadata, and links.
Use this tool when the user wants to read/fetch the content of a web page URL.`,
		parameters: Type.Object({
			url: Type.String({ description: "The URL of the website to fetch and read" }),
			timeout: Type.Optional(Type.Integer({ description: "Request timeout in seconds, default 20" })),
			return_format: Type.Optional(Type.String({ description: "markdown (default) or text" })),
			retain_images: Type.Optional(Type.Boolean({ description: "Retain images, default true" })),
			no_cache: Type.Optional(Type.Boolean({ description: "Disable cache, default false" })),
			with_links_summary: Type.Optional(Type.Boolean({ description: "Include links summary, default false" })),
			with_images_summary: Type.Optional(Type.Boolean({ description: "Include images summary, default false" })),
		}),
		async execute(_id, params) {
			const text = await callTool("reader", "webReader", params);
			return { content: [{ type: "text" as const, text }], details: { source: "zhipu webReader" } };
		},
	});

	// ---- search_doc：搜索 GitHub 仓库的文档/issue/commit ----
	pi.registerTool({
		name: "search_doc",
		label: "仓库文档搜索",
		description: `Search documentation, issues, and commits of a GitHub repository via Zhipu ZRead.
Use this tool to learn about a GitHub repo's concepts, recent news, issues, PRs and contributors.`,
		parameters: Type.Object({
			repo_name: Type.String({ description: 'GitHub repository: owner/repo (e.g. "vitejs/vite")' }),
			query: Type.String({ description: "Search keywords or a question about the repository." }),
			language: Type.Optional(Type.String({ description: "'zh' or 'en' (match context language)" })),
		}),
		async execute(_id, params) {
			const text = await callTool("zread", "search_doc", params);
			return { content: [{ type: "text" as const, text }], details: { source: "zhipu zread/search_doc" } };
		},
	});

	// ---- read_file：读取 GitHub 仓库指定文件 ----
	pi.registerTool({
		name: "read_file",
		label: "读取仓库文件",
		description: `Read the full code content of a specific file in a GitHub repository via Zhipu ZRead.
Use this tool to inspect a file's implementation details in a GitHub repo.`,
		parameters: Type.Object({
			repo_name: Type.String({ description: 'GitHub repository: owner/repo (e.g. "vitejs/vite")' }),
			file_path: Type.String({ description: 'Relative path to the file (e.g. "src/index.ts")' }),
		}),
		async execute(_id, params) {
			const text = await callTool("zread", "read_file", params);
			return { content: [{ type: "text" as const, text }], details: { source: "zhipu zread/read_file" } };
		},
	});

	// ---- get_repo_structure：获取 GitHub 仓库目录结构 ----
	pi.registerTool({
		name: "get_repo_structure",
		label: "仓库目录结构",
		description: `Get the directory structure and file list of a GitHub repository via Zhipu ZRead.
Use this tool to understand a GitHub repo's module layout and directory organization.`,
		parameters: Type.Object({
			repo_name: Type.String({ description: 'GitHub repository: owner/repo (e.g. "vitejs/vite")' }),
			dir_path: Type.Optional(Type.String({ description: 'Directory path to inspect (default: root "/")' })),
		}),
		async execute(_id, params) {
			const text = await callTool("zread", "get_repo_structure", params);
			return { content: [{ type: "text" as const, text }], details: { source: "zhipu zread/get_repo_structure" } };
		},
	});
}
