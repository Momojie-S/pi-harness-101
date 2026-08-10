/**
 * buildSnapshot 单元测试：uid 分配、文本格式化、uidMap 构建。
 *
 * 构造假 a11y tree（不依赖 CDP），断言纯函数输出。
 * 运行：cd extensions/chrome-devtools && npm test
 */
import { describe, it, expect } from "vitest";
import { buildSnapshot, type AxNode } from "../src/snapshot";

/** 便捷：构造节点。 */
function n(partial: Partial<AxNode> & { nodeId: string }): AxNode {
	return partial;
}

describe("buildSnapshot", () => {
	it("无 RootWebArea 时输出空", () => {
		const nodes = [n({ nodeId: "1", role: { value: "button" }, name: { value: "X" }, backendDOMNodeId: 1 })];
		const { lines, uidMap } = buildSnapshot(nodes);
		expect(lines).toEqual([]);
		expect(uidMap.size).toBe(0);
	});

	it("为可交互元素分配 uid 并记入 uidMap（selector=#backendNodeId）", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, backendDOMNodeId: -1, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "button" }, name: { value: "Submit" }, backendDOMNodeId: 42, childIds: [] }),
		];
		const { lines, uidMap } = buildSnapshot(nodes);
		expect(lines).toEqual(['RootWebArea "Page" [uid1]', '  button "Submit" [uid2]']);
		expect(uidMap.get("uid2")).toEqual({ selector: "#42", role: "button", name: "Submit" });
	});

	it("有 name 的非可交互元素也分配 uid", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "group" }, name: { value: "G" }, backendDOMNodeId: 5, childIds: [] }),
		];
		const { uidMap } = buildSnapshot(nodes);
		// group 非可交互，但有 name → 仍分配 uid
		expect(uidMap.get("uid2")).toEqual({ selector: "#5", role: "group", name: "G" });
	});

	it("无可交互角色且无 name 的元素不分配 uid", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "generic" }, backendDOMNodeId: 9, childIds: [] }),
		];
		const { lines, uidMap } = buildSnapshot(nodes);
		// generic 无 name、非可交互 → 不进 uidMap，行内也无 [uid]
		expect(uidMap.size).toBe(0);
		expect(lines[1]).toBe("  generic");
	});

	it("backendDOMNodeId 为 -1 时不记入 uidMap（但文本仍带 uid）", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, backendDOMNodeId: -1, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "button" }, name: { value: "B" }, backendDOMNodeId: -1, childIds: [] }),
		];
		const { lines, uidMap } = buildSnapshot(nodes);
		// 文本里有 uid，但 uidMap 为空（backendNodeId 都无效）
		expect(lines[1]).toContain("[uid2]");
		expect(uidMap.size).toBe(0);
	});

	it("backendDOMNodeId 缺失时不记入 uidMap", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "button" }, name: { value: "B" }, childIds: [] }),
		];
		const { uidMap } = buildSnapshot(nodes);
		expect(uidMap.size).toBe(0);
	});

	it("ignored 节点被跳过", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", ignored: true, role: { value: "button" }, name: { value: "X" }, backendDOMNodeId: 7, childIds: [] }),
		];
		const { lines, uidMap } = buildSnapshot(nodes);
		expect(lines).toEqual(['RootWebArea "P" [uid1]']);
		expect(uidMap.size).toBe(0);
	});

	it("渲染 value 字段", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "textbox" }, name: { value: "Email" }, value: { value: "a@b.com" }, backendDOMNodeId: 9, childIds: [] }),
		];
		const { lines } = buildSnapshot(nodes);
		expect(lines[1]).toBe('  textbox "Email" value="a@b.com" [uid2]');
	});

	it("多层嵌套按深度缩进", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", role: { value: "group" }, name: { value: "G" }, backendDOMNodeId: 2, childIds: ["3"] }),
			n({ nodeId: "3", role: { value: "link" }, name: { value: "Go" }, backendDOMNodeId: 3, childIds: [] }),
		];
		const { lines } = buildSnapshot(nodes);
		expect(lines).toEqual([
			'RootWebArea "P" [uid1]',
			'  group "G" [uid2]',
			'    link "Go" [uid3]',
		]);
	});

	it("uid 在多个元素间连续递增", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, backendDOMNodeId: -1, childIds: ["2", "3"] }),
			n({ nodeId: "2", role: { value: "button" }, name: { value: "A" }, backendDOMNodeId: 10, childIds: [] }),
			n({ nodeId: "3", role: { value: "link" }, name: { value: "B" }, backendDOMNodeId: 11, childIds: [] }),
		];
		const { uidMap } = buildSnapshot(nodes);
		expect([...uidMap.keys()]).toEqual(["uid2", "uid3"]);
		expect(uidMap.get("uid2")!.selector).toBe("#10");
		expect(uidMap.get("uid3")!.selector).toBe("#11");
	});

	it("role 缺失时显示为 unknown", () => {
		const nodes = [
			n({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "P" }, childIds: ["2"] }),
			n({ nodeId: "2", name: { value: "Thing" }, backendDOMNodeId: 1, childIds: [] }),
		];
		const { lines } = buildSnapshot(nodes);
		// 无 role → "unknown"，但有 name → 分配 uid
		expect(lines[1]).toBe('  unknown "Thing" [uid2]');
	});
});
