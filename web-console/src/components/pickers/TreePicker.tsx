// 会话树导航/分叉模态（重构 Step 4）
import { Modal } from "./Modal.tsx";
import { EntryTree } from "../EntryTree.tsx";
import type { EntryTreeNode } from "../../../server/types.ts";

interface TreePickerProps {
  open: boolean;
  mode: "navigate" | "fork";
  tree: EntryTreeNode[];
  leafId: string | null;
  onSelect: (entryId: string) => void;
  onClose: () => void;
}

export function TreePicker({ open, mode, tree, leafId, onSelect, onClose }: TreePickerProps) {
  return (
    <Modal open={open} onClose={onClose} bodyClass="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border-strong bg-surface-elevated shadow-lg">
      <div className="border-b px-4 py-2 text-xs text-fg-secondary">
        {mode === "navigate" ? "导航到历史节点（原地继续）" : "从历史节点分叉新会话"} · 点击选择
      </div>
      <div className="flex-1 overflow-auto p-2">
        {tree.length === 0 ? (
          <div className="px-2 py-2 text-sm text-fg-tertiary">加载中…</div>
        ) : (
          <EntryTree nodes={tree} leafId={leafId} onSelect={onSelect} />
        )}
      </div>
    </Modal>
  );
}
