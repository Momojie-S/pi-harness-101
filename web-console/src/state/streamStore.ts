// 流式数据外部 store（绕开 useReducer，根治流式输出时的全局重渲染）。
// 详见 docs/design/adr/017-stream-data-external-store.md。
//
// 背景：useReducer 每次返回新顶层 state → 整棵组件树重渲染。LLM token 级的
// message_update（每秒数十次）和工具流式 tool_execution_update 若进 reducer，
// 会让 Sidebar / 目录树 / 其他会话面板等无关组件跟着重渲染，导致界面卡顿。
//
// 解法：这两个高频更新源移到独立的 useSyncExternalStore 外部 store，
// 组件用 useStreamText / useToolOutput 按需订阅——只有真正读取该值的组件
// 才重渲染，其余不动。低频状态继续走 useReducer（ADR-007），不受影响。
//
// 订阅模型：全局 listener + getSnapshot 按 sid/toolCallId 取值。useSyncExternalStore
// 要求 subscribe 引用稳定（只在 mount 订阅一次），故 subscribe 不依赖 sid；
// 任何变更通知所有 listener，React 用 getSnapshot 返回值（string，=== 比较）决定
// 是否重渲染——值没变的组件不重渲染。listener 唤醒 + string 比较开销远小于重渲染。
import { useSyncExternalStore } from "react";

type Listener = () => void;

/** 每个 session 的流式数据 */
interface SessionStream {
  /** 当前正在生成的 assistant 文本（message_update / text_delta 累积） */
  streamText: string;
  /** toolCallId → 流式输出（tool_execution_update） */
  toolOutputs: Map<string, string>;
}

const cache = new Map<string, SessionStream>();
const listeners = new Set<Listener>();

function get(sid: string): SessionStream {
  let s = cache.get(sid);
  if (!s) {
    s = { streamText: "", toolOutputs: new Map() };
    cache.set(sid, s);
  }
  return s;
}

function notify() {
  listeners.forEach((l) => l());
}

export const streamStore = {
  /** 追加流式文本（message_update / text_delta） */
  appendText(sid: string, delta: string) {
    get(sid).streamText += delta;
    notify();
  },
  /** 清空流式文本（message_start / message_end） */
  clearText(sid: string) {
    const s = cache.get(sid);
    if (s && s.streamText !== "") {
      s.streamText = "";
      notify();
    }
  },
  /** 设置工具流式输出（tool_execution_update） */
  setToolOutput(sid: string, toolCallId: string, output: string) {
    get(sid).toolOutputs.set(toolCallId, output);
    notify();
  },
  /** 清理 session 的全部流式数据（会话关闭 / 重新加载时，防内存泄漏 + 防残留） */
  cleanup(sid: string) {
    const had = cache.has(sid);
    cache.delete(sid);
    if (had) notify();
  },
  /** 订阅（稳定引用，供 useSyncExternalStore） */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getStreamText(sid: string): string {
    return cache.get(sid)?.streamText ?? "";
  },
  getToolOutput(sid: string, toolCallId: string): string {
    return cache.get(sid)?.toolOutputs.get(toolCallId) ?? "";
  },
};

const EMPTY = "";

/** 订阅当前 session 的流式文本（ChatPanel 流式区使用） */
export function useStreamText(sid: string | null): string {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (sid ? streamStore.getStreamText(sid) : EMPTY),
  );
}

/** 订阅某工具的流式输出（ToolCard 使用；每卡片独立订阅，互不影响） */
export function useToolOutput(sid: string | null, toolCallId: string | undefined): string {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (sid && toolCallId ? streamStore.getToolOutput(sid, toolCallId) : EMPTY),
  );
}

// 调试：暴露 streamStore 到 window（性能测试用，手动模拟流式 token 高频更新）
if (typeof window !== "undefined") (window as any).__streamStore = streamStore;
