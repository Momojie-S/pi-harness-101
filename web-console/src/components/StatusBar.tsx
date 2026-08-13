// 状态栏：显示当前模型 + context 占用 + 扩展状态（输入框上方）。
// PC（lg+）完整展示；移动端折叠为紧凑视图，扩展状态自动换行。
// 设计依据：docs/design/modules/status-bar.md
import type { ContextUsagePayload, ModelIdentity } from "../types.ts";

interface StatusBarProps {
  model: ModelIdentity | null;
  contextUsage: ContextUsagePayload | null;
  extensionStatuses: Record<string, string>;
  streaming: boolean;
  onModelClick: () => void;
}

/** 格式化 token 数：千位为 K，百万为 M */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function StatusBar({ model, contextUsage, extensionStatuses, streaming, onModelClick }: StatusBarProps) {
  const modelName = model?.name || "未选择模型";
  const providerTag = model ? `${model.provider}/${model.id}` : "";
  const percent = contextUsage?.percent ?? null;
  const tokens = contextUsage?.tokens ?? null;
  const window = contextUsage?.contextWindow ?? 0;

  // 进度条颜色：< 70% 绿 / 70-90% 黄 / > 90% 红
  const barColor = percent == null ? "bg-fg-disabled" : percent >= 90 ? "bg-danger" : percent >= 70 ? "bg-warn" : "bg-ok";

  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs text-fg-tertiary">
      {/* 模型：点击触发 ModelPicker */}
      <button
        onClick={onModelClick}
        className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-2"
        title={providerTag}
      >
        {model && <span className="text-fg-disabled">{model.provider}</span>}
        <span className="text-fg-secondary">{modelName}</span>
        <span className="text-fg-disabled">▾</span>
      </button>

      {/* 分隔点 */}
      <span className="text-fg-disabled">·</span>

      {/* Context 占用 */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* 进度条：移动端窄，PC 端宽 */}
        <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:w-24">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: percent != null ? `${Math.min(percent, 100)}%` : "0%" }}
          />
        </div>

        {/* 数值文本：移动端只显示百分比，PC 端显示 used/window */}
        {percent != null ? (
          <>
            <span className="shrink-0 tabular-nums text-fg-secondary">{Math.round(percent)}%</span>
            <span className="hidden shrink-0 tabular-nums text-fg-tertiary sm:inline">
              {tokens != null ? fmtTokens(tokens) : "?"} / {window > 0 ? fmtTokens(window) : "?"}
            </span>
          </>
        ) : (
          <span className="shrink-0 text-fg-disabled">
            {streaming ? "计算中…" : "上下文就绪"}
          </span>
        )}
      </div>

      {/* 扩展状态（generic：不关心是哪个扩展，key 只作 React key + title 提示）
          过滤 model-display：web-console StatusBar 已有模型显示，model-status 扩展重复 */}
      {Object.entries(extensionStatuses)
        .filter(([key]) => key !== "model-display")
        .map(([key, text]) => (
          <span
            key={key}
            title={key}
            className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-fg-secondary"
          >
            {text}
          </span>
        ))}
    </div>
  );
}
