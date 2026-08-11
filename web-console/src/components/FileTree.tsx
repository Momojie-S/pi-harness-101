// 递归目录树组件（懒加载：点文件夹才请求子目录内容）
import type { DirEntry } from "../types.ts";

interface FileTreeProps {
  root: string;
  contents: Record<string, DirEntry[]>;
  expanded: Set<string>;
  onToggle: (dir: string) => void;
  onOpenFile: (path: string) => void;
}

export function FileTree(props: FileTreeProps) {
  return <Nodes dirPath={props.root} depth={0} {...props} />;
}

function Nodes({
  dirPath,
  depth,
  contents,
  expanded,
  onToggle,
  onOpenFile,
}: { dirPath: string; depth: number } & Omit<FileTreeProps, "root">) {
  const entries = contents[dirPath];
  if (!entries) {
    return (
      <div className="py-0.5 text-xs text-slate-600" style={{ paddingLeft: depth * 12 + 8 }}>
        加载中…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="py-0.5 text-xs text-slate-600" style={{ paddingLeft: depth * 12 + 8 }}>
        （空）
      </div>
    );
  }
  return (
    <>
      {entries.map((e) => {
        const isOpen = expanded.has(e.path);
        return (
          <div key={e.path}>
            {e.type === "dir" ? (
              <>
                <button
                  onClick={() => onToggle(e.path)}
                  className="flex w-full items-center gap-1 rounded py-0.5 text-left text-xs text-slate-300 hover:bg-slate-800"
                  style={{ paddingLeft: depth * 12 + 8 }}
                >
                  <span>{isOpen ? "📂" : "📁"}</span>
                  <span className="truncate">{e.name}</span>
                </button>
                {isOpen && (
                  <Nodes
                    dirPath={e.path}
                    depth={depth + 1}
                    contents={contents}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpenFile={onOpenFile}
                  />
                )}
              </>
            ) : (
              <button
                onClick={() => onOpenFile(e.path)}
                className="flex w-full items-center gap-1 rounded py-0.5 text-left text-xs text-slate-400 hover:bg-slate-800"
                style={{ paddingLeft: depth * 12 + 8 }}
              >
                <span>📄</span>
                <span className="truncate">{e.name}</span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
