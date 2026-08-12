// 文件查看模态（重构 Step 4）
import { Modal } from "./Modal.tsx";

interface FileViewerProps {
  fileViewer: { path: string; content: string } | null;
  onClose: () => void;
}

export function FileViewer({ fileViewer, onClose }: FileViewerProps) {
  return (
    <Modal open={!!fileViewer} onClose={onClose} bodyClass="flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border-strong bg-surface-elevated shadow-lg">
      {fileViewer && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="truncate font-mono text-xs text-fg-secondary">{fileViewer.path}</span>
            <button onClick={onClose} className="text-fg-tertiary hover:text-fg">✕ 关闭</button>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-fg"><code>{fileViewer.content}</code></pre>
        </>
      )}
    </Modal>
  );
}
