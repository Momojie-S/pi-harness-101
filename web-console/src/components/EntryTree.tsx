import type { EntryTreeNode } from "../../server/types.ts";

// 递归渲染会话 entry 树（/tree /fork 选点用）
interface Props {
  nodes: EntryTreeNode[];
  leafId: string | null;
  depth?: number;
  onSelect: (entryId: string) => void;
}

export function EntryTree({ nodes, leafId, depth = 0, onSelect }: Props) {
  return (
    <>
      {nodes.map((n) => {
        const isLeaf = n.id === leafId;
        return (
          <div key={n.id}>
            <button
              onClick={() => onSelect(n.id)}
              className={`flex w-full items-start gap-1.5 rounded py-1 text-left text-xs ${isLeaf ? "font-medium text-ok" : "text-fg-secondary hover:bg-surface-2"}`}
              style={{ paddingLeft: depth * 14 + 8 }}
            >
              <span className="mt-0.5 shrink-0">{isLeaf ? "●" : "○"}</span>
              <span className="truncate">{n.summary || "(空)"}</span>
            </button>
            {n.children.length > 0 && (
              <EntryTree nodes={n.children} leafId={leafId} depth={depth + 1} onSelect={onSelect} />
            )}
          </div>
        );
      })}
    </>
  );
}
