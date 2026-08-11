// 状态栏：显示当前模型 + context 占用（输入框上方）。
// PC（lg+）完整展示；移动端折叠为紧凑视图。
// 设计依据：docs/design/modules/status-bar.md
import type { ContextUsagePayload, ModelIdentity } from "../types.ts";

interface StatusBarProps {
  model: ModelIdentity | null;
  contextUsage: ContextUsagePayload | null;
  streaming: boolean;
  onModelClick: () => void;
}

/** 格式化 token 数：千位为 K，百万为 M */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function StatusBar({ model, contextUsage, streaming, onModelClick }: StatusBarProps) {
  const modelName = model?.name || "未选择模型";
  const providerTag = model ? `${model.provider}/${model.id}` : "";
  const percent = contextUsage?.percent ?? null;
  const tokens = contextUsage?.tokens ?? null;
  const window = contextUsage?.contextWindow ?? 0;

  // 进度条颜色：< 70% 绿 / 70-90% 黄 / > 90% 红
  const barColor = percent == null ? "bg-slate-600" : percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 border-t border-slate-800 px-3 py-1.5 text-xs text-slate-400">
      {/* 模型：点击触发 ModelPicker */}
      <button
        onClick={onModelClick}
        className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-slate-800"
        title={providerTag}
      >
        <span className="text-slate-300">{modelName}</span>
        <span className="text-slate-600">▾</span>
      </button>

      {/* 分隔点 */}
      <span className="text-slate-700">·</span>

      {/* Context 占用 */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* 进度条：移动端窄，PC 端宽 */}
        <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-800 sm:w-24">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: percent != null ? `${Math.min(percent, 100)}%` : "0%" }}
          />
        </div>

        {/* 数值文本：移动端只显示百分比，PC 端显示 used/window */}
        {percent != null ? (
          <>
            <span className="shrink-0 tabular-nums text-slate-400">{Math.round(percent)}%</span>
            <span className="hidden shrink-0 tabular-nums text-slate-500 sm:inline">
              {tokens != null ? fmtTokens(tokens) : "?"} / {window > 0 ? fmtTokens(window) : "?"}
            </span>
          </>
        ) : (
          <span className="shrink-0 text-slate-600">
            {streaming ? "计算中…" : "上下文就绪"}
          </span>
        )}
      </div>
    </div>
  );
}
