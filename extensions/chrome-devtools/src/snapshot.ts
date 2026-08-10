/**
 * a11y tree 快照构建（纯逻辑，无 CDP / 无模块全局依赖）。
 *
 * 从 index.ts 的 takeSnapshot 抽出，便于单元测试 uid 分配与文本格式化。
 * 行为与 chrome-devtools-mcp 的快照语义对齐。
 */

/** a11y tree 节点（CDP Accessibility.getFullAXTree 返回结构的子集）。 */
export interface AxNode {
	nodeId?: string;
	role?: { value?: string };
	name?: { value?: string };
	value?: { value?: unknown };
	ignored?: boolean;
	backendDOMNodeId?: number;
	childIds?: string[];
}

/** uid 映射条目：selector 形如 `#<backendNodeId>`。 */
export interface UidEntry {
	selector: string;
	role: string;
	name: string;
}

/** 分配 uid 的可交互角色。 */
export const INTERACTIVE_ROLES: string[] = [
	"button", "link", "textbox", "checkbox", "radio",
	"combobox", "menuitem", "tab", "slider", "switch",
	"searchbox", "spinbutton", "option", "img",
];

/**
 * 把 a11y tree 节点列表转成快照文本 + uid 映射。
 *
 * 规则（与原 takeSnapshot 一致）：
 * - 从 role === "RootWebArea" 的节点开始深度遍历
 * - 为「可交互角色」或「有 name」的元素分配递增 uid（uid1, uid2, …）
 * - backendDOMNodeId 有效（存在且非 -1）时记入 uidMap，selector = `#<backendNodeId>`
 * - ignored 节点跳过
 *
 * @returns lines 缩进文本行；uidMap uid → {selector, role, name}
 */
export function buildSnapshot(nodes: AxNode[]): {
	lines: string[];
	uidMap: Map<string, UidEntry>;
} {
	const lines: string[] = [];
	const uidMap = new Map<string, UidEntry>();
	let counter = 1;

	function processNode(node: AxNode, depth: number): void {
		if (node.ignored) return;

		const role = node.role?.value || "unknown";
		const name = node.name?.value || "";
		const value = node.value?.value;

		let uid = "";
		if (INTERACTIVE_ROLES.includes(role) || name) {
			uid = `uid${counter++}`;
			const backendNodeId = node.backendDOMNodeId;
			if (backendNodeId && backendNodeId !== -1) {
				uidMap.set(uid, { selector: `#${backendNodeId}`, role, name });
			}
		}

		const indent = "  ".repeat(depth);
		const valueStr = value ? ` value="${value}"` : "";
		const uidStr = uid ? ` [${uid}]` : "";
		lines.push(`${indent}${role}${name ? ` "${name}"` : ""}${valueStr}${uidStr}`);

		if (node.childIds) {
			for (const childId of node.childIds) {
				const childNode = nodes.find((n) => n.nodeId === childId);
				if (childNode) {
					processNode(childNode, depth + 1);
				}
			}
		}
	}

	const rootNode = nodes.find((n) => n.role?.value === "RootWebArea");
	if (rootNode) {
		processNode(rootNode, 0);
	}

	return { lines, uidMap };
}
