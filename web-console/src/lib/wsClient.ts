// WebSocket 客户端封装（重构 Step 3）。
// 职责：连接管理、send、回调注册。不含业务逻辑（dispatch 在 useWebSocket）。
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export interface WsClient {
  send: (msg: unknown) => void;
  /** 注册 onopen 回调（每次连接/重连成功都触发，含首次） */
  onOpen: (cb: () => void) => void;
  /** 注册消息回调（覆盖式，只支持一个） */
  onMessage: (cb: (data: unknown) => void) => void;
  close: () => void;
}

/** 建立带自动重连的 WebSocket 连接，返回 WsClient。 */
export function connectWs(): WsClient {
  let socket: WebSocket;
  let reconnectTimer: ReturnType<typeof setTimeout>;
  let closed = false;
  let openCb: (() => void) | null = null;
  let messageCb: ((data: unknown) => void) | null = null;

  const open = () => {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => openCb?.();
    socket.onmessage = (e) => {
      // try/catch 必需：frp/nginx 可能返回非 JSON（HTML 错误页、半截帧），
      // 裸 JSON.parse 会抛未捕获异常（污染控制台 + 漏处理该帧 + dispatch 冒泡）。
      try {
        messageCb?.(JSON.parse(e.data));
      } catch (err) {
        console.error("[ws] 消息解析失败（可能非 JSON，如代理错误页）:", err);
      }
    };
    socket.onclose = () => {
      if (!closed) reconnectTimer = setTimeout(open, 2000);
    };
  };
  open();

  return {
    send: (msg) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); },
    onOpen: (cb) => { openCb = cb; },
    onMessage: (cb) => { messageCb = cb; },
    close: () => {
      closed = true;
      clearTimeout(reconnectTimer);
      socket.close();
    },
  };
}
