/**
 * Chrome DevTools Extension for pi - 完全兼容 chrome-devtools-mcp
 * 
 * 工具名称和参数与 chrome-devtools-mcp 完全一致，实现无缝切换。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import CDP from "chrome-remote-interface";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
	uidMap: Map<string, { selector: string; role: string; name: string }>;
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

// ============================================================
// 配置加载
// ============================================================

const DEFAULT_PORT = 19999;
const CONFIG_FILENAME = "chrome-devtools.json";

function loadConfig(cwd: string): { port: number; source: string } {
	const envPort = process.env.CHROME_DEBUG_PORT;
	if (envPort) {
		const port = parseInt(envPort, 10);
		if (!isNaN(port) && port > 0 && port <= 65535) {
			return { port, source: `环境变量 CHROME_DEBUG_PORT=${port}` };
		}
	}

	const projectConfigPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
	if (existsSync(projectConfigPath)) {
		const config = readJsonConfig<{ port?: number }>(projectConfigPath);
		if (config?.port) {
			return { port: config.port, source: `项目配置 ${projectConfigPath}` };
		}
	}

	const homeDir = process.env.USERPROFILE || process.env.HOME || "";
	if (homeDir) {
		const globalConfigPath = join(homeDir, CONFIG_DIR_NAME, "agent", CONFIG_FILENAME);
		if (existsSync(globalConfigPath)) {
			const config = readJsonConfig<{ port?: number }>(globalConfigPath);
			if (config?.port) {
				return { port: config.port, source: `全局配置 ${globalConfigPath}` };
			}
		}
	}

	return { port: DEFAULT_PORT, source: "默认值" };
}

function readJsonConfig<T>(filePath: string): T | null {
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
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
		networkRequests: new Map(),
		uidMap: new Map(),
	};

	client.on("disconnect", () => {
		connection = null;
	});

	// 启用 Log domain
	await client.Log.enable();
	let consoleIdCounter = 1;
	client.Log.entryAdded((event) => {
		connection?.consoleMessages.push({
			id: consoleIdCounter++,
			level: event.entry.level,
			text: event.entry.text,
			timestamp: event.entry.timestamp,
			url: event.entry.url,
			lineNumber: event.entry.lineNumber,
		});
		if (connection && connection.consoleMessages.length > 1000) {
			connection.consoleMessages.shift();
		}
	});

	// 启用 Runtime domain
	await client.Runtime.enable();
	client.Runtime.consoleAPICalled((event) => {
		const text = event.args
			.map((arg) => {
				if (arg.value !== undefined) return String(arg.value);
				if (arg.description) return arg.description;
				return JSON.stringify(arg);
			})
			.join(" ");

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

	// 启用 Network domain
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

	return client;
}

async function disconnect(): Promise<void> {
	if (connection) {
		try {
			await connection.client.close();
		} catch {}
		connection = null;
	}
}

// ============================================================
// UID 系统 - 基于 a11y tree
// ============================================================

let uidCounter = 1;

async function takeSnapshot(client: CDPClient): Promise<string> {
	await client.Accessibility.enable();
	const result = await client.Accessibility.getFullAXTree();

	connection!.uidMap.clear();
	uidCounter = 1;

	const lines: string[] = [];

	function processNode(node: any, depth: number): void {
		if (node.ignored) return;

		const role = node.role?.value || "unknown";
		const name = node.name?.value || "";
		const value = node.value?.value;

		// 为可交互元素分配 uid
		const interactiveRoles = [
			"button", "link", "textbox", "checkbox", "radio",
			"combobox", "menuitem", "tab", "slider", "switch",
			"searchbox", "spinbutton", "option", "img"
		];

		let uid = "";
		if (interactiveRoles.includes(role) || name) {
			uid = `uid${uidCounter++}`;
			const backendNodeId = node.backendDOMNodeId;
			let selector = "";
			if (backendNodeId && backendNodeId !== -1) {
				// 使用 backendNodeId 生成选择器
				selector = `[data-uid="${uid}"]`;
				connection!.uidMap.set(uid, { selector: `#${backendNodeId}`, role, name });
			}
		}

		const indent = "  ".repeat(depth);
		const valueStr = value ? ` value="${value}"` : "";
		const uidStr = uid ? ` [${uid}]` : "";
		lines.push(`${indent}${role}${name ? ` "${name}"` : ""}${valueStr}${uidStr}`);

		if (node.childIds) {
			for (const childId of node.childIds) {
				const childNode = result.nodes.find((n: any) => n.nodeId === childId);
				if (childNode) {
					processNode(childNode, depth + 1);
				}
			}
		}
	}

	// 从根节点开始
	const rootNode = result.nodes.find((n: any) => n.role?.value === "RootWebArea");
	if (rootNode) {
		processNode(rootNode, 0);
	}

	return lines.join("\n");
}

async function getSelectorByUid(uid: string): Promise<string | null> {
	if (!connection) return null;
	const info = connection.uidMap.get(uid);
	if (!info) return null;

	// 使用 backendNodeId 获取元素
	const client = connection.client;
	try {
		const nodeId = parseInt(info.selector.replace("#", ""), 10);
		const result = await client.DOM.describeNode({ nodeId });
		if (result.node.nodeName) {
			// 构建简单的选择器
			const id = result.node.attributes?.find((_, i, arr) => arr[i] === "id");
			if (id && result.node.attributes) {
				const idValue = result.node.attributes[result.node.attributes.indexOf("id") + 1];
				if (idValue) return `#${idValue}`;
			}
			// 使用 nth-child
			return `::-p-xpath(//${result.node.nodeName.toLowerCase()}[${nodeId}])`;
		}
	} catch {}

	return null;
}

// ============================================================
// Extension 入口
// ============================================================

export default function chromeDevtoolsExtension(pi: ExtensionAPI) {
	let configuredPort = DEFAULT_PORT;
	let configSource = "默认值";

	// ============================================================
	// Input automation tools
	// ============================================================

	// ---------- take_snapshot ----------
	pi.registerTool({
		name: "take_snapshot",
		label: "Take Snapshot",
		description: "获取页面的 a11y tree 快照，包含每个元素的 uid，用于后续操作。",
		parameters: Type.Object({
			filePath: Type.Optional(Type.String({ description: "保存快照的文件路径" })),
			verbose: Type.Optional(Type.Boolean({ description: "是否包含完整信息" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const snapshot = await takeSnapshot(client);

				if (params.filePath) {
					writeFileSync(params.filePath, snapshot);
					return {
						content: [{ type: "text", text: `快照已保存到: ${params.filePath}` }],
						details: { success: true },
					};
				}

				return {
					content: [{ type: "text", text: snapshot }],
					details: { success: true, uidCount: connection?.uidMap.size || 0 },
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

	// ---------- click ----------
	pi.registerTool({
		name: "click",
		label: "Click",
		description: "点击指定 uid 的元素",
		parameters: Type.Object({
			uid: Type.String({ description: "元素的 uid（从 take_snapshot 获取）" }),
			dblClick: Type.Optional(Type.Boolean({ description: "是否双击" })),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const info = connection?.uidMap.get(params.uid);
				if (!info) {
					return {
						content: [{ type: "text", text: `未找到 uid: ${params.uid}` }],
						details: { success: false },
						isError: true,
					};
				}

				// 使用 backendNodeId 点击
				const nodeId = parseInt(info.selector.replace("#", ""), 10);
				await client.DOM.focus({ nodeId });
				
				// 模拟点击
				const box = await client.DOM.getBoxModel({ nodeId });
				if (box.model) {
					const x = (box.model.content[0] + box.model.content[2]) / 2;
					const y = (box.model.content[1] + box.model.content[5]) / 2;
					
					await client.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
					await client.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
					await client.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
					
					if (params.dblClick) {
						await client.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 2 });
						await client.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 2 });
					}
				}

				let result = `已点击元素 [${params.uid}] ${info.role} "${info.name}"`;
				
				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- fill ----------
	pi.registerTool({
		name: "fill",
		label: "Fill",
		description: "在输入框或选择框中填入值",
		parameters: Type.Object({
			uid: Type.String({ description: "元素的 uid" }),
			value: Type.String({ description: "要填入的值" }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const info = connection?.uidMap.get(params.uid);
				if (!info) {
					return {
						content: [{ type: "text", text: `未找到 uid: ${params.uid}` }],
						details: { success: false },
						isError: true,
					};
				}

				const nodeId = parseInt(info.selector.replace("#", ""), 10);
				await client.DOM.focus({ nodeId });

				// 使用 Runtime.evaluate 设置值
				await client.Runtime.evaluate({
					expression: `
						(() => {
							const el = document.activeElement;
							if (!el) return 'no active element';
							const nativeSetter = Object.getOwnPropertyDescriptor(
								window.HTMLInputElement.prototype, 'value'
							)?.set || Object.getOwnPropertyDescriptor(
								window.HTMLTextAreaElement.prototype, 'value'
							)?.set;
							if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(params.value)});
							else el.value = ${JSON.stringify(params.value)};
							el.dispatchEvent(new Event('input', { bubbles: true }));
							el.dispatchEvent(new Event('change', { bubbles: true }));
							return 'ok';
						})()
					`,
					returnByValue: true,
				});

				let result = `已在 [${params.uid}] ${info.role} "${info.name}" 中填入: "${params.value}"`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- hover ----------
	pi.registerTool({
		name: "hover",
		label: "Hover",
		description: "悬停在指定元素上",
		parameters: Type.Object({
			uid: Type.String({ description: "元素的 uid" }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const info = connection?.uidMap.get(params.uid);
				if (!info) {
					return {
						content: [{ type: "text", text: `未找到 uid: ${params.uid}` }],
						details: { success: false },
						isError: true,
					};
				}

				const nodeId = parseInt(info.selector.replace("#", ""), 10);
				const box = await client.DOM.getBoxModel({ nodeId });
				if (box.model) {
					const x = (box.model.content[0] + box.model.content[2]) / 2;
					const y = (box.model.content[1] + box.model.content[5]) / 2;
					await client.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
				}

				let result = `已悬停在 [${params.uid}] ${info.role} "${info.name}"`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- press_key ----------
	pi.registerTool({
		name: "press_key",
		label: "Press Key",
		description: "按下按键或组合键",
		parameters: Type.Object({
			key: Type.String({ description: '按键，如 "Enter", "Control+A"' }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				const parts = params.key.split("+");
				const key = parts[parts.length - 1];
				const modifiers = parts.slice(0, -1);

				let modifiersBit = 0;
				for (const mod of modifiers) {
					const m = mod.toLowerCase();
					if (m === "control" || m === "ctrl") modifiersBit |= 2;
					else if (m === "alt") modifiersBit |= 1;
					else if (m === "shift") modifiersBit |= 8;
					else if (m === "meta" || m === "cmd") modifiersBit |= 4;
				}

				await client.Input.dispatchKeyEvent({ type: "keyDown", key, modifiers: modifiersBit });
				await client.Input.dispatchKeyEvent({ type: "keyUp", key, modifiers: modifiersBit });

				let result = `已按下: ${params.key}`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- type_text ----------
	pi.registerTool({
		name: "type_text",
		label: "Type Text",
		description: "在当前焦点元素中输入文字",
		parameters: Type.Object({
			text: Type.String({ description: "要输入的文字" }),
			submitKey: Type.Optional(Type.String({ description: "输入后按的键，如 Enter" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 逐字符输入
				for (const char of params.text) {
					await client.Input.dispatchKeyEvent({ type: "keyDown", text: char });
					await client.Input.dispatchKeyEvent({ type: "keyUp", text: char });
				}

				if (params.submitKey) {
					await client.Input.dispatchKeyEvent({ type: "keyDown", key: params.submitKey });
					await client.Input.dispatchKeyEvent({ type: "keyUp", key: params.submitKey });
				}

				return {
					content: [{ type: "text", text: `已输入: "${params.text}"${params.submitKey ? ` 并按下 ${params.submitKey}` : ""}` }],
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

	// ---------- handle_dialog ----------
	pi.registerTool({
		name: "handle_dialog",
		label: "Handle Dialog",
		description: "处理浏览器弹窗",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("accept"), Type.Literal("dismiss")]),
			promptText: Type.Optional(Type.String({ description: "prompt 弹窗的输入" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.Page.enable();
				await client.Page.handleJavaScriptDialog({
					accept: params.action === "accept",
					promptText: params.promptText,
				});

				return {
					content: [{ type: "text", text: `已${params.action === "accept" ? "接受" : "取消"}弹窗` }],
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

	// ---------- upload_file ----------
	pi.registerTool({
		name: "upload_file",
		label: "Upload File",
		description: "上传文件到 file input 元素",
		parameters: Type.Object({
			filePath: Type.String({ description: "文件路径" }),
			uid: Type.String({ description: "file input 元素的 uid" }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const info = connection?.uidMap.get(params.uid);
				if (!info) {
					return {
						content: [{ type: "text", text: `未找到 uid: ${params.uid}` }],
						details: { success: false },
						isError: true,
					};
				}

				const nodeId = parseInt(info.selector.replace("#", ""), 10);
				await client.DOM.setFileInputFiles({ nodeId, files: [params.filePath] });

				let result = `已上传文件: ${params.filePath}`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- drag ----------
	pi.registerTool({
		name: "drag",
		label: "Drag",
		description: "拖拽元素到另一个元素",
		parameters: Type.Object({
			from_uid: Type.String({ description: "起始元素 uid" }),
			to_uid: Type.String({ description: "目标元素 uid" }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const fromInfo = connection?.uidMap.get(params.from_uid);
				const toInfo = connection?.uidMap.get(params.to_uid);
				if (!fromInfo || !toInfo) {
					return {
						content: [{ type: "text", text: `未找到元素` }],
						details: { success: false },
						isError: true,
					};
				}

				const fromNodeId = parseInt(fromInfo.selector.replace("#", ""), 10);
				const toNodeId = parseInt(toInfo.selector.replace("#", ""), 10);
				const fromBox = await client.DOM.getBoxModel({ nodeId: fromNodeId });
				const toBox = await client.DOM.getBoxModel({ nodeId: toNodeId });

				if (!fromBox.model || !toBox.model) {
					return {
						content: [{ type: "text", text: "无法获取元素位置" }],
						details: { success: false },
						isError: true,
					};
				}

				const fromX = (fromBox.model.content[0] + fromBox.model.content[2]) / 2;
				const fromY = (fromBox.model.content[1] + fromBox.model.content[5]) / 2;
				const toX = (toBox.model.content[0] + toBox.model.content[2]) / 2;
				const toY = (toBox.model.content[1] + toBox.model.content[5]) / 2;

				await client.Input.dispatchMouseEvent({ type: "mouseMoved", x: fromX, y: fromY });
				await client.Input.dispatchMouseEvent({ type: "mousePressed", x: fromX, y: fromY, button: "left", clickCount: 1 });
				
				const steps = 10;
				for (let i = 1; i <= steps; i++) {
					const x = fromX + ((toX - fromX) * i) / steps;
					const y = fromY + ((toY - fromY) * i) / steps;
					await client.Input.dispatchMouseEvent({ type: "mouseMoved", x, y, button: "left" });
				}
				
				await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: toX, y: toY, button: "left", clickCount: 1 });

				let result = `已拖拽 [${params.from_uid}] 到 [${params.to_uid}]`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- fill_form ----------
	pi.registerTool({
		name: "fill_form",
		label: "Fill Form",
		description: "批量填写表单",
		parameters: Type.Object({
			elements: Type.Array(Type.Object({
				uid: Type.String(),
				value: Type.String(),
			}), { description: "要填写的元素列表" }),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const results: string[] = [];

				for (const el of params.elements) {
					const info = connection?.uidMap.get(el.uid);
					if (!info) {
						results.push(`[${el.uid}] 未找到`);
						continue;
					}

					const nodeId = parseInt(info.selector.replace("#", ""), 10);
					await client.DOM.focus({ nodeId });
					await client.Runtime.evaluate({
						expression: `
							(() => {
								const el = document.activeElement;
								const nativeSetter = Object.getOwnPropertyDescriptor(
									window.HTMLInputElement.prototype, 'value'
								)?.set || Object.getOwnPropertyDescriptor(
									window.HTMLTextAreaElement.prototype, 'value'
								)?.set;
								if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(el.value)});
								else el.value = ${JSON.stringify(el.value)};
								el.dispatchEvent(new Event('input', { bubbles: true }));
								el.dispatchEvent(new Event('change', { bubbles: true }));
							})()
						`,
						returnByValue: true,
					});
					results.push(`[${el.uid}] ${info.name}: "${el.value}"`);
				}

				let result = `已填写 ${params.elements.length} 个元素:\n${results.join("\n")}`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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

	// ---------- click_at ----------
	pi.registerTool({
		name: "click_at",
		label: "Click At",
		description: "点击指定坐标",
		parameters: Type.Object({
			x: Type.Number({ description: "X 坐标" }),
			y: Type.Number({ description: "Y 坐标" }),
			dblClick: Type.Optional(Type.Boolean({ description: "是否双击" })),
			includeSnapshot: Type.Optional(Type.Boolean({ description: "是否返回快照" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				await client.Input.dispatchMouseEvent({ type: "mouseMoved", x: params.x, y: params.y });
				await client.Input.dispatchMouseEvent({ type: "mousePressed", x: params.x, y: params.y, button: "left", clickCount: 1 });
				await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: params.x, y: params.y, button: "left", clickCount: 1 });

				if (params.dblClick) {
					await client.Input.dispatchMouseEvent({ type: "mousePressed", x: params.x, y: params.y, button: "left", clickCount: 2 });
					await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: params.x, y: params.y, button: "left", clickCount: 2 });
				}

				let result = `已点击坐标 (${params.x}, ${params.y})`;

				if (params.includeSnapshot) {
					const snapshot = await takeSnapshot(client);
					result += `\n\n--- 页面快照 ---\n${snapshot}`;
				}

				return {
					content: [{ type: "text", text: result }],
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
	// Navigation tools
	// ============================================================

	// ---------- navigate_page ----------
	pi.registerTool({
		name: "navigate_page",
		label: "Navigate Page",
		description: "导航到 URL 或执行前进/后退/刷新",
		parameters: Type.Object({
			type: Type.Optional(Type.Union([
				Type.Literal("url"), Type.Literal("back"), Type.Literal("forward"), Type.Literal("reload")
			], { description: "导航类型" })),
			url: Type.Optional(Type.String({ description: "目标 URL" })),
			timeout: Type.Optional(Type.Number({ description: "超时时间(ms)" })),
			ignoreCache: Type.Optional(Type.Boolean({ description: "是否忽略缓存" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.Page.enable();

				const navType = params.type || "url";

				if (navType === "url" && params.url) {
					await client.Page.navigate({ url: params.url });
					await client.Page.loadEventFired();
					return {
						content: [{ type: "text", text: `已导航到: ${params.url}` }],
						details: { success: true },
					};
				} else if (navType === "back") {
					const history = await client.Page.getNavigationHistory();
					if (history.currentIndex > 0) {
						await client.Page.navigateToHistoryEntry({ entryId: history.entries[history.currentIndex - 1].id });
						return { content: [{ type: "text", text: "已后退" }], details: { success: true } };
					}
					return { content: [{ type: "text", text: "无法后退（已在最开始）" }], details: { success: false }, isError: true };
				} else if (navType === "forward") {
					const history = await client.Page.getNavigationHistory();
					if (history.currentIndex < history.entries.length - 1) {
						await client.Page.navigateToHistoryEntry({ entryId: history.entries[history.currentIndex + 1].id });
						return { content: [{ type: "text", text: "已前进" }], details: { success: true } };
					}
					return { content: [{ type: "text", text: "无法前进（已在最后）" }], details: { success: false }, isError: true };
				} else if (navType === "reload") {
					await client.Page.reload({ ignoreCache: params.ignoreCache });
					await client.Page.loadEventFired();
					return { content: [{ type: "text", text: "已刷新" }], details: { success: true } };
				}

				return { content: [{ type: "text", text: "无效的导航类型" }], details: { success: false }, isError: true };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- list_pages ----------
	pi.registerTool({
		name: "list_pages",
		label: "List Pages",
		description: "列出所有打开的页面",
		parameters: Type.Object({}),
		async execute() {
			try {
				const client = await ensureConnected(configuredPort);
				const result = await client.Target.getTargets();
				const pages = result.targetInfos.filter((t) => t.type === "page");

				if (pages.length === 0) {
					return { content: [{ type: "text", text: "没有打开的页面" }], details: { success: true, count: 0 } };
				}

				const lines = pages.map((p, i) => `${i + 1}. [pageId: ${i}] ${p.title}\n   URL: ${p.url}`);
				return { content: [{ type: "text", text: lines.join("\n\n") }], details: { success: true, count: pages.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- select_page ----------
	pi.registerTool({
		name: "select_page",
		label: "Select Page",
		description: "选择页面作为后续操作的上下文",
		parameters: Type.Object({
			pageId: Type.Number({ description: "页面 ID（从 list_pages 获取）" }),
			bringToFront: Type.Optional(Type.Boolean({ description: "是否带到前台" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const result = await client.Target.getTargets();
				const pages = result.targetInfos.filter((t) => t.type === "page");
				
				if (params.pageId < 0 || params.pageId >= pages.length) {
					return { content: [{ type: "text", text: `无效的 pageId: ${params.pageId}` }], details: { success: false }, isError: true };
				}

				const target = pages[params.pageId];
				await client.Target.activateTarget({ targetId: target.targetId });

				// 重新连接到新页面
				await disconnect();
				const newClient = await CDP({ port: configuredPort, target: target.targetId });
				connection = { client: newClient, target: target.targetId, consoleMessages: [], networkRequests: new Map(), uidMap: new Map() };
				newClient.on("disconnect", () => { connection = null; });

				return {
					content: [{ type: "text", text: `已选择页面: ${target.title}` }],
					details: { success: true },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- new_page ----------
	pi.registerTool({
		name: "new_page",
		label: "New Page",
		description: "打开新页面",
		parameters: Type.Object({
			url: Type.String({ description: "要加载的 URL" }),
			background: Type.Optional(Type.Boolean({ description: "是否在后台打开" })),
			timeout: Type.Optional(Type.Number({ description: "超时时间(ms)" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const result = await client.Target.createTarget({ url: params.url });

				if (!params.background) {
					await client.Target.activateTarget({ targetId: result.targetId });
					await disconnect();
					const newClient = await CDP({ port: configuredPort, target: result.targetId });
					connection = { client: newClient, target: result.targetId, consoleMessages: [], networkRequests: new Map(), uidMap: new Map() };
					newClient.on("disconnect", () => { connection = null; });
				}

				return {
					content: [{ type: "text", text: `已打开新页面: ${params.url}` }],
					details: { success: true, targetId: result.targetId },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- close_page ----------
	pi.registerTool({
		name: "close_page",
		label: "Close Page",
		description: "关闭页面",
		parameters: Type.Object({
			pageId: Type.Number({ description: "页面 ID" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const result = await client.Target.getTargets();
				const pages = result.targetInfos.filter((t) => t.type === "page");

				if (pages.length <= 1) {
					return { content: [{ type: "text", text: "无法关闭最后一个页面" }], details: { success: false }, isError: true };
				}

				if (params.pageId < 0 || params.pageId >= pages.length) {
					return { content: [{ type: "text", text: `无效的 pageId: ${params.pageId}` }], details: { success: false }, isError: true };
				}

				await client.Target.closeTarget({ targetId: pages[params.pageId].targetId });
				return { content: [{ type: "text", text: "已关闭页面" }], details: { success: true } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- wait_for ----------
	pi.registerTool({
		name: "wait_for",
		label: "Wait For",
		description: "等待指定文字出现在页面上",
		parameters: Type.Object({
			text: Type.Array(Type.String(), { description: "要等待的文字列表" }),
			timeout: Type.Optional(Type.Number({ description: "超时时间(ms)", default: 30000 })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const timeout = params.timeout || 30000;
				const startTime = Date.now();

				while (Date.now() - startTime < timeout) {
					const result = await client.Runtime.evaluate({
						expression: `document.body.innerText`,
						returnByValue: true,
					});

					const pageText = result.result.value || "";
					for (const t of params.text) {
						if (pageText.includes(t)) {
							return {
								content: [{ type: "text", text: `已找到文字: "${t}"` }],
								details: { success: true },
							};
						}
					}

					await new Promise(r => setTimeout(r, 500));
				}

				return {
					content: [{ type: "text", text: `等待超时 (${timeout}ms)，未找到: ${params.text.join(", ")}` }],
					details: { success: false },
					isError: true,
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Debugging tools
	// ============================================================

	// ---------- take_screenshot ----------
	pi.registerTool({
		name: "take_screenshot",
		label: "Take Screenshot",
		description: "截取页面或元素截图",
		parameters: Type.Object({
			uid: Type.Optional(Type.String({ description: "元素 uid" })),
			fullPage: Type.Optional(Type.Boolean({ description: "是否截取完整页面" })),
			format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg"), Type.Literal("webp")])),
			quality: Type.Optional(Type.Number({ description: "JPEG/WebP 质量 0-100" })),
			filePath: Type.Optional(Type.String({ description: "保存路径" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.Page.enable();

				const format = params.format || "png";
				let clip: any = undefined;

				if (params.uid) {
					const info = connection?.uidMap.get(params.uid);
					if (info) {
						const nodeId = parseInt(info.selector.replace("#", ""), 10);
						const box = await client.DOM.getBoxModel({ nodeId });
						if (box.model) {
							clip = {
								x: box.model.content[0],
								y: box.model.content[1],
								width: box.model.width,
								height: box.model.height,
								scale: 1,
							};
						}
					}
				}

				const screenshot = await client.Page.captureScreenshot({
					format,
					quality: params.quality,
					clip,
					captureBeyondViewport: params.fullPage,
				});

				if (params.filePath) {
					writeFileSync(params.filePath, Buffer.from(screenshot.data, "base64"));
					return {
						content: [{ type: "text", text: `截图已保存到: ${params.filePath}` }],
						details: { success: true },
					};
				}

				return {
					content: [
						{ type: "image", source: { type: "base64", mediaType: `image/${format}`, data: screenshot.data } },
						{ type: "text", text: params.uid ? `已截取元素 [${params.uid}]` : params.fullPage ? "已截取完整页面" : "已截取当前视口" },
					],
					details: { success: true },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- evaluate_script ----------
	pi.registerTool({
		name: "evaluate_script",
		label: "Evaluate Script",
		description: "在页面中执行 JavaScript 函数",
		parameters: Type.Object({
			function: Type.String({ description: "JavaScript 函数，如 () => document.title" }),
			args: Type.Optional(Type.Array(Type.Any(), { description: "函数参数" })),
			filePath: Type.Optional(Type.String({ description: "保存结果的文件路径" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);

				// 构建执行表达式
				let expression = `(${params.function})`;
				if (params.args && params.args.length > 0) {
					expression += `(${params.args.map(a => JSON.stringify(a)).join(",")})`;
				} else {
					expression += `()`;
				}

				const result = await client.Runtime.evaluate({
					expression,
					returnByValue: true,
					awaitPromise: true,
				});

				if (result.exceptionDetails) {
					return {
						content: [{ type: "text", text: `执行错误: ${result.exceptionDetails.text}` }],
						details: { success: false },
						isError: true,
					};
				}

				const value = result.result.value;
				const text = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

				if (params.filePath) {
					writeFileSync(params.filePath, text);
					return {
						content: [{ type: "text", text: `结果已保存到: ${params.filePath}` }],
						details: { success: true },
					};
				}

				return {
					content: [{ type: "text", text }],
					details: { success: true },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- list_console_messages ----------
	pi.registerTool({
		name: "list_console_messages",
		label: "List Console Messages",
		description: "列出控制台消息",
		parameters: Type.Object({
			types: Type.Optional(Type.Array(Type.String(), { description: "过滤类型" })),
			pageSize: Type.Optional(Type.Number({ description: "每页数量" })),
			pageIdx: Type.Optional(Type.Number({ description: "页码" })),
		}),
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				let messages = connection?.consoleMessages || [];

				if (params.types && params.types.length > 0) {
					messages = messages.filter(m => params.types!.includes(m.level));
				}

				const pageSize = params.pageSize || messages.length;
				const pageIdx = params.pageIdx || 0;
				messages = messages.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);

				if (messages.length === 0) {
					return { content: [{ type: "text", text: "没有控制台消息" }], details: { success: true, count: 0 } };
				}

				const lines = messages.map(m => `[${m.id}] [${m.level}] ${m.text}`);
				return { content: [{ type: "text", text: lines.join("\n") }], details: { success: true, count: messages.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- get_console_message ----------
	pi.registerTool({
		name: "get_console_message",
		label: "Get Console Message",
		description: "获取单条控制台消息详情",
		parameters: Type.Object({
			msgid: Type.Number({ description: "消息 ID" }),
		}),
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				const msg = connection?.consoleMessages.find(m => m.id === params.msgid);
				if (!msg) {
					return { content: [{ type: "text", text: `未找到消息 ID: ${params.msgid}` }], details: { success: false }, isError: true };
				}

				return {
					content: [{ type: "text", text: `[${msg.id}] [${msg.level}] ${new Date(msg.timestamp).toISOString()}\n${msg.text}${msg.url ? `\nURL: ${msg.url}` : ""}` }],
					details: { success: true },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- list_network_requests ----------
	pi.registerTool({
		name: "list_network_requests",
		label: "List Network Requests",
		description: "列出网络请求",
		parameters: Type.Object({
			resourceTypes: Type.Optional(Type.Array(Type.String(), { description: "过滤资源类型" })),
			pageSize: Type.Optional(Type.Number({ description: "每页数量" })),
			pageIdx: Type.Optional(Type.Number({ description: "页码" })),
		}),
		async execute(_toolCallId, params) {
			try {
				await ensureConnected(configuredPort);
				let requests = Array.from(connection?.networkRequests.values() || []);

				if (params.resourceTypes && params.resourceTypes.length > 0) {
					requests = requests.filter(r => params.resourceTypes!.includes(r.type));
				}

				requests.sort((a, b) => b.timestamp - a.timestamp);

				const pageSize = params.pageSize || requests.length;
				const pageIdx = params.pageIdx || 0;
				requests = requests.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);

				if (requests.length === 0) {
					return { content: [{ type: "text", text: "没有网络请求" }], details: { success: true, count: 0 } };
				}

				const lines = requests.map(r => `[${r.id}] ${r.method} ${r.status || "pending"} [${r.type}] ${r.url.substring(0, 80)}`);
				return { content: [{ type: "text", text: lines.join("\n") }], details: { success: true, count: requests.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- get_network_request ----------
	pi.registerTool({
		name: "get_network_request",
		label: "Get Network Request",
		description: "获取网络请求详情",
		parameters: Type.Object({
			reqid: Type.Optional(Type.String({ description: "请求 ID" })),
			requestFilePath: Type.Optional(Type.String({ description: "保存请求体的路径" })),
			responseFilePath: Type.Optional(Type.String({ description: "保存响应体的路径" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				
				let req: NetworkRequest | undefined;
				if (params.reqid) {
					req = connection?.networkRequests.get(params.reqid);
				} else {
					// 获取最新的请求
					const requests = Array.from(connection?.networkRequests.values() || []);
					req = requests[requests.length - 1];
				}

				if (!req) {
					return { content: [{ type: "text", text: "未找到请求" }], details: { success: false }, isError: true };
				}

				// 获取响应体
				let responseBody = "";
				try {
					const response = await client.Network.getResponseBody({ requestId: req.id });
					responseBody = response.body;
					if (response.base64Encoded) {
						responseBody = `[Base64, ${responseBody.length} bytes]`;
					}
				} catch {
					responseBody = "[无法获取]";
				}

				const text = [
					`=== 请求 ===`,
					`URL: ${req.url}`,
					`方法: ${req.method}`,
					`类型: ${req.type}`,
					`状态: ${req.status || "pending"}`,
					``,
					`=== 请求头 ===`,
					req.requestHeaders ? Object.entries(req.requestHeaders).map(([k, v]) => `${k}: ${v}`).join("\n") : "(无)",
					``,
					`=== 请求体 ===`,
					req.requestBody || "(无)",
					``,
					`=== 响应头 ===`,
					req.responseHeaders ? Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join("\n") : "(无)",
					``,
					`=== 响应体 ===`,
					responseBody,
				].join("\n");

				if (params.responseFilePath) {
					writeFileSync(params.responseFilePath, responseBody);
				}

				return { content: [{ type: "text", text }], details: { success: true } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Emulation tools
	// ============================================================

	// ---------- emulate ----------
	pi.registerTool({
		name: "emulate",
		label: "Emulate",
		description: "模拟设备特性",
		parameters: Type.Object({
			viewport: Type.Optional(Type.String({ description: "视口，如 '1280x720' 或 '375x667x2,mobile,touch'" })),
			userAgent: Type.Optional(Type.String({ description: "User Agent" })),
			colorScheme: Type.Optional(Type.Union([Type.Literal("dark"), Type.Literal("light"), Type.Literal("auto")])),
			networkConditions: Type.Optional(Type.Union([
				Type.Literal("Offline"), Type.Literal("Slow 3G"), Type.Literal("Fast 3G"),
				Type.Literal("Slow 4G"), Type.Literal("Fast 4G")
			])),
			geolocation: Type.Optional(Type.String({ description: "地理位置，如 '39.9,116.4'" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				const results: string[] = [];

				if (params.viewport) {
					const parts = params.viewport.split("x");
					const width = parseInt(parts[0], 10);
					const heightPart = parts[1] || "720";
					const height = parseInt(heightPart.split(",")[0], 10);
					const scale = heightPart.includes("x") ? parseFloat(heightPart.split("x")[1]) : 1;
					const mobile = params.viewport.includes("mobile");

					await client.Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: scale, mobile });
					results.push(`视口: ${width}x${height}`);
				}

				if (params.userAgent) {
					await client.Emulation.setUserAgentOverride({ userAgent: params.userAgent });
					results.push(`UA: ${params.userAgent.substring(0, 50)}...`);
				}

				if (params.colorScheme && params.colorScheme !== "auto") {
					await client.Emulation.setEmulatedMedia({ media: "", features: [{ name: "prefers-color-scheme", value: params.colorScheme }] });
					results.push(`颜色: ${params.colorScheme}`);
				}

				if (params.networkConditions) {
					const conditions: Record<string, any> = {
						"Offline": { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
						"Slow 3G": { offline: false, latency: 2000, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 },
						"Fast 3G": { offline: false, latency: 500, downloadThroughput: 1.5 * 1024 * 1024, uploadThroughput: 750 * 1024 },
						"Slow 4G": { offline: false, latency: 150, downloadThroughput: 4 * 1024 * 1024, uploadThroughput: 3 * 1024 * 1024 },
						"Fast 4G": { offline: false, latency: 50, downloadThroughput: 10 * 1024 * 1024, uploadThroughput: 5 * 1024 * 1024 },
					};
					await client.Network.emulateNetworkConditions(conditions[params.networkConditions]);
					results.push(`网络: ${params.networkConditions}`);
				}

				if (params.geolocation) {
					const [lat, lng] = params.geolocation.split(",").map(parseFloat);
					await client.Emulation.setGeolocationOverride({ latitude: lat, longitude: lng, accuracy: 100 });
					results.push(`位置: ${lat}, ${lng}`);
				}

				return { content: [{ type: "text", text: `已应用:\n${results.join("\n")}` }], details: { success: true } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ---------- resize_page ----------
	pi.registerTool({
		name: "resize_page",
		label: "Resize Page",
		description: "调整页面大小",
		parameters: Type.Object({
			width: Type.Number({ description: "宽度" }),
			height: Type.Number({ description: "高度" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.Emulation.setDeviceMetricsOverride({
					width: params.width, height: params.height, deviceScaleFactor: 1, mobile: false
				});
				return { content: [{ type: "text", text: `已调整为 ${params.width}x${params.height}` }], details: { success: true } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Performance tools
	// ============================================================

	let isTracing = false;
	let traceData: string[] = [];

	pi.registerTool({
		name: "performance_start_trace",
		label: "Performance Start Trace",
		description: "开始性能追踪",
		parameters: Type.Object({
			reload: Type.Optional(Type.Boolean({ description: "是否刷新页面" })),
			autoStop: Type.Optional(Type.Boolean({ description: "是否自动停止" })),
			filePath: Type.Optional(Type.String({ description: "保存路径" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				if (isTracing) {
					return { content: [{ type: "text", text: "追踪已在进行中" }], details: { success: false }, isError: true };
				}

				traceData = [];
				client.Tracing.dataCollected((event) => {
					traceData.push(...event.value.map((v: any) => JSON.stringify(v)));
				});

				await client.Tracing.start({
					categories: "devtools.timeline,v8.execute,disabled-by-default-devtools.timeline",
					transferMode: "ReturnAsStream",
				});

				isTracing = true;

				if (params.reload) {
					await client.Page.reload();
				}

				return { content: [{ type: "text", text: "性能追踪已开始" }], details: { success: true } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "performance_stop_trace",
		label: "Performance Stop Trace",
		description: "停止性能追踪",
		parameters: Type.Object({
			filePath: Type.Optional(Type.String({ description: "保存路径" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				if (!isTracing) {
					return { content: [{ type: "text", text: "没有正在进行的追踪" }], details: { success: false }, isError: true };
				}

				await new Promise<void>((resolve) => {
					client.Tracing.tracingComplete(() => resolve());
					client.Tracing.end();
				});

				isTracing = false;

				if (params.filePath) {
					writeFileSync(params.filePath, traceData.join("\n"));
					return { content: [{ type: "text", text: `追踪数据已保存到: ${params.filePath}` }], details: { success: true } };
				}

				return { content: [{ type: "text", text: `追踪完成，收集了 ${traceData.length} 条记录` }], details: { success: true } };
			} catch (err) {
				isTracing = false;
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Memory tools
	// ============================================================

	pi.registerTool({
		name: "take_heapsnapshot",
		label: "Take Heap Snapshot",
		description: "捕获堆快照",
		parameters: Type.Object({
			filePath: Type.String({ description: "保存路径" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const client = await ensureConnected(configuredPort);
				await client.HeapProfiler.enable();

				const chunks: string[] = [];
				client.HeapProfiler.addHeapSnapshotChunk((event) => chunks.push(event.chunk));

				await new Promise<void>((resolve) => {
					client.HeapProfiler.reportHeapSnapshotProgress((event) => {
						if (event.finished) resolve();
					});
					client.HeapProfiler.takeHeapSnapshot({ reportProgress: true });
				});

				writeFileSync(params.filePath, chunks.join(""));
				await client.HeapProfiler.disable();

				return {
					content: [{ type: "text", text: `堆快照已保存: ${params.filePath} (${(chunks.join("").length / 1024 / 1024).toFixed(2)} MB)` }],
					details: { success: true },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "compare_heapsnapshots",
		label: "Compare Heap Snapshots",
		description: "比较两个堆快照",
		parameters: Type.Object({
			baseFilePath: Type.String({ description: "基准快照路径" }),
			currentFilePath: Type.String({ description: "当前快照路径" }),
		}),
		async execute(_toolCallId, params) {
			try {
				if (!existsSync(params.baseFilePath) || !existsSync(params.currentFilePath)) {
					return { content: [{ type: "text", text: "快照文件不存在" }], details: { success: false }, isError: true };
				}

				const baseSize = readFileSync(params.baseFilePath).length;
				const currentSize = readFileSync(params.currentFilePath).length;
				const diff = currentSize - baseSize;

				return {
					content: [{
						type: "text",
						text: `基准: ${(baseSize / 1024 / 1024).toFixed(2)} MB\n当前: ${(currentSize / 1024 / 1024).toFixed(2)} MB\n变化: ${diff > 0 ? "+" : ""}${(diff / 1024 / 1024).toFixed(2)} MB`,
					}],
					details: { success: true, diff },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Extension tools
	// ============================================================

	pi.registerTool({
		name: "list_extensions",
		label: "List Extensions",
		description: "列出已安装的扩展",
		parameters: Type.Object({}),
		async execute() {
			try {
				const client = await ensureConnected(configuredPort);
				const result = await client.Runtime.evaluate({
					expression: `
						new Promise((resolve) => {
							if (typeof chrome !== 'undefined' && chrome.management) {
								chrome.management.getAll((exts) => resolve(JSON.stringify(exts.map(e => ({
									id: e.id, name: e.name, version: e.version, enabled: e.enabled
								}))));
							} else {
								resolve(JSON.stringify({ error: 'chrome.management 不可用' }));
							}
						})
					`,
					returnByValue: true,
					awaitPromise: true,
				});

				const data = JSON.parse(result.result.value);
				if (data.error) {
					return { content: [{ type: "text", text: data.error }], details: { success: false }, isError: true };
				}

				if (!Array.isArray(data) || data.length === 0) {
					return { content: [{ type: "text", text: "没有已安装的扩展" }], details: { success: true, count: 0 } };
				}

				const lines = data.map((e: any, i: number) => `${i + 1}. ${e.name} v${e.version} [${e.id}] ${e.enabled ? "✓" : "✗"}`);
				return { content: [{ type: "text", text: lines.join("\n") }], details: { success: true, count: data.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `错误: ${errorMessage(err)}` }], details: { success: false }, isError: true };
			}
		},
	});

	// ============================================================
	// Lifecycle
	// ============================================================

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		configuredPort = config.port;
		configSource = config.source;

		try {
			await ensureConnected(configuredPort);
			ctx.ui.notify(`Chrome DevTools 已连接 (port ${configuredPort})`, "info");
		} catch {
			ctx.ui.notify(`Chrome DevTools 未连接 (port ${configuredPort})`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		await disconnect();
	});

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
				ctx.ui.notify(`已连接到端口 ${port}`, "info");
			} catch {
				ctx.ui.notify(`连接端口 ${port} 失败`, "warning");
			}
		},
	});
}

// ============================================================
// Utils
// ============================================================

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
