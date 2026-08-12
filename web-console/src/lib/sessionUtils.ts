// 会话工具函数（纯函数，供侧边栏等视图复用）。
import type { ChatMessage } from "../types.ts";

/** content block 的最小形状（与 MessageView.tsx 的 TextBlock 一致） */
interface MaybeTextBlock { type?: string; text?: string }

/**
 * 提取会话简述：首条 user 消息的文本内容。
 * 与 server 端 `SessionManager.buildSessionInfo` 的 firstMessage 同口径
 * （取第一条 role==="user" 的文本，跳过空内容）。
 *
 * 用途：侧边栏「打开的会话」列表项展示，让用户一眼看出每个会话在干什么。
 */
export function getSummary(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue; // 跳过 system-error / assistant / toolResult
    const content = m.content;
    const text = typeof content === "string"
      ? content
      : (Array.isArray(content) ? content : [])
          .map((b: MaybeTextBlock) => (b && typeof b.text === "string" ? b.text : ""))
          .join("");
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export interface SessionGroup {
  cwd: string;
  /** 目录名（cwd 末段），用作分组标题 */
  dirName: string;
  sessionIds: string[];
}

/**
 * 按 cwd 分组打开的会话。
 * - 组内保持 sessionOrder 原顺序（= 打开时间序）
 * - 组按「该目录首个会话的打开顺序」排列
 *
 * 用途：多目录同时工作时，侧边栏按目录归拢会话，结构清晰、定位快。
 */
export function groupByCwd<S extends { cwd: string }>(
  sessionOrder: string[],
  sessions: Record<string, S>,
): SessionGroup[] {
  const map = new Map<string, string[]>();
  for (const sid of sessionOrder) {
    const s = sessions[sid];
    if (!s) continue;
    const list = map.get(s.cwd);
    if (list) list.push(sid);
    else map.set(s.cwd, [sid]);
  }
  return Array.from(map.entries()).map(([cwd, sessionIds]) => ({
    cwd,
    dirName: cwd.split(/[\\/]/).pop() ?? cwd,
    sessionIds,
  }));
}
