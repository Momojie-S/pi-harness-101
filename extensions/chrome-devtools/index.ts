/**
 * Chrome DevTools Extension for pi
 *
 * 通过 CDP (Chrome DevTools Protocol) 控制已开启调试端口的 Chrome/Edge 浏览器。
 * 用户需先启动浏览器: chrome.exe --remote-debugging-port=19999
 *
 * Phase 1 工具 (核心自动化):
 * - browser_navigate: 导航到 URL
 * - browser_screenshot: 页面截图
 * - browser_get_text: 获取页面/元素文本
 * - browser_evaluate: 执行 JavaScript
 * - browser_click: 点击元素
 * - browser_type: 输入文字
 * - browser_fill: 表单填写 (input/select/checkbox/radio)
 * - browser_hover: 悬停元素
 * - browser_press_key: 按键/组合键
 * - browser_handle_dialog: 处理弹窗
 * - browser_wait: 等待元素或超时
 * - browser_get_url: 获取当前 URL
 * - browser_list_tabs: 列出所有标签页
 * - browser_switch_tab: 切换标签页
 * - browser_new_page: 新建标签页
 * - browser_close_page: 关闭标签页
 * - browser_drag: 拖拽元素
 *
 * Phase 2 工具 (调试能力):
 * - browser_list_console: 列出控制台消息
 * - browser_get_console: 获取单条消息详情
 * - browser_list_network: 列出网络请求
 * - browser_get_network: 获取请求详情
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import CDP from "chrome-remote-interface";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ============================================================
// 类型定义
// ============================================================

type CDPClient = Awaited<ReturnType<typeof CDP>>;

interface ConnectionState {
	client: CDPClient;
	target: string;
	consoleMessages: ConsoleMessage[];
	networkRequests: Map<string, NetworkRequest>;
}

interface ConsoleMessage {
	id: number;
	level: string;
	text: string;
	timestamp: number;
	url?: string;
	lineNumber?: number;
}

interface NetworkRequest {
	id: string;
	url: string;
	method: string;
	type: string;
	status?: number;
	statusText?: string;
	requestHeaders?: Record<string, string>;
	responseHeaders?: Record<string, string>;
	requestBody?: string;
	responseBody?: string;
	timestamp: number;
}

/** 配置文件结构 */
interface ChromeDevtoolsConfig {
	/** Chrome/Edge 调试端口 */
	port?: number;
}

// ============================================================
// 配置加载
// ============================================================

const DEFAULT_PORT = 19999;
const CONFIG_FILENAME = "chrome-devtools.json";

/**
 * 加载配置，优先级（高→低）：
 * 1. 环境变量 CHROME_DEBUG_PORT
 * 2. 项目级配置 .pi/chrome-devtools.json
 * 3. 全局配置 ~/.pi/agent/chrome-devtools.json
 * 4. 默认值 19999
 */
function loadConfig(cwd: string): { port: number; source: string } {
	// 1. 环境变量
	const envPort = process.env.CHROME_DEBUG_PORT;
	if (envPort) {
		const port = parseInt(envPort, 10);
		if (!isNaN(port) && port > 0 && port <= 65535) {
			return { port, source: `环境变量 CHROME_DEBUG_PORT=${port}` };
		}
	}

	// 2. 项目级配置 <cwd>/.pi/chrome-devtools.json
	const projectConfigPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
	if (existsSync(projectConfigPath)) {
		const config = readJsonConfig<ChromeDevtoolsConfig>(projectConfigPath);
		if (config?.port) {
			return { port: config.port, source: `项目配置 ${projectConfigPath}` };
		}
	}

	// 3. 全局配置 ~/.pi/agent/chrome-devtools.json
	const homeDir = process.env.USERPROFILE || process.env.HOME || "";
	if (homeDir) {
		const globalConfigPath = join(homeDir, CONFIG_DIR_NAME, "agent", CONFIG_FILENAME);
		if (existsSync(globalConfigPath)) {
			const config = readJsonConfig<ChromeDevtoolsConfig>(globalConfigPath);
			if (config?.port) {
				return { port: config.port, source: `全局配置 ${globalConfigPath}` };
			}
		}
	}

	// 4. 默认值
	return { port: DEFAULT_PORT, source: "默认值" };
}

function readJsonConfig<T>(filePath: string): T | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

// ============================================================
// 连接管理
// ============================================================

let connection: ConnectionState | null = null;

