// 会话 entry 树节点（/tree /fork 用）
export interface EntryTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  summary: string;
  timestamp: number;
  children: EntryTreeNode[];
}

// 前端 → 后端（多会话：操作都带 sessionId 指定目标会话）
export type ClientMessage =
  | { type: "list_dirs" }
  | { type: "open_session"; cwd: string; sessionId?: string }
  | { type: "close_session"; sessionId: string }
  | { type: "prompt"; sessionId: string; message: string }
  | { type: "steer"; sessionId: string; message: string }
  | { type: "follow_up"; sessionId: string; message: string }
  | { type: "abort"; sessionId: string }
  | { type: "read_file"; sessionId: string; path: string }
  | { type: "list_dir"; sessionId: string; path?: string }
  | { type: "list_commands"; sessionId: string }
  | { type: "list_models"; sessionId: string }
  | { type: "set_model"; sessionId: string; provider: string; modelId: string }
  | { type: "compact"; sessionId: string }
  | { type: "set_thinking"; sessionId: string; level: string }
  | { type: "list_sessions"; cwd: string }
  | { type: "open_history"; cwd: string; path: string }
  | { type: "list_entries"; sessionId: string }
  | { type: "navigate"; sessionId: string; targetId: string }
  | { type: "fork"; sessionId: string; entryId: string };

// 后端 → 前端
export type ServerMessage =
  | { type: "dirs"; dirs: string[] }
  | { type: "session_opened"; sessionId: string; cwd: string; messages: unknown[] }
  | { type: "session_closed"; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: unknown }
  | { type: "file_content"; path: string; content: string }
  | { type: "dir_content"; sessionId: string; path: string; entries: { name: string; type: "file" | "dir"; path: string }[] }
  | { type: "commands"; sessionId: string; commands: { name: string; description?: string }[] }
  | { type: "models"; sessionId: string; models: { provider: string; id: string; name: string }[] }
  | { type: "model_changed"; sessionId: string; provider: string; modelId: string; name: string }
  | { type: "thinking_changed"; sessionId: string; level: string }
  | { type: "sessions_list"; cwd: string; sessions: { path: string; name?: string; modified: string; messageCount: number; firstMessage: string }[] }
  | { type: "entries_tree"; sessionId: string; tree: EntryTreeNode[]; leafId: string | null }
  | { type: "error"; message: string; sessionId?: string };
