// 历史会话选择模态（重构 Step 4）
import { Modal } from "./Modal.tsx";
import type { SessionInfo } from "../../types.ts";

interface SessionPickerProps {
  open: boolean;
  sessions: SessionInfo[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function SessionPicker({ open, sessions, onSelect, onClose }: SessionPickerProps) {
  return (
    <Modal open={open} onClose={onClose} bodyClass="max-h-[70vh] w-full max-w-lg overflow-auto rounded-lg border-strong bg-surface-elevated p-2 shadow-lg">
      <div className="px-2 py-1 text-xs text-fg-tertiary">历史会话（点击打开）</div>
      {sessions.length === 0 && <div className="px-2 py-2 text-sm text-fg-tertiary">（无）</div>}
      {sessions.map((s) => (
        <button key={s.path} onClick={() => onSelect(s.path)} className="block w-full rounded px-2 py-2 text-left hover:bg-surface-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">{s.name || s.firstMessage.slice(0, 40) || "(无标题)"}</span>
            <span className="text-xs text-fg-tertiary">{new Date(s.modified).toLocaleDateString()}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-tertiary">{s.messageCount} 条 · {s.firstMessage.slice(0, 50)}</div>
        </button>
      ))}
    </Modal>
  );
}
