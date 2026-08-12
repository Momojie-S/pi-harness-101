// WebSocket hook（重构 Step 3）。
// 职责：连接 + 自动重连 + onMessage→dispatch + 副作用 send（session_opened 补发、tool_end 延迟 drop、重连重订阅）。
// 设计依据：docs/design/modules/frontend-architecture.md §5。
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ClientMessage, ServerMessage } from "../../server/types.ts";
import type { AgentMessage, AgentSessionEvent, DirEntry } from "../types.ts";
import type { Action, AppState } from "../state/sessionReducer.ts";
import { connectWs, type WsClient } from "../lib/wsClient.ts";

// 重启超时定时器（单例：一个页面只有一个 WS 连接）
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

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
      dispatch({ type: "set_restarting", restarting: false });
      // 服务重连成功，清除重启超时定时器
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
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
    case "sessions_active":
      dispatch({ type: "sessions_active", sessions: msg.sessions });
      break;
    case "session_opened":
      dispatch({ type: "session_opened", sessionId: msg.sessionId, cwd: msg.cwd, sessionFile: msg.sessionFile, messages: msg.messages as AgentMessage[], messageTotal: msg.messageTotal, messageOffset: msg.messageOffset, model: msg.model, contextUsage: msg.contextUsage });
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
      dispatch({ type: "sessions_list", cwd: msg.cwd, sessions: msg.sessions });
      break;
    case "entries_tree":
      dispatch({ type: "entries_tree", tree: msg.tree, leafId: msg.leafId });
      break;
    case "browse_result":
      dispatch({ type: "browse_result", path: msg.path, parent: msg.parent, dirs: msg.dirs });
      break;
    case "error":
      dispatch({ type: "error", message: msg.message, sessionId: msg.sessionId });
      break;
    case "earlier_messages":
      dispatch({ type: "earlier_messages", sessionId: msg.sessionId, messages: msg.messages as AgentMessage[], offset: msg.offset });
      break;
    case "restarting":
      dispatch({ type: "set_restarting", restarting: true });
      // 启动超时定时器：60s 后若未重连成功（接班进程没起来），提示用户
      if (restartTimeout) clearTimeout(restartTimeout);
      restartTimeout = setTimeout(() => {
        dispatch({ type: "error", message: "服务重启超时（60s 未恢复），请手动检查后端服务" });
        dispatch({ type: "set_restarting", restarting: false });
      }, 60_000);
      break;
    case "model_changed":
      dispatch({ type: "model_changed", sessionId: msg.sessionId, model: msg.model });
      break;
    case "context_usage":
      dispatch({ type: "context_usage", sessionId: msg.sessionId, usage: msg.usage });
      break;
    case "thinking_changed":
      break;
  }
}
