# ADR-007：状态管理选 useReducer（零依赖）而非 zustand

| 项 | 值 |
|----|----|
| 状态 | 已决策 |
| 日期 | 2026-08-11 |

## 背景

web-console 前端重构（拆 App.tsx 上帝组件）需要集中管理跨组件状态。当前用 14 个 `useState` + 3 个镜像 `useRef`（为绕闭包陈旧），是 React 反模式。需要选一个状态管理方案。

## 面临的选择

- **A. `useReducer`**：React 内置，零依赖。状态变更集中进纯函数 reducer，配 `dispatch`。闭包陈旧由不可变性 + 选择器解决。
- **B. `zustand`**：轻量外部库。store 在组件外，天然无闭包陈旧，API 简洁（`set`/`get`），selector 订阅。

## 决策

选 **A. `useReducer`**。

## 理由

- **零依赖**：web-console 依赖已尽量精简（React + ws + pi SDK）。引入状态库为一个「可由 reducer 替代」的需求新增依赖，不符合长远利益的最小化原则。
- **贴合 React 心智**：reducer 是 React 官方推崇的复杂状态方案，团队（含 AI 辅助）对它的理解最一致，迁移/维护成本低。
- **闭包陈旧已有解**：配合「单一 stateRef 供重连读快照」（ADR-008），其余一律 dispatch，3 个镜像 ref 可消除。zustand 的「天然无陈旧」优势在本场景不构成决定性。
- **现状规模匹配**：14 个 state 收敛进一个 reducer，规模适中；若日后 action 膨胀到难维护，再迁移 zustand 也只是机械工作（reducer case → store action）。

## 放弃了什么

- zustand 更少的 boilerplate（不需 action 类型定义、不需要 dispatch 传递链）。
- zustand store 在组件外、可在任意非组件代码（如 wsClient）直接访问——本方案需要 hook 层中转。

## 迁移触发条件

满足以下任一时，重新评估是否迁移 zustand：
- reducer action 超过 ~20 个、且 case 间出现重复模式难以抽取。
- 出现「多个不相关组件需高频读同一状态切片」导致 selector 性能问题。
- 需在组件外（纯工具函数）直接读写状态，dispatch 传递链变得笨重。
