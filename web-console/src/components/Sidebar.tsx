// 侧边栏（重构 Step 5）：工作目录 + 会话列表 + 目录树
// PC（lg+）：inline 侧边栏（hidden lg:block）
// 移动端：overlay 抽屉（sidebarOpen 控制，lg:hidden）
import { FileTree } from "./FileTree.tsx";
import type { SessionState } from "../types.ts";

interface SidebarProps {
  dirs: string[];
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
  activeSessionId: string | null;
  active: SessionState | null;
  sidebarOpen: boolean;
  onNewSession: (cwd: string) => void;
  onSelectSession: (sid: string) => void;
  onCloseSession: (sid: string) => void;
  onToggleDir: (dir: string) => void;
  onOpenFile: (p: string) => void;
  onCloseSidebar: () => void;
}

function SidebarContent({ dirs, sessions, sessionOrder, activeSessionId, active, onNewSession, onSelectSession, onCloseSession, onToggleDir, onOpenFile }: Omit<SidebarProps, "sidebarOpen" | "onCloseSidebar">) {
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-slate-400">工作目录</h2>
      <div className="space-y-1">
        {dirs.length === 0 && <p className="text-xs text-slate-600">未配置（后端设 ALLOWED_DIRS）</p>}
        {dirs.map((d) => {
          const name = d.split(/[\\/]/).pop() ?? d;
          return (
            <button key={d} onClick={() => onNewSession(d)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800" title={`在 ${d} 新建会话`}>
              ＋ {name}
            </button>
          );
        })}
      </div>

      <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-400">会话</h2>
      <div className="space-y-1">
        {sessionOrder.length === 0 && <p className="text-xs text-slate-600">点击上方目录新建</p>}
        {sessionOrder.map((sid) => {
          const s = sessions[sid];
          const name = s?.cwd.split(/[\\/]/).pop() ?? sid.slice(0, 6);
          const isActive = sid === activeSessionId;
          return (
            <div key={sid} className={`flex items-center rounded-md px-2 py-1.5 text-xs ${isActive ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}>
              <button onClick={() => onSelectSession(sid)} className="flex-1 truncate text-left" title={s?.cwd}>
                <span className={s?.streaming ? "text-amber-400" : ""}>{s?.streaming ? "● " : ""}{name}</span>
              </button>
              <button onClick={() => onCloseSession(sid)} className="ml-1 shrink-0 text-slate-500 hover:text-red-400">✕</button>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-400">目录树</h2>
          <div className="max-h-[45vh] overflow-y-auto">
            <FileTree root={active.cwd} contents={active.dirContents} expanded={active.expandedDirs} onToggle={onToggleDir} onOpenFile={onOpenFile} />
          </div>
        </div>
      )}
    </>
  );
}

export function Sidebar({ dirs, sessions, sessionOrder, activeSessionId, active, sidebarOpen, onNewSession, onSelectSession, onCloseSession, onToggleDir, onOpenFile, onCloseSidebar }: SidebarProps) {
  const contentProps = { dirs, sessions, sessionOrder, activeSessionId, active, onNewSession, onSelectSession, onCloseSession, onToggleDir, onOpenFile };

  return (
    <>
      {/* PC 端：inline 侧边栏 */}
      <aside className="hidden border-r border-slate-800 p-4 lg:block lg:w-64 lg:shrink-0">
        <SidebarContent {...contentProps} />
      </aside>

      {/* 移动端：overlay 抽屉 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/60" onClick={onCloseSidebar} />
          {/* 抽屉 */}
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-slate-800 bg-slate-950 p-4 shadow-2xl">
            {/* 关闭按钮 */}
            <button onClick={onCloseSidebar} className="mb-2 ml-auto block text-slate-500 hover:text-slate-300" aria-label="关闭">✕</button>
            <SidebarContent {...contentProps} />
          </aside>
        </div>
      )}
    </>
  );
}
