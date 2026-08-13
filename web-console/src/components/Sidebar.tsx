// 侧边栏（重构 Step 5）：工作目录 + 会话列表 + 目录树 + 主题切换
// PC（lg+）：inline 侧边栏（hidden lg:block）
// 移动端：overlay 抽屉（sidebarOpen 控制，lg:hidden）
import { FileTree } from "./FileTree.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { getSummary, groupByCwd } from "../lib/sessionUtils.ts";
import type { Theme } from "../hooks/useTheme.ts";
import type { SessionInfo, SessionState } from "../types.ts";

interface SidebarProps {
  dirs: string[];
  recentDirs: string[];
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
  activeSessionId: string | null;
  active: SessionState | null;
  sidebarOpen: boolean;
  onSelectSession: (sid: string) => void;
  onCloseSession: (sid: string) => void;
  onToggleDir: (dir: string) => void;
  onLoadDirSessions: (cwd: string) => void;
  onOpenFile: (p: string) => void;
  onOpenDirBrowser: () => void;
  dirSessions: { cwd: string; list: SessionInfo[]; loading: boolean; visible: number } | null;
  onLoadMoreDirSessions: () => void;
  onSelectHistoryInDir: (path: string) => void;
  onNewSessionInDir: () => void;
  openingSession: { cwd: string; path: string } | null;
  onCloseSidebar: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

function SidebarContent({ dirs, recentDirs, sessions, sessionOrder, activeSessionId, active, onSelectSession, onCloseSession, onToggleDir, onLoadDirSessions, onOpenFile, onOpenDirBrowser, dirSessions, onLoadMoreDirSessions, onSelectHistoryInDir, onNewSessionInDir, openingSession, theme, onToggleTheme }: Omit<SidebarProps, "sidebarOpen" | "onCloseSidebar">) {
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-fg-secondary">工作目录</h2>
      <button onClick={onOpenDirBrowser} className="mb-2 flex w-full items-center gap-1.5 rounded-md border border-strong bg-surface px-2 py-1.5 text-xs text-fg-secondary hover:bg-surface-2">
        📁 选择目录
      </button>
      <div className="space-y-1">
        {dirs.map((d) => {
          const name = d.split(/[\\/]/).pop() ?? d;
          return (
            <button key={`d-${d}`} onClick={() => onLoadDirSessions(d)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-2" title={`查看 ${d} 的会话`}>
              📁 {name}
            </button>
          );
        })}
        {recentDirs.length > 0 && (
          <>
            <p className="px-2 pt-2 text-[10px] uppercase tracking-wide text-fg-tertiary">最近打开</p>
            {recentDirs.map((d) => {
              const name = d.split(/[\\/]/).pop() ?? d;
              return (
                <button key={`r-${d}`} onClick={() => onLoadDirSessions(d)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-2" title={d}>
                  📁 {name}
                </button>
              );
            })}
          </>
        )}
        {dirs.length === 0 && recentDirs.length === 0 && (
          <p className="text-xs text-fg-tertiary">点击上方选择目录</p>
        )}
      </div>

      {dirSessions && (
        <div className="mt-4">
          <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-fg-secondary">
            <span className="truncate">{dirSessions.cwd.split(/[\\/]/).pop() ?? dirSessions.cwd}</span>
            <span className="font-normal text-fg-tertiary">的对话</span>
          </h2>
          <button onClick={onNewSessionInDir} disabled={!!openingSession} className={`mb-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium ${openingSession && !openingSession.path ? "cursor-wait bg-accent/5 text-fg-tertiary" : "bg-accent/10 text-accent hover:bg-accent/20"}`}>
            {openingSession && !openingSession.path ? "⏳ 创建中…" : "＋ 新建会话"}
          </button>
          {dirSessions.loading ? (
            <p className="px-2 py-3 text-xs text-fg-tertiary">加载中…</p>
          ) : dirSessions.list.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-tertiary">还没有对话</p>
          ) : (
            <div
              className="max-h-[40vh] space-y-0.5 overflow-y-auto lg:max-h-[35vh]"
              onScroll={(e) => {
                if (dirSessions.visible >= dirSessions.list.length) return;
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) onLoadMoreDirSessions();
              }}
            >
              {dirSessions.list.slice(0, dirSessions.visible).map((s) => {
                const isOpening = openingSession?.path === s.path;
                const anyOpening = !!openingSession;
                return (
                  <button
                    key={s.path}
                    onClick={() => onSelectHistoryInDir(s.path)}
                    disabled={anyOpening}
                    className={`block w-full rounded-md px-2 py-1.5 text-left ${anyOpening ? "cursor-wait" : "hover:bg-surface-2"} ${isOpening ? "opacity-60" : ""}`}
                    title={s.path}
                  >
                    <div className="truncate text-xs text-fg">{isOpening ? "⏳ 打开中…" : (s.firstMessage || s.name || "（无内容）")}</div>
                    <div className="text-[10px] text-fg-tertiary">{new Date(s.modified).toLocaleDateString()} · {s.messageCount} 条</div>
                  </button>
                );
              })}
              {dirSessions.visible < dirSessions.list.length && (
                <p className="py-2 text-center text-[10px] text-fg-tertiary">↓ 滚动加载更多</p>
              )}
            </div>
          )}
        </div>
      )}

      {(sessionOrder.length > 0 || !dirSessions) && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-secondary">{dirSessions ? "打开的会话" : "会话"}</h2>
          {sessionOrder.length === 0 ? (
            <p className="text-xs text-fg-tertiary">点击上方选择目录</p>
          ) : (
            <div className="space-y-3">
              {/* 多目录按 cwd 分组（sessionUtils.groupByCwd）：组标题 = 目录名 + 数量，组内会话显示简述（首条用户消息） */}
              {groupByCwd(sessionOrder, sessions).map((g) => (
                <div key={g.cwd}>
                  <div className="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-fg-secondary">
                    <span className="shrink-0">📁</span>
                    <span className="min-w-0 flex-1 truncate" title={g.cwd}>{g.dirName}</span>
                    <span className="shrink-0 text-fg-disabled">{g.sessionIds.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {g.sessionIds.map((sid) => {
                      const s = sessions[sid];
                      const summary = s ? (getSummary(s.messages) || s.summary || "") : "";
                      const isActive = sid === activeSessionId;
                      return (
                        <div key={sid} className={`flex items-center rounded-md px-2 py-1.5 text-xs ${isActive ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-2"}`}>
                          <button onClick={() => onSelectSession(sid)} className="min-w-0 flex-1 truncate text-left" title={s?.cwd}>
                            <span className={s?.streaming ? "text-warn" : ""}>{s?.streaming ? "● " : ""}{summary || "新会话"}</span>
                          </button>
                          <button onClick={() => onCloseSession(sid)} className="ml-1 shrink-0 text-fg-tertiary hover:text-danger">✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-secondary">目录树</h2>
          <div className="max-h-[45vh] overflow-y-auto">
            <FileTree root={active.cwd} contents={active.dirContents} expanded={active.expandedDirs} onToggle={onToggleDir} onOpenFile={onOpenFile} />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t pt-3">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <span className="text-xs text-fg-tertiary">主题</span>
      </div>
    </>
  );
}

export function Sidebar({ dirs, recentDirs, sessions, sessionOrder, activeSessionId, active, sidebarOpen, onSelectSession, onCloseSession, onToggleDir, onLoadDirSessions, onOpenFile, onOpenDirBrowser, dirSessions, onLoadMoreDirSessions, onSelectHistoryInDir, onNewSessionInDir, openingSession, onCloseSidebar, theme, onToggleTheme }: SidebarProps) {
  const contentProps = { dirs, recentDirs, sessions, sessionOrder, activeSessionId, active, onSelectSession, onCloseSession, onToggleDir, onLoadDirSessions, onOpenFile, onOpenDirBrowser, dirSessions, onLoadMoreDirSessions, onSelectHistoryInDir, onNewSessionInDir, openingSession, theme, onToggleTheme };

  return (
    <>
      {/* PC 端 inline 侧边栏：lg:overflow-y-auto 让内容溢出时侧边栏内部滚动，而非撑破文档导致页面级滚动 + 输入框被推离底部（详见 docs/design/modules/layout.md 铁律②） */}
      <aside className="hidden border-r p-4 lg:block lg:w-64 lg:shrink-0 lg:overflow-y-auto">
        <SidebarContent {...contentProps} />
      </aside>

      {/* 移动端：overlay 抽屉（始终在 DOM，translate/opacity 控制显隐 + 过渡动画） */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? "" : "pointer-events-none"}`} aria-hidden={!sidebarOpen}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onClick={onCloseSidebar}
        />
        <aside className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r bg-surface-elevated p-4 pt-safe shadow-lg transition-transform duration-200 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <button onClick={onCloseSidebar} className="mb-2 ml-auto block text-fg-tertiary hover:text-fg" aria-label="关闭">✕</button>
          <SidebarContent {...contentProps} />
        </aside>
      </div>
    </>
  );
}
