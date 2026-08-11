// WebSocket hook（重构 Step 3）。
// 职责：连接 + 自动重连 + onMessage→dispatch + 副作用 send（session_opened 补发、tool_end 延迟 drop、重连重订阅）。
// 设计依据：docs/design/modules/frontend-architecture.md §5。
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ClientMessage, ServerMessage } from "../../server/types.ts";
import type { AgentMessage, AgentSessionEvent, DirEntry } from "../types.ts";
import type { Action, AppState } from "../state/sessionReducer.ts";
import { connectWs, type WsClient } from "../lib/wsClient.ts";

export function useWebSocket(
  dispatch: (action: Action) => void,
  stateRef: MutableRefObject<AppState>,
): { send: (msg: ClientMessage) => void } {
  const wsRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const ws = connectWs();
    wsRef.current = ws;

    ws.onOpen(() => {
      dispatch({ type: "clear_global_error" });
      ws.send({ type: "list_dirs" } satisfies ClientMessage);
      // 重连后重新订阅所有活跃会话
      for (const sid of stateRef.current.sessionOrder) {
        const cwd = stateRef.current.sessions[sid]?.cwd;
        if (cwd) ws.send({ type: "open_session", cwd, sessionId: sid } satisfies ClientMessage);
      }
    });
    ws.onMessage((data) => onServerMessage(data as ServerMessage, ws, dispatch));

    return () => ws.close();
    // dispatch 引用稳定（useReducer 返回值），stateRef 同理；effect 只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { send: (msg) => wsRef.current?.send(msg) };
}

// onServer：dispatch 状态变更 + 副作用 send
function onServerMessage(msg: ServerMessage, ws: WsClient, dispatch: (a: Action) => void) {
  switch (msg.type) {
    case "dirs":
      dispatch({ type: "dirs", dirs: msg.dirs });
      break;
    case "session_opened":
      dispatch({ type: "session_opened", sessionId: msg.sessionId, cwd: msg.cwd, messages: msg.messages as AgentMessage[] });
      // 副作用：补发拉取该会话的目录/命令
      ws.send({ type: "list_dir", sessionId: msg.sessionId } satisfies ClientMessage);
      ws.send({ type: "list_commands", sessionId: msg.sessionId } satisfies ClientMessage);
      break;
    case "session_closed":
      dispatch({ type: "session_closed", sessionId: msg.sessionId });
      break;
    case "agent_event": {
      const event = msg.event as AgentSessionEvent;
      dispatch({ type: "agent_event", sessionId: msg.sessionId, event });
      // 副作用：tool_end 后 1.5s 删卡片
      if (event.type === "tool_execution_end") {
        const sid = msg.sessionId;
        const tcid = event.toolCallId;
        setTimeout(() => dispatch({ type: "drop_tool", sessionId: sid, toolCallId: tcid }), 1500);
      }
      break;
    }
    case "file_content":
      dispatch({ type: "file_content", path: msg.path, content: msg.content });
      break;
    case "dir_content":
      dispatch({ type: "dir_content", sessionId: msg.sessionId, path: msg.path, entries: msg.entries as DirEntry[] });
      break;
    case "commands":
      dispatch({ type: "commands", sessionId: msg.sessionId, commands: msg.commands });
      break;
    case "models":
      dispatch({ type: "models", models: msg.models });
      break;
    case "sessions_list":
      dispatch({ type: "sessions_list", sessions: msg.sessions });
      break;
    case "entries_tree":
      dispatch({ type: "entries_tree", tree: msg.tree, leafId: msg.leafId });
      break;
    case "error":
      dispatch({ type: "error", message: msg.message, sessionId: msg.sessionId });
      break;
    case "model_changed":
    case "thinking_changed":
      break;
  }
}