async function ensureConnected(port: number): Promise<CDPClient> {
	if (connection) {
		return connection.client;
	}

	const client = await CDP({ port });
	connection = { 
		client, 
		target: `localhost:${port}`,
		consoleMessages: [],
		networkRequests: new Map()
	};

	// 监听断开连接
	client.on("disconnect", () => {
		connection = null;
	});

	// 启用 Log domain 收集控制台消息
	await client.Log.enable();
	let consoleIdCounter = 1;
	client.Log.entryAdded((event) => {
		const entry = event.entry;
		connection?.consoleMessages.push({
			id: consoleIdCounter++,
			level: entry.level,
			text: entry.text,
			timestamp: entry.timestamp,
			url: entry.url,
			lineNumber: entry.lineNumber,
		});
		// 保留最近 1000 条
		if (connection && connection.consoleMessages.length > 1000) {
			connection.consoleMessages.shift();
		}
	});

	// 启用 Runtime domain 收集 console API 调用
	await client.Runtime.enable();
	client.Runtime.consoleAPICalled((event) => {
		const text = event.args.map(arg => {
			if (arg.value !== undefined) return String(arg.value);
			if (arg.description) return arg.description;
			return JSON.stringify(arg);
		}).join(' ');
		
		connection?.consoleMessages.push({
			id: consoleIdCounter++,
			level: event.type,
			text,
			timestamp: event.timestamp,
		});
		if (connection && connection.consoleMessages.length > 1000) {
			connection.consoleMessages.shift();
		}
	});

	// 启用 Network domain 收集网络请求
	await client.Network.enable();
	client.Network.requestWillBeSent((event) => {
		connection?.networkRequests.set(event.requestId, {
			id: event.requestId,
			url: event.request.url,
			method: event.request.method,
			type: event.type,
			requestHeaders: event.request.headers,
			requestBody: event.request.postData,
			timestamp: event.timestamp,
		});
	});

	client.Network.responseReceived((event) => {
		const req = connection?.networkRequests.get(event.requestId);
		if (req) {
			req.status = event.response.status;
			req.statusText = event.response.statusText;
			req.responseHeaders = event.response.headers;
		}
	});

	// 清理已完成的请求（保留最近 500 个）
	client.Network.loadingFinished(() => {
		if (connection && connection.networkRequests.size > 500) {
			const keys = Array.from(connection.networkRequests.keys());
			const toRemove = keys.slice(0, keys.length - 500);
			toRemove.forEach(key => connection!.networkRequests.delete(key));
		}
	});

	return client;
}

async function disconnect(): Promise<void> {
	if (connection) {
		try {
			await connection.client.close();
		} catch {
			// 忽略关闭错误
		}
		connection = null;
	}
}

// ============================================================
// 工具参数 Schema
// ============================================================

const NAVIGATE_PARAMS = Type.Object({
	url: Type.String({ description: "要导航到的 URL" }),
});

const SCREENSHOT_PARAMS = Type.Object({
	selector: Type.Optional(
		Type.String({ description: "CSS 选择器，只截取该元素区域" }),
	),
	fullPage: Type.Optional(
		Type.Boolean({ description: "是否截取完整页面（包括滚动区域）" }),
	),
});

const GET_TEXT_PARAMS = Type.Object({
	selector: Type.Optional(
		Type.String({ description: "CSS 选择器，只获取该元素的文本" }),
	),
});

const EVALUATE_PARAMS = Type.Object({
	expression: Type.String({ description: "要执行的 JavaScript 表达式" }),
});

const CLICK_PARAMS = Type.Object({
	selector: Type.String({ description: "要点击的元素的 CSS 选择器" }),
});

const TYPE_PARAMS = Type.Object({
	selector: Type.String({ description: "输入框的 CSS 选择器" }),
	text: Type.String({ description: "要输入的文字" }),
	clear: Type.Optional(
		Type.Boolean({ description: "输入前是否清空已有内容，默认 true" }),
	),
});

const WAIT_PARAMS = Type.Object({
	selector: Type.Optional(
		Type.String({ description: "等待该 CSS 选择器的元素出现" }),
	),
	timeout: Type.Optional(
		Type.Number({ description: "超时时间（毫秒），默认 5000" }),
	),
});

const SWITCH_TAB_PARAMS = Type.Object({
	targetId: Type.String({ description: "要切换到的标签页的 targetId" }),
});

// Phase 1 新增工具参数

const FILL_PARAMS = Type.Object({
	selector: Type.String({ description: "表单元素的 CSS 选择器" }),
	value: Type.String({ description: "要填入的值" }),
});

const HOVER_PARAMS = Type.Object({
	selector: Type.String({ description: "要悬停的元素的 CSS 选择器" }),
});

const PRESS_KEY_PARAMS = Type.Object({
	key: Type.String({
		description:
			'按键或组合键，如 "Enter", "Tab", "Escape", "Control+A", "Control+Shift+R"',
	}),
});

const HANDLE_DIALOG_PARAMS = Type.Object({
	action: Type.Union([Type.Literal("accept"), Type.Literal("dismiss")], {
		description: "接受或取消弹窗",
	}),
	promptText: Type.Optional(
		Type.String({ description: "对于 prompt 弹窗，输入的文字" }),
	),
});

const NEW_PAGE_PARAMS = Type.Object({
	url: Type.Optional(Type.String({ description: "新标签页的 URL，默认 about:blank" })),
	background: Type.Optional(
		Type.Boolean({ description: "是否在后台打开（不切换到该标签页）" }),
	),
});

const CLOSE_PAGE_PARAMS = Type.Object({
	targetId: Type.String({ description: "要关闭的标签页的 targetId" }),
});

const DRAG_PARAMS = Type.Object({
	fromSelector: Type.String({ description: "拖拽起始元素的 CSS 选择器" }),
	toSelector: Type.String({ description: "拖拽目标元素的 CSS 选择器" }),
});

// Phase 2 工具参数 (调试能力)

