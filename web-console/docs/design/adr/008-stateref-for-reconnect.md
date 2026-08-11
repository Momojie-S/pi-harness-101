# ADR-008：保留单一 stateRef 供重连读快照

| 项 | 值 |
|----|----|
| 状态 | 已决策 |
| 日期 | 2026-08-11 |

## 背景

重构用 `useReducer` 后，状态变更一律走 `dispatch`，理论上应消除所有「镜像 state 的 ref」。但有一处场景必须读「最新 state 快照」：**WebSocket 断线重连的 `onopen`**——它要遍历当前所有活跃会话，对每个重发 `open_session` 恢复订阅。

`onopen` 是 WebSocket 实例的方法，不在 React 渲染流程内，拿不到最新 state（闭包会捕获渲染时的旧 state）。

## 面临的选择

- **A. 纯 dispatch**：onopen 不读 state，而是 dispatch 一个 `reconnect` action，reducer 内根据现有 state 决定重订阅哪些会话。但重订阅要**发 WS**（副作用），reducer 不能发——需在 dispatch 后由 effect 检测「需要重连」再发，绕一圈，且要额外标志位管理「待重连」状态。
- **B. 保留一个 `stateRef`**：`useRef` 指向最新 state，由 `useEffect` 同步；onopen 直接读 `stateRef.current.sessionOrder` 发 WS。

## 决策

选 **B. 保留单一 `stateRef`**。

## 理由

- **收敛而非消除**：现状是 3 个分散的镜像 ref（activeSessionIdRef/sessionOrderRef/sessionsRef），各自同步、易漏。收敛为 1 个 `stateRef`，职责单一（仅供重连读快照），注释明确其用途——比方案 A 的「纯 dispatch + 待重连标志 + effect」简单得多。
- **副作用归位清晰**：重连的发 WS 是副作用，本就该在 hook 层（useWebSocket）做；读 stateRef 发 WS，比「reducer 设标志 → effect 检测 → 发 WS」直白。
- **影响面极小**：stateRef 只在 onopen 一处读，不参与渲染、不参与其他 dispatch 逻辑，不会引入新的陈旧问题。

## 放弃了什么

- 理论上的「reducer 是唯一状态出口」纯粹性——stateRef 是一个「读最新 state」的逃生舱，虽然只读不写。
- `useEffect` 同步有理论时序窗口（同 tick 内连续 dispatch，stateRef 在下次 effect 前滞后）。但重连不在高频 dispatch 中，实际无影响；若严格可用 `useLayoutEffect` 或 dispatch 包装层同步赋值。

## 后果

- 代码里会有 1 个 ref + 一行 `useEffect` 同步 + onopen 里的读取，带注释说明「仅用于重连」。审阅者能一眼看懂为何保留。
- 若将来引入 zustand（ADR-007 的迁移触发条件），此 ref 可直接删除（store 在组件外，onopen 用 `store.getState()`）。
