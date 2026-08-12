// 目录浏览选择器（ADR-009 规划的 browse_dir）：逐级浏览文件系统选目录建会话。
// 与 list_dir 不同：不绑定会话、用 isUnderRoots 越界检查、只列目录（过滤隐藏目录）。
import { Modal } from "./Modal.tsx";

interface DirBrowserState { path: string; parent: string | null; dirs: { name: string; path: string }[] }

interface DirBrowserProps {
  state: DirBrowserState | null;
  onBrowse: (path: string) => void;
  onSelect: (cwd: string) => void;
  onClose: () => void;
}

export function DirBrowser({ state, onBrowse, onSelect, onClose }: DirBrowserProps) {
  return (
    <Modal open={!!state} onClose={onClose} bodyClass="flex h-[70vh] w-full max-w-lg flex-col rounded-lg border-strong bg-surface-elevated shadow-lg">
      {state && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium text-fg">选择工作目录</span>
            <button onClick={onClose} className="text-fg-tertiary hover:text-fg" aria-label="关闭">✕</button>
          </div>
          {/* 当前路径 + 上级 */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <button
              onClick={() => state.parent !== null && onBrowse(state.parent)}
              disabled={state.parent === null}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg-secondary hover:bg-surface-2 disabled:opacity-30"
              title="上级目录"
              aria-label="上级目录"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary" title={state.path}>{state.path === "" ? (state.dirs.length ? "此电脑" : "加载中…") : state.path}</span>
          </div>
          {/* 目录列表 */}
          <div className="flex-1 overflow-auto p-2">
            {state.dirs.length === 0 && state.path === "" ? (
              <div className="px-2 py-3 text-sm text-fg-tertiary">加载中…</div>
            ) : state.dirs.length === 0 ? (
              <div className="px-2 py-3 text-sm text-fg-tertiary">（无子目录）</div>
            ) : (
              state.dirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => onBrowse(d.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-fg hover:bg-surface-2"
                  title={d.path}
                >
                  <span>📁</span>
                  <span className="truncate">{d.name}</span>
                </button>
              ))
            )}
          </div>
          {/* 选择当前目录建会话 */}
          <div className="border-t p-3">
            <button
              onClick={() => onSelect(state.path)}
              disabled={!state.path}
              className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-40"
            >
              选择此目录
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
