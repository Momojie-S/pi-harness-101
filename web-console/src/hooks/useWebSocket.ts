// WebSocket hook（重构 Step 3）。
// 职责：连接 + 自动重连 + onMessage→dispatch + 副作用 send（session_opened 补发、tool_end 延迟 drop、重连重订阅）。
// 设计依据：docs/design/modules/frontend-architecture.md §5。
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ClientMessage, ServerMessage } from "../../server/types.ts";
import type { AgentMessage, AgentSessionEvent, DirEntry } from "../types.ts";
import type { Action, AppState } from "../state/sessionReducer.ts";
import { connectWs, type WsClient } from "../lib/wsClient.ts";
import { streamStore } from "../state/streamStore.ts";

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
    ws.onMessage((data) => onServerMessage(data as ServerMessage, dispatch));

    return () => ws.close();
    // dispatch 引用稳定（useReducer 返回值），stateRef 同理；effect 只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 返回稳定引用：api 对象用 useState lazy init 只创建一次，send 闭包捕获 wsRef（ref 稳定）。
  // 这样 App 的 useCallback 回调能以 [ws] 为 deps 且 ws 不变——否则 ws 每次新对象会导致所有
  // 回调重建、破坏下游组件的 memo（MessageView/ToolCard 等不跳过重渲染）。
  const [api] = useState(() => ({ send: (msg: ClientMessage) => wsRef.current?.send(msg) }));
  return api;
}

// onServer：dispatch 状态变更 + 副作用 send
function onServerMessage(msg: ServerMessage, dispatch: (a: Action) => void) {
  switch (msg.type) {
    case "dirs":
      dispatch({ type: "dirs", dirs: msg.dirs });
      break;
    case "sessions_active":
      dispatch({ type: "sessions_active", sessions: msg.sessions });
      break;
    case "session_opened":
      // 会话（重新）加载：清理该 session 的旧流式缓冲（防残留/防泄漏，见 ADR-017）
      streamStore.cleanup(msg.sessionId);
      // 后端已在 session_opened 里预取了根目录 + 命令（省 2 次 WS 往返；frp 抖动下显著），无需再补发
      dispatch({ type: "session_opened", sessionId: msg.sessionId, cwd: msg.cwd, sessionFile: msg.sessionFile, messages: msg.messages as AgentMessage[], messageTotal: msg.messageTotal, messageOffset: msg.messageOffset, model: msg.model, contextUsage: msg.contextUsage, dirContent: msg.dirContent, commands: msg.commands });
      break;
    case "session_closed":
      streamStore.cleanup(msg.sessionId); // 清理流式数据（ADR-017）
      dispatch({ type: "session_closed", sessionId: msg.sessionId });
      break;
    case "agent_event": {
      const event = msg.event as AgentSessionEvent;
      const sid = msg.sessionId;
      // —— 高频流式事件 → streamStore（绕开 reducer，避免全局重渲染；见 ADR-017）——
      switch (event.type) {
        case "message_start":
          streamStore.clearText(sid);
          return; // 不 dispatch（reducer 无状态可改）
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            streamStore.appendText(sid, event.assistantMessageEvent.delta);
          }
          return; // 非 text_delta 的 message_update 原 reducer 也是 no-op
        case "tool_execution_update": {
          const partial = event.partialResult?.content?.map((c: any) => c.text).join("") ?? "";
          streamStore.setToolOutput(sid, event.toolCallId, partial);
          return; // 流式 output 不进 reducer
        }
        case "message_end":
          // 清流式缓冲（外部 store）+ 落定消息（reducer）
          streamStore.clearText(sid);
          break; // 继续走下面的 dispatch
      }
      // —— 低频事件 → reducer ——
      dispatch({ type: "agent_event", sessionId: sid, event });
      // 副作用：tool_end 后 1.5s 删卡片
      if (event.type === "tool_execution_end") {
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
    case "reloaded":
      // reload 完成：刷新命令列表（新扩展的命令立即生效）+ 用户可见反馈
      dispatch({ type: "commands", sessionId: msg.sessionId, commands: msg.commands });
      dispatch({ type: "system_notice", sessionId: msg.sessionId, content: `已重载扩展/skills/prompts（${msg.commands.length} 个命令可用）` });
      break;
    case "ui_notify":
      // 扩展 ctx.ui.notify 转发：info → system-notice（绿）；warning/error → system-error（红）
      if (msg.level === "info") {
        dispatch({ type: "system_notice", sessionId: msg.sessionId, content: msg.message });
      } else {
        dispatch({ type: "error", message: msg.message, sessionId: msg.sessionId });
      }
      break;
    case "ui_set_status":
      // 扩展 ctx.ui.setStatus 转发：key→text 映射，undefined 清除
      dispatch({ type: "set_extension_status", sessionId: msg.sessionId, key: msg.key, text: msg.text });
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
