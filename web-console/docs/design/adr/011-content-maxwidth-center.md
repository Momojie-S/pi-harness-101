# 内容区限宽居中

ADR-011: ChatPanel 主内容区限宽居中（max-w-3xl mx-auto）

## 状态

Accepted

## 背景

ChatPanel `<main>` 原本只有 `flex-1`（无宽度上限），在超宽屏（实测 2552px）下 main 撑到 2296px，带来两个问题：

1. **阅读体验差**：消息一行极长（助手消息 `max-w-[92%]` ≈ 2112px），文字横向拉散
2. **DevTools 挤压不对称**：按 F12 打开 DevTools（停靠右侧）→ 视口变窄 → Sidebar（`shrink-0`）纹丝不动，全部收缩量由 ChatPanel 承担 → 左右视觉突兀、不对称

## 决策

给 `<main>` 加 `max-w-3xl mx-auto`（768px 限宽 + 自动居中）：

```jsx
<main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
```

- `max-w-3xl` + `flex-1`：剩余空间 > 768px 时只取 768px；< 768px 时撑满
- `mx-auto`：flex item 的 `margin: auto` 吸收左右剩余空间，居中
- `w-full`：配合 max-w，小屏时占满

效果：内容始终居中、两侧留白对称；DevTools 挤压到 < 768px 时内容才均匀收窄（左右 padding 同时缩，视觉始终对称）。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 撑满**（flex-1 无 max-width，原状） | 空间利用率最高；代码最简 | 超宽屏阅读差；DevTools 挤压只作用于一侧，视觉突兀 |
| **B. 限宽居中**（max-w-3xl mx-auto）✅ | 阅读体验好；DevTools 影响小；视觉对称 | 超宽屏两侧留白（空间「浪费」） |
| **C. 侧边栏也按比例缩**（去 shrink-0） | 两边均衡收缩 | 侧边栏太窄不可用；非业界做法（VS Code / Linear 侧边栏都是固定宽） |

## 后果

### 正面

- 超宽屏阅读体验显著改善（768px 是经过验证的最佳阅读宽度，ChatGPT / Claude 同款）
- DevTools 打开后视觉稳定，不突兀
- 与 ChatGPT / Claude / Linear 等主流产品一致，用户直觉匹配

### 负面

- 超宽屏两侧留白「浪费」空间（但这是业界共识的取舍——阅读宽度优先于空间利用率）
- 工具卡片 / 代码块超 768px 时横向滚动（已有 `overflow-auto`，可接受）

## 参考

- 布局整体设计：[modules/layout.md](../modules/layout.md) 铁律③
- 同类产品：ChatGPT（max-w-3xl）、Claude（类似限宽）、Linear
