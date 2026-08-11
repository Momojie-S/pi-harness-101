// 前端类型定义（重构 Step 1：从 App.tsx / server/types.ts 提取）。
// 共享契约（EntryTreeNode / ClientMessage / ServerMessage）见 server/types.ts，不在此重复定义；
// SDK 类型（AgentMessage / AgentSessionEvent）从各自包 import 并 re-export，作为前端单一 import 来源。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// 重新导出，让 App.tsx / 后续 hooks 只从 "./types.ts" 取类型
export type { AgentMessage, AgentSessionEvent };

// —— 前端专用类型（视图模型 / 前端状态）——

/** 工具执行卡片（前端视图模型，status 是前端态） */
export interface ToolInfo {
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  output: string;
}

/** 目录条目（与 server/types.ts 的 dir_content.entries 结构一致） */
export interface DirEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}

/** 命令补全项（与 server/types.ts 的 commands.commands 一致） */
export interface CommandInfo {
  name: string;
  description?: string;
}

/**
 * 模型信息（与 server/types.ts 的 models.models 一致）。
 * 注意：不是 SDK 的 ModelInfo（后者字段为 contextWindow/reasoning，无 name）。
 */
export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

/** 历史会话摘要（与 server/types.ts 的 sessions_list.sessions 一致） */
export interface SessionInfo {
  path: string;
  name?: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

/** 单个会话的全部前端状态 */
export interface SessionState {
  cwd: string;
  messages: AgentMessage[];
  streamText: string;
  streaming: boolean;
  tools: Record<string, ToolInfo>;
  patches: Record<string, string>;
  dirContents: Record<string, DirEntry[]>;
  expandedDirs: Set<string>;
  error: string | null;
  commands: CommandInfo[];
}