const LIST_CONSOLE_PARAMS = Type.Object({
	types: Type.Optional(
		Type.Array(Type.String(), {
			description: "过滤消息类型: log, info, warning, error, debug",
		}),
	),
	limit: Type.Optional(
		Type.Number({ description: "返回的最大消息数，默认 100" }),
	),
});

const GET_CONSOLE_PARAMS = Type.Object({
	id: Type.Number({ description: "控制台消息的 ID" }),
});

const LIST_NETWORK_PARAMS = Type.Object({
	resourceTypes: Type.Optional(
		Type.Array(Type.String(), {
			description: "过滤资源类型: Document, Script, Stylesheet, Image, XHR, Fetch, WebSocket, Other",
		}),
	),
	limit: Type.Optional(
		Type.Number({ description: "返回的最大请求数，默认 100" }),
	),
});

const GET_NETWORK_PARAMS = Type.Object({
	id: Type.String({ description: "网络请求的 ID" }),
});

// ============================================================
// Extension 入口
// ============================================================

export default function chromeDevtoolsExtension(pi: ExtensionAPI) {
	let configuredPort = DEFAULT_PORT;
	let configSource = "默认值";

	// ---------- browser_navigate ----------
	pi.registerTool({
		name: "browser_navigate",
		label: "Navigate",
		description: "在浏览器中导航到指定 URL",
		parameters: NAVIGATE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 启用 Page domain
				await client.Page.enable();

				// 导航
				const result = await client.Page.navigate({ url: params.url });

				if (result.errorText) {
					return {
						content: [{ type: "text", text: `导航失败: ${result.errorText}` }],
						details: { success: false },
					};
				}

				// 等待页面加载完成
				await client.Page.loadEventFired();

				return {
					content: [
						{
							type: "text",
							text: `已导航到: ${params.url}\nFrameId: ${result.frameId}`,
						},
					],
					details: { success: true, url: params.url, frameId: result.frameId },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_screenshot ----------
	pi.registerTool({
		name: "browser_screenshot",
		label: "Screenshot",
		description: "截取浏览器页面截图。可指定 CSS 选择器只截取某元素，或截取完整页面。",
		parameters: SCREENSHOT_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.Page.enable();

				let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;

				if (params.selector) {
					// 获取元素的位置和大小
					const result = await client.Runtime.evaluate({
						expression: `
							(() => {
								const el = document.querySelector('${cssEscape(params.selector)}');
								if (!el) return null;
								const rect = el.getBoundingClientRect();
								return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
							})()
						`,
						returnByValue: true,
					});

					const box = result.result.value;
					if (!box) {
						return {
							content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
							details: { success: false },
							isError: true,
						};
					}
					clip = { ...box, scale: 1 };
				}

				const screenshot = await client.Page.captureScreenshot({
					format: "png",
					clip,
					captureBeyondViewport: params.fullPage ?? false,
				});

				return {
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								mediaType: "image/png",
								data: screenshot.data,
							},
						},
						{
							type: "text",
							text: params.selector
								? `已截取元素: ${params.selector}`
								: params.fullPage
									? "已截取完整页面"
									: "已截取当前视口",
						},
					],
					details: {
						success: true,
						selector: params.selector,
						fullPage: params.fullPage,
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_get_text ----------
	pi.registerTool({
		name: "browser_get_text",
		label: "Get Text",
		description: "获取页面或指定元素的文本内容。不传 selector 则获取整个页面的可见文本。",
		parameters: GET_TEXT_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				let expression: string;
				if (params.selector) {
					expression = `
						(() => {
							const el = document.querySelector('${cssEscape(params.selector)}');
							if (!el) return null;
							return el.innerText || el.textContent || '';
						})()
					`;
				} else {
					expression = `document.body.innerText || document.body.textContent || ''`;
				}

				const result = await client.Runtime.evaluate({
					expression,
					returnByValue: true,
				});

				if (result.exceptionDetails) {
					return {
						content: [
							{
								type: "text",
								text: `JS 执行错误: ${result.exceptionDetails.text}`,
							},
						],
						details: { success: false },
						isError: true,
					};
				}

				const text = result.result.value;
				if (text === null && params.selector) {
					return {
						content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
						details: { success: false },
						isError: true,
					};
				}

				// 截断过长文本
				const maxLength = 50000;
				const truncated =
					typeof text === "string" && text.length > maxLength
						? text.slice(0, maxLength) + `\n\n... (已截断，共 ${text.length} 字符)`
						: text;

				return {
					content: [{ type: "text", text: truncated ?? "" }],
					details: {
						success: true,
						selector: params.selector,
						length: typeof text === "string" ? text.length : 0,
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_evaluate ----------
	pi.registerTool({
		name: "browser_evaluate",
		label: "Evaluate JS",
		description:
			"在浏览器页面中执行 JavaScript 表达式并返回结果。可用于获取 DOM 信息、操作页面、调试等。",
		parameters: EVALUATE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				const result = await client.Runtime.evaluate({
					expression: params.expression,
					returnByValue: true,
					awaitPromise: true,
				});

				if (result.exceptionDetails) {
					return {
						content: [
							{
								type: "text",
								text: `JS 执行错误: ${result.exceptionDetails.text}\n${result.exceptionDetails.stackTrace?.callFrames?.map((f) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber})`).join("\n") ?? ""}`,
							},
						],
						details: { success: false },
						isError: true,
					};
				}

				const value = result.result.value;
				const text =
					value === undefined
						? "undefined"
						: typeof value === "object"
							? JSON.stringify(value, null, 2)
							: String(value);

				return {
					content: [{ type: "text", text }],
					details: {
						success: true,
						type: result.result.type,
						subtype: result.result.subtype,
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_click ----------
	pi.registerTool({
		name: "browser_click",
		label: "Click",
		description: "点击页面上的元素。通过 CSS 选择器定位元素，模拟点击操作。",
		parameters: CLICK_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				const result = await client.Runtime.evaluate({
					expression: `
						(() => {
							const el = document.querySelector('${cssEscape(params.selector)}');
							if (!el) return { found: false };
							el.click();
							return { found: true, tag: el.tagName, text: (el.innerText || '').slice(0, 100) };
						})()
					`,
					returnByValue: true,
				});

				const info = result.result.value;
				if (!info?.found) {
					return {
						content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
						details: { success: false },
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `已点击 <${info.tag}> 元素${info.text ? `，文本: "${info.text}"` : ""}`,
						},
					],
					details: { success: true, selector: params.selector },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_type ----------
	pi.registerTool({
		name: "browser_type",
		label: "Type",
		description: "在输入框中输入文字。通过 CSS 选择器定位输入元素，模拟输入操作。",
		parameters: TYPE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const clear = params.clear ?? true;

				const result = await client.Runtime.evaluate({
					expression: `
						(() => {
							const el = document.querySelector('${cssEscape(params.selector)}');
							if (!el) return { found: false };
							${clear ? "el.value = '';" : ""}
							// 触发 input 事件让框架感知到变化
							const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
								window.HTMLInputElement.prototype, 'value'
							)?.set || Object.getOwnPropertyDescriptor(
								window.HTMLTextAreaElement.prototype, 'value'
							)?.set;
							if (nativeInputValueSetter) {
								nativeInputValueSetter.call(el, '${jsEscape(params.text)}');
							} else {
								el.value = '${jsEscape(params.text)}';
							}
							el.dispatchEvent(new Event('input', { bubbles: true }));
							el.dispatchEvent(new Event('change', { bubbles: true }));
							return { found: true, tag: el.tagName };
						})()
					`,
					returnByValue: true,
				});

				const info = result.result.value;
				if (!info?.found) {
					return {
						content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
						details: { success: false },
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `已在 <${info.tag}> 中输入: "${params.text}"`,
						},
					],
					details: { success: true, selector: params.selector },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_wait ----------
	pi.registerTool({
		name: "browser_wait",
		label: "Wait",
		description: "等待页面元素出现或等待指定时间。至少提供 selector 或 timeout 之一。",
		parameters: WAIT_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const timeout = params.timeout ?? 5000;

				if (params.selector) {
					// 轮询等待元素出现
					const startTime = Date.now();
					const interval = 200;

					while (Date.now() - startTime < timeout) {
						const result = await client.Runtime.evaluate({
							expression: `!!document.querySelector('${cssEscape(params.selector)}')`,
							returnByValue: true,
						});

						if (result.result.value === true) {
							const elapsed = Date.now() - startTime;
							return {
								content: [
									{
										type: "text",
										text: `元素已出现: ${params.selector}（等待 ${elapsed}ms）`,
									},
								],
								details: { success: true, elapsed },
							};
						}

						await sleep(interval);
					}

					return {
						content: [
							{
								type: "text",
								text: `等待超时（${timeout}ms），元素未出现: ${params.selector}`,
							},
						],
						details: { success: false, timeout },
						isError: true,
					};
				} else {
					// 纯等待
					await sleep(timeout);
					return {
						content: [{ type: "text", text: `已等待 ${timeout}ms` }],
						details: { success: true, timeout },
					};
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_get_url ----------
	pi.registerTool({
		name: "browser_get_url",
		label: "Get URL",
		description: "获取当前页面的 URL 和标题。",
		parameters: Type.Object({}),
		async execute() {
			try {
				const client = await ensureConnected(configuredPort);

				const result = await client.Runtime.evaluate({
					expression: "JSON.stringify({ url: location.href, title: document.title })",
					returnByValue: true,
				});

				const info = JSON.parse(result.result.value);
				return {
					content: [
						{
							type: "text",
							text: `URL: ${info.url}\nTitle: ${info.title}`,
						},
					],
					details: { success: true, url: info.url, title: info.title },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_list_tabs ----------
	pi.registerTool({
		name: "browser_list_tabs",
		label: "List Tabs",
		description: "列出浏览器中所有标签页的信息。",
		parameters: Type.Object({}),
		async execute() {
			try {
				const client = await ensureConnected(configuredPort);

				const result = await client.Target.getTargets();
				const pageTargets = result.targetInfos.filter((t) => t.type === "page");

				if (pageTargets.length === 0) {
					return {
						content: [{ type: "text", text: "没有找到打开的标签页" }],
						details: { success: true, count: 0 },
					};
				}

				const lines = pageTargets.map((t, i) => {
					const active = t.targetId === connection?.target ? " (当前)" : "";
					return `${i + 1}. [${t.targetId}]${active}\n   URL: ${t.url}\n   Title: ${t.title}`;
				});

				return {
					content: [{ type: "text", text: lines.join("\n\n") }],
					details: { success: true, count: pageTargets.length },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_switch_tab ----------
	pi.registerTool({
		name: "browser_switch_tab",
		label: "Switch Tab",
		description: "切换到指定的浏览器标签页。使用 browser_list_tabs 获取 targetId。",
		parameters: SWITCH_TAB_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 激活目标
				await client.Target.activateTarget({ targetId: params.targetId });

				// 连接到新标签页
				await disconnect();
				const newClient = await CDP({ port: configuredPort, target: params.targetId });
				connection = { client: newClient, target: params.targetId };
				newClient.on("disconnect", () => {
					connection = null;
				});

				return {
					content: [{ type: "text", text: `已切换到标签页: ${params.targetId}` }],
					details: { success: true, targetId: params.targetId },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ============================================================
	// Phase 1 新增工具
	// ============================================================

	// ---------- browser_fill ----------
	pi.registerTool({
		name: "browser_fill",
		label: "Fill",
		description:
			"在表单元素中填入值。支持 input、textarea、select、checkbox、radio 等元素。",
		parameters: FILL_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				const result = await client.Runtime.evaluate({
					expression: `
						(() => {
							const el = document.querySelector('${cssEscape(params.selector)}');
							if (!el) return { found: false };
							const tag = el.tagName.toLowerCase();
							const type = (el.type || '').toLowerCase();
							
							// checkbox / radio
							if (type === 'checkbox' || type === 'radio') {
								const shouldCheck = params.value === 'true' || params.value === '1' || params.value === 'on';
								if (el.checked !== shouldCheck) {
									el.click();
								}
								return { found: true, tag, checked: el.checked };
							}
							
							// select
							if (tag === 'select') {
								const options = Array.from(el.options);
								const option = options.find(o => o.value === params.value || o.text === params.value);
								if (option) {
									el.value = option.value;
								} else {
									return { found: true, tag, error: 'Option not found: ' + params.value };
								}
								el.dispatchEvent(new Event('change', { bubbles: true }));
								return { found: true, tag, value: el.value };
							}
							
							// input / textarea
							const nativeSetter = Object.getOwnPropertyDescriptor(
								window.HTMLInputElement.prototype, 'value'
							)?.set || Object.getOwnPropertyDescriptor(
								window.HTMLTextAreaElement.prototype, 'value'
							)?.set;
							if (nativeSetter) {
								nativeSetter.call(el, params.value);
							} else {
								el.value = params.value;
							}
							el.dispatchEvent(new Event('input', { bubbles: true }));
							el.dispatchEvent(new Event('change', { bubbles: true }));
							return { found: true, tag, value: el.value };
						})()
					`,
					returnByValue: true,
					// 注入参数
					uniqueContextId: undefined,
				});

				// 重新执行，带参数
				const result2 = await client.Runtime.evaluate({
					expression: `
						((params) => {
							const el = document.querySelector(params.selector);
							if (!el) return { found: false };
							const tag = el.tagName.toLowerCase();
							const type = (el.type || '').toLowerCase();
							
							if (type === 'checkbox' || type === 'radio') {
								const shouldCheck = params.value === 'true' || params.value === '1' || params.value === 'on';
								if (el.checked !== shouldCheck) el.click();
								return { found: true, tag, checked: el.checked };
							}
							
							if (tag === 'select') {
								const options = Array.from(el.options);
								const option = options.find(o => o.value === params.value || o.text === params.value);
								if (option) {
									el.value = option.value;
								} else {
									return { found: true, tag, error: 'Option not found: ' + params.value };
								}
								el.dispatchEvent(new Event('change', { bubbles: true }));
								return { found: true, tag, value: el.value };
							}
							
							const nativeSetter = Object.getOwnPropertyDescriptor(
								window.HTMLInputElement.prototype, 'value'
							)?.set || Object.getOwnPropertyDescriptor(
								window.HTMLTextAreaElement.prototype, 'value'
							)?.set;
							if (nativeSetter) {
								nativeSetter.call(el, params.value);
							} else {
								el.value = params.value;
							}
							el.dispatchEvent(new Event('input', { bubbles: true }));
							el.dispatchEvent(new Event('change', { bubbles: true }));
							return { found: true, tag, value: el.value };
						})(${JSON.stringify({ selector: params.selector, value: params.value })})
					`,
					returnByValue: true,
				});

				const info = result2.result.value;
				if (!info?.found) {
					return {
						content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
						details: { success: false },
						isError: true,
					};
				}

				if (info.error) {
					return {
						content: [{ type: "text", text: info.error }],
						details: { success: false },
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `已在 <${info.tag}> 中填入: "${params.value}"`,
						},
					],
					details: { success: true, selector: params.selector },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_hover ----------
	pi.registerTool({
		name: "browser_hover",
		label: "Hover",
		description: "将鼠标悬停在指定元素上。可触发 hover 效果和下拉菜单等。",
		parameters: HOVER_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 获取元素位置
				const result = await client.Runtime.evaluate({
					expression: `
						(() => {
							const el = document.querySelector('${cssEscape(params.selector)}');
							if (!el) return null;
							const rect = el.getBoundingClientRect();
							return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName };
						})()
					`,
					returnByValue: true,
				});

				const box = result.result.value;
				if (!box) {
					return {
						content: [{ type: "text", text: `未找到元素: ${params.selector}` }],
						details: { success: false },
						isError: true,
					};
				}

				// 使用 Input domain 发送鼠标移动事件
				await client.Input.dispatchMouseEvent({
					type: "mouseMoved",
					x: box.x,
					y: box.y,
				});

				return {
					content: [
						{
							type: "text",
							text: `已悬停在 <${box.tag}> 元素上 (${Math.round(box.x)}, ${Math.round(box.y)})`,
						},
					],
					details: { success: true, selector: params.selector },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_press_key ----------
	pi.registerTool({
		name: "browser_press_key",
		label: "Press Key",
		description:
			'按下按键或组合键。如 "Enter", "Tab", "Escape", "Control+A", "Control+Shift+R" 等。',
		parameters: PRESS_KEY_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 解析按键
				const parts = params.key.split("+");
				const key = parts[parts.length - 1];
				const modifiers = parts.slice(0, -1);

				let modifiersBit = 0;
				for (const mod of modifiers) {
					const m = mod.toLowerCase();
					if (m === "control" || m === "ctrl") modifiersBit |= 2;
					else if (m === "alt") modifiersBit |= 1;
					else if (m === "shift") modifiersBit |= 8;
					else if (m === "meta" || m === "cmd" || m === "command") modifiersBit |= 4;
				}

				// 发送 keyDown + keyUp
				await client.Input.dispatchKeyEvent({
					type: "keyDown",
					key,
					modifiers: modifiersBit,
				});
				await client.Input.dispatchKeyEvent({
					type: "keyUp",
					key,
					modifiers: modifiersBit,
				});

				return {
					content: [{ type: "text", text: `已按下: ${params.key}` }],
					details: { success: true, key: params.key },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_handle_dialog ----------
	pi.registerTool({
		name: "browser_handle_dialog",
		label: "Handle Dialog",
		description:
			"处理浏览器弹窗（alert/confirm/prompt）。使用 browser_wait 等待弹窗出现后再调用。",
		parameters: HANDLE_DIALOG_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 启用 Page domain 以接收弹窗事件
				await client.Page.enable();

				if (params.action === "accept") {
					await client.Page.handleJavaScriptDialog({
						accept: true,
						promptText: params.promptText,
					});
				} else {
					await client.Page.handleJavaScriptDialog({
						accept: false,
					});
				}

				return {
					content: [
						{
							type: "text",
							text: `已${params.action === "accept" ? "接受" : "取消"}弹窗${params.promptText ? `，输入: "${params.promptText}"` : ""}`,
						},
					],
					details: { success: true, action: params.action },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_new_page ----------
	pi.registerTool({
		name: "browser_new_page",
		label: "New Page",
		description: "打开新的浏览器标签页。",
		parameters: NEW_PAGE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const url = params.url || "about:blank";

				const result = await client.Target.createTarget({ url });

				if (!params.background) {
					// 切换到新标签页
					await client.Target.activateTarget({ targetId: result.targetId });
					await disconnect();
					const newClient = await CDP({
						port: configuredPort,
						target: result.targetId,
					});
					connection = { client: newClient, target: result.targetId };
					newClient.on("disconnect", () => {
						connection = null;
					});
				}

				return {
					content: [
						{
							type: "text",
							text: `已打开新标签页: ${url}\ntargetId: ${result.targetId}`,
						},
					],
					details: { success: true, targetId: result.targetId, url },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_close_page ----------
	pi.registerTool({
		name: "browser_close_page",
		label: "Close Page",
		description: "关闭指定的浏览器标签页。使用 browser_list_tabs 获取 targetId。",
		parameters: CLOSE_PAGE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 不能关闭最后一个标签页
				const targets = await client.Target.getTargets();
				const pageTargets = targets.targetInfos.filter((t) => t.type === "page");
				if (pageTargets.length <= 1) {
					return {
						content: [
							{ type: "text", text: "无法关闭最后一个标签页" },
						],
						details: { success: false },
						isError: true,
					};
				}

				await client.Target.closeTarget({ targetId: params.targetId });

				// 如果关闭的是当前标签页，切换到其他标签页
				if (connection?.target === params.targetId) {
					await disconnect();
					const remaining = pageTargets.filter((t) => t.targetId !== params.targetId);
					if (remaining.length > 0) {
						const newClient = await CDP({
							port: configuredPort,
							target: remaining[0].targetId,
						});
						connection = { client: newClient, target: remaining[0].targetId };
						newClient.on("disconnect", () => {
							connection = null;
						});
					}
				}

				return {
					content: [{ type: "text", text: `已关闭标签页: ${params.targetId}` }],
					details: { success: true, targetId: params.targetId },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_drag ----------
	pi.registerTool({
		name: "browser_drag",
		label: "Drag",
		description: "将一个元素拖拽到另一个元素上。",
		parameters: DRAG_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 获取两个元素的位置
				const result = await client.Runtime.evaluate({
					expression: `
						(() => {
							const from = document.querySelector('${cssEscape(params.fromSelector)}');
							const to = document.querySelector('${cssEscape(params.toSelector)}');
							if (!from) return { error: 'Source element not found' };
							if (!to) return { error: 'Target element not found' };
							const fromRect = from.getBoundingClientRect();
							const toRect = to.getBoundingClientRect();
							return {
								from: { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height / 2 },
								to: { x: toRect.x + toRect.width / 2, y: toRect.y + toRect.height / 2 }
							};
						})()
					`,
					returnByValue: true,
				});

				const positions = result.result.value;
				if (positions.error) {
					return {
						content: [{ type: "text", text: positions.error }],
						details: { success: false },
						isError: true,
					};
				}

				// 模拟拖拽：mouseMoved -> mousePressed -> mouseMoved -> mouseReleased
				await client.Input.dispatchMouseEvent({
					type: "mouseMoved",
					x: positions.from.x,
					y: positions.from.y,
				});
				await client.Input.dispatchMouseEvent({
					type: "mousePressed",
					x: positions.from.x,
					y: positions.from.y,
					button: "left",
					clickCount: 1,
				});
				// 移动到目标
				const steps = 10;
				for (let i = 1; i <= steps; i++) {
					const x = positions.from.x + ((positions.to.x - positions.from.x) * i) / steps;
					const y = positions.from.y + ((positions.to.y - positions.from.y) * i) / steps;
					await client.Input.dispatchMouseEvent({
						type: "mouseMoved",
						x,
						y,
						button: "left",
					});
					await sleep(20);
				}
				await client.Input.dispatchMouseEvent({
					type: "mouseReleased",
					x: positions.to.x,
					y: positions.to.y,
					button: "left",
					clickCount: 1,
				});

				return {
					content: [
						{
							type: "text",
							text: `已将元素从 (${Math.round(positions.from.x)}, ${Math.round(positions.from.y)}) 拖拽到 (${Math.round(positions.to.x)}, ${Math.round(positions.to.y)})`,
						},
					],
					details: { success: true },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ============================================================
	// Phase 2 工具 (调试能力)
	// ============================================================

	// ---------- browser_list_console ----------
	pi.registerTool({
		name: "browser_list_console",
		label: "List Console",
		description: "列出浏览器控制台消息。支持按类型过滤。",
		parameters: LIST_CONSOLE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				
				if (!connection || connection.consoleMessages.length === 0) {
					return {
						content: [{ type: "text", text: "没有控制台消息" }],
						details: { success: true, count: 0 },
					};
				}

				let messages = connection.consoleMessages;
				
				// 按类型过滤
				if (params.types && params.types.length > 0) {
					messages = messages.filter(m => params.types!.includes(m.level));
				}

				// 限制数量
				const limit = params.limit || 100;
				messages = messages.slice(-limit);

				if (messages.length === 0) {
					return {
						content: [{ type: "text", text: "没有匹配的控制台消息" }],
						details: { success: true, count: 0 },
					};
				}

				const lines = messages.map(m => {
					const time = new Date(m.timestamp).toISOString().substr(11, 12);
					const location = m.url ? ` (${m.url}${m.lineNumber ? `:${m.lineNumber}` : ''})` : '';
					return `[${m.id}] [${time}] [${m.level.toUpperCase()}] ${m.text}${location}`;
				});

				return {
					content: [{ type: "text", text: lines.join('\n') }],
					details: { success: true, count: messages.length },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_get_console ----------
	pi.registerTool({
		name: "browser_get_console",
		label: "Get Console",
		description: "获取单条控制台消息的详细信息。",
		parameters: GET_CONSOLE_PARAMS,
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				
				if (!connection) {
					return {
						content: [{ type: "text", text: "未连接到浏览器" }],
						details: { success: false },
						isError: true,
					};
				}

				const message = connection.consoleMessages.find(m => m.id === params.id);
				if (!message) {
					return {
						content: [{ type: "text", text: `未找到消息 ID: ${params.id}` }],
						details: { success: false },
						isError: true,
					};
				}

				const time = new Date(message.timestamp).toISOString();
				const text = [
					`ID: ${message.id}`,
					`级别: ${message.level}`,
					`时间: ${time}`,
					`内容: ${message.text}`,
					message.url ? `URL: ${message.url}` : null,
					message.lineNumber ? `行号: ${message.lineNumber}` : null,
				].filter(Boolean).join('\n');

				return {
					content: [{ type: "text", text }],
					details: { success: true },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_list_network ----------
	pi.registerTool({
		name: "browser_list_network",
		label: "List Network",
		description: "列出浏览器的网络请求。支持按资源类型过滤。",
		parameters: LIST_NETWORK_PARAMS,
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				
				if (!connection || connection.networkRequests.size === 0) {
					return {
						content: [{ type: "text", text: "没有网络请求" }],
						details: { success: true, count: 0 },
					};
				}

				let requests = Array.from(connection.networkRequests.values());
				
				// 按资源类型过滤
				if (params.resourceTypes && params.resourceTypes.length > 0) {
					requests = requests.filter(r => params.resourceTypes!.includes(r.type));
				}

				// 按时间排序（最新的在前）
				requests.sort((a, b) => b.timestamp - a.timestamp);

				// 限制数量
				const limit = params.limit || 100;
				requests = requests.slice(0, limit);

				if (requests.length === 0) {
					return {
						content: [{ type: "text", text: "没有匹配的网络请求" }],
						details: { success: true, count: 0 },
					};
				}

				const lines = requests.map(r => {
					const status = r.status ? `${r.status} ${r.statusText || ''}` : 'pending';
					const url = r.url.length > 80 ? r.url.substring(0, 77) + '...' : r.url;
					return `[${r.id}] ${r.method} ${status} [${r.type}] ${url}`;
				});

				return {
					content: [{ type: "text", text: lines.join('\n') }],
					details: { success: true, count: requests.length },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- browser_get_network ----------
	pi.registerTool({
		name: "browser_get_network",
		label: "Get Network",
		description: "获取单个网络请求的详细信息，包括请求头、响应头、请求体和响应体。",
		parameters: GET_NETWORK_PARAMS,
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				
				if (!connection) {
					return {
						content: [{ type: "text", text: "未连接到浏览器" }],
						details: { success: false },
						isError: true,
					};
				}

				const request = connection.networkRequests.get(params.id);
				if (!request) {
					return {
						content: [{ type: "text", text: `未找到请求 ID: ${params.id}` }],
						details: { success: false },
						isError: true,
					};
				}

				// 尝试获取响应体
				let responseBody: string | undefined;
				try {
					const response = await client.Network.getResponseBody({ requestId: params.id });
					responseBody = response.body;
					if (response.base64Encoded) {
						responseBody = `[Base64 编码，长度: ${responseBody.length}]`;
					}
				} catch {
					responseBody = '[无法获取响应体]';
				}

				const text = [
					`=== 请求信息 ===`,
					`ID: ${request.id}`,
					`URL: ${request.url}`,
					`方法: ${request.method}`,
					`类型: ${request.type}`,
					`时间: ${new Date(request.timestamp * 1000).toISOString()}`,
					``,
					`=== 请求头 ===`,
					request.requestHeaders ? Object.entries(request.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') : '(无)',
					``,
					`=== 请求体 ===`,
					request.requestBody || '(无)',
					``,
					`=== 响应信息 ===`,
					`状态: ${request.status || 'pending'} ${request.statusText || ''}`,
					``,
					`=== 响应头 ===`,
					request.responseHeaders ? Object.entries(request.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') : '(无)',
					``,
					`=== 响应体 ===`,
					responseBody || '(无)',
				].join('\n');

				return {
					content: [{ type: "text", text }],
					details: { success: true },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `错误: ${errorMessage(err)}` }],
					details: { success: false },
					isError: true,
				};
			}
		},
	});

	// ---------- 生命周期 ----------

	pi.on("session_start", async (_event, ctx) => {
		// 加载配置
		const config = loadConfig(ctx.cwd);
		configuredPort = config.port;
		configSource = config.source;

		// 尝试连接，报告状态
		try {
			await ensureConnected(configuredPort);
			ctx.ui.notify(
				`Chrome DevTools 已连接 (port ${configuredPort}, 来源: ${configSource})`,
				"info",
			);
		} catch {
			ctx.ui.notify(
				`Chrome DevTools 未连接 (port ${configuredPort}, 来源: ${configSource})，请确保浏览器已启动调试端口`,
				"warning",
			);
		}
	});

	pi.on("session_shutdown", async () => {
		await disconnect();
	});

	// ---------- 命令 ----------

	pi.registerCommand("chrome-port", {
		description: "设置 Chrome 调试端口: /chrome-port <port>",
		handler: async (args, ctx) => {
			const port = parseInt(args?.trim(), 10);
			if (isNaN(port) || port < 1 || port > 65535) {
				ctx.ui.notify("用法: /chrome-port <1-65535>", "warning");
				return;
			}

			configuredPort = port;
			await disconnect();

			try {
				await ensureConnected(configuredPort);
				ctx.ui.notify(`已切换到端口 ${port} 并连接成功`, "info");
			} catch {
				ctx.ui.notify(`已切换到端口 ${port}，但连接失败`, "warning");
			}
		},
	});

	pi.registerCommand("chrome-status", {
		description: "查看 Chrome DevTools 连接状态和配置来源",
		handler: async (_args, ctx) => {
			if (connection) {
				ctx.ui.notify(
					`已连接: ${connection.target}\n端口配置来源: ${configSource}`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`未连接\n端口: ${configuredPort}\n来源: ${configSource}`,
					"warning",
				);
			}
		},
	});
}

// ============================================================
// 工具函数
// ============================================================

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * 转义 CSS 选择器中的特殊字符，防止注入
 */
function cssEscape(selector: string): string {
	return selector.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

/**
 * 转义 JS 字符串中的特殊字符
 */
function jsEscape(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}
