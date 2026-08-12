// 思考强度选择模态（重构 Step 4）
import { Modal } from "./Modal.tsx";

interface ThinkingPickerProps {
  open: boolean;
  onSelect: (level: string) => void;
  onClose: () => void;
}

const LEVELS = ["off", "minimal", "low", "medium", "high"];

export function ThinkingPicker({ open, onSelect, onClose }: ThinkingPickerProps) {
  return (
    <Modal open={open} onClose={onClose} bodyClass="w-full max-w-xs rounded-lg border-strong bg-surface-elevated p-2 shadow-lg">
      <div className="px-2 py-1 text-xs text-fg-tertiary">思考强度</div>
      {LEVELS.map((lvl) => (
        <button key={lvl} onClick={() => onSelect(lvl)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2">{lvl}</button>
      ))}
    </Modal>
  );
}
