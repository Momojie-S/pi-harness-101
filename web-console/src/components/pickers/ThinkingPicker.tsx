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
    <Modal open={open} onClose={onClose} bodyClass="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 p-2">
      <div className="px-2 py-1 text-xs text-slate-500">思考强度</div>
      {LEVELS.map((lvl) => (
        <button key={lvl} onClick={() => onSelect(lvl)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800">{lvl}</button>
      ))}
    </Modal>
  );
}
