// 通用模态骨架（重构 Step 4）：消除各 picker/fileViewer 重复的 fixed inset-0 结构。
interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 内容容器额外 class（宽度/高度/布局） */
  bodyClass?: string;
}

export function Modal({ open, onClose, children, bodyClass }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className={bodyClass ?? "w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-2"} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
