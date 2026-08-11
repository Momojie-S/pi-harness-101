// 模型选择模态（重构 Step 4）
import { Modal } from "./Modal.tsx";
import type { ModelInfo } from "../../types.ts";

interface ModelPickerProps {
  open: boolean;
  models: ModelInfo[];
  onSelect: (provider: string, modelId: string) => void;
  onClose: () => void;
}

export function ModelPicker({ open, models, onSelect, onClose }: ModelPickerProps) {
  return (
    <Modal open={open} onClose={onClose} bodyClass="max-h-[70vh] w-full max-w-md overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-2">
      <div className="px-2 py-1 text-xs text-slate-500">选择模型</div>
      {models.map((m) => (
        <button key={m.provider + m.id} onClick={() => onSelect(m.provider, m.id)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800">
          <span className="text-slate-200">{m.name}</span>
          <span className="ml-2 text-xs text-slate-500">{m.provider}/{m.id}</span>
        </button>
      ))}
    </Modal>
  );
}
