// 命令补全浮层（重构 Step 5）：纯受控组件，不管焦点/不持状态。
interface CommandItem {
  name: string;
  description?: string;
  builtin?: string;
}

interface CommandPaletteProps {
  cmds: CommandItem[];
  cmdIndex: number;
  onSelect: (cmd: CommandItem) => void;
}

export function CommandPalette({ cmds, cmdIndex, onSelect }: CommandPaletteProps) {
  if (cmds.length === 0) return null;
  return (
    <div className="absolute bottom-full left-3 right-3 mb-1 max-h-60 overflow-auto rounded-lg border-strong bg-surface-elevated py-1 text-sm shadow-lg">
      {cmds.map((c, i) => (
        <button key={c.name} onClick={() => onSelect(c)} className={`block w-full px-3 py-1.5 text-left ${i === cmdIndex ? "bg-surface-2" : "hover:bg-surface-2"}`}>
          <span className="font-mono text-accent">/{c.name}</span>
          {c.description && <span className="ml-2 text-xs text-fg-tertiary">{c.description}</span>}
        </button>
      ))}
    </div>
  );
}
