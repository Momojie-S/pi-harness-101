// 前端类型定义（重构 Step 1：从 App.tsx / server/types.ts 提取）。
// 共享契约（EntryTreeNode / ClientMessage / ServerMessage）见 server/types.ts，不在此重复定义；
// SDK 类型（AgentMessage / AgentSessionEvent）从各自包 import 并 re-export，作为前端单一 import 来源。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ContextUsagePayload, ModelIdentity } from "../server/types.ts";

// 重新导出，让 App.tsx / 后续 hooks 只从 "./types.ts" 取类型
export type { AgentMessage, AgentSessionEvent };

/** 前端视图层：系统错误消息（非 SDK 消息，仅前端渲染用，不回传后端） */
export interface SystemErrorMessage {
  role: "system-error";
  content: string;
  timestamp: number;
}

/** 前端消息列表项（SDK 真实消息 + 前端系统消息） */
export type ChatMessage = AgentMessage | SystemErrorMessage;
export type { ModelIdentity, ContextUsagePayload };

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
  /** 会话文件路径（session_opened 携带；用于判断历史会话是否已打开，避免重复 open_history） */
  sessionFile: string | undefined;
  /** 完整消息总数（分页：用于判断是否还有更早的历史可加载） */
  messageTotal: number;
  /** 当前已加载最早消息在完整列表的索引（分页；0 表示已加载全部历史） */
  messageOffset: number;
  messages: ChatMessage[];
  streamText: string;
  streaming: boolean;
  tools: Record<string, ToolInfo>;
  patches: Record<string, string>;
  dirContents: Record<string, DirEntry[]>;
  expandedDirs: Set<string>;
  /** 正在执行 compact（压缩上下文）；前端显示提示 */
  compacting: boolean;
  /** 大模型限流/API 错误时 SDK 自动重试中 */
  retrying: boolean;
  /** 排队中的补充消息（steer 队列；agent 投递后自动清空） */
  steeringQueue: string[];
  commands: CommandInfo[];
  /** 当前模型（session_opened 携带 / model_changed 更新） */
  model: ModelIdentity | null;
  /** Context 占用（agent_settled 后后端推送） */
  contextUsage: ContextUsagePayload | null;
  /** 刷新后从后端恢复的 session（messages 未加载，点击时 open_session 加载） */
  restored: boolean;
}
