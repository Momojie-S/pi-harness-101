# 布局

> 角色：**全屏布局的设计依据 + 改动约束**。改任何布局相关 className 前先读本文，尤其是「三条铁律」。
> 关联：整体架构见 [../design.md](../design.md)；组件职责见 [frontend-architecture.md](frontend-architecture.md)；限宽居中决策见 [ADR-011](../adr/011-content-maxwidth-center.md)；主题令牌见 [design-system.md](design-system.md)。

## 1. 三层结构

整个界面是一个锁死视口高度的 flex 容器，桌面端横向、移动端纵向：

```
#root > div                         ← 根容器：h-screen overflow-hidden（锁死视口，铁律①）
├── <aside> Sidebar                 ← 桌面：lg:w-64 lg:shrink-0 lg:overflow-y-auto（固定宽 + 内部滚动，铁律②）
│   └── （移动端改为 fixed 抽屉，lg:hidden，自带 overflow-y-auto）
└── <main> ChatPanel                ← max-w-3xl mx-auto flex-1 min-h-0（限宽居中 ADR-011 + 铁律②③）
    ├── 移动端顶栏                    ← lg:hidden
    ├── <div> 消息流                  ← min-h-0 flex-1 overflow-y-auto（铁律②，主滚动区）
    ├── <StatusBar>                  ← 固定高度
    └── <div> 输入区                  ← 固定高度
```

**关键**：只有**各区域的内部滚动容器**会出滚动条，根容器永远不产生页面级滚动——这是输入框永远钉在视口底部的根本保证。

## 2. 全屏布局三条铁律

> 这三条是**强约束**，违反任一条都会导致「输入框飘走 / 页面出现多余滚动条 / 内容撑破视口」。

### 铁律①：根容器锁死视口

```jsx
<div className="flex h-screen overflow-hidden ...">
```

- `h-screen`（height: 100vh）：根容器高度 = 视口高度
- `overflow-hidden`：**子内容溢出也绝不撑开文档**——这是最后一道防线。即使某处漏了 `overflow-y-auto`，最坏情况是内容被裁剪，而不是页面出现滚动条把输入框推走

### 铁律②：可滚动区域必须 `overflow-y-auto` + `min-h-0`

flex 子元素默认 `min-height: auto`（= 内容高度），会阻止元素收缩——内容多高，元素就多高，于是撑破容器。

两个等价手段让它能收缩到容器高度以内：

| 手段 | 原理 | 用在哪 |
|------|------|--------|
| `overflow-y-auto`（或 hidden） | CSS 规范：overflow ≠ visible 时 `min-height: auto` 自动归零 | Sidebar aside、消息流 |
| `min-h-0`（min-height: 0） | 显式归零 | ChatPanel main、消息流 |

实践中**两个都写**最稳妥（Sidebar 靠 `overflow-y-auto` 隐式归零，ChatPanel 靠 `min-h-0` 显式归零）。

> ⚠️ **常见坑**：给一个 flex 子元素加了 `flex-1`（想让它弹性占空间）却忘了 `min-h-0`——结果内容一多，`min-height: auto` 撑开它，`flex-1` 的「弹性」失效，容器被撑破。**凡是 flex 子元素 + 需要内部滚动的，`min-h-0` 不能漏。**

### 铁律③：主内容区限宽居中

```jsx
<main className="mx-auto ... w-full max-w-3xl flex-1 ...">
```

- `max-w-3xl`（768px）：限制内容最大宽度，避免超宽屏一行拉太长
- `mx-auto`：flex item 的 `margin: auto` 吸收剩余空间实现居中
- `flex-1` + `max-w-3xl` 组合：剩余空间 > 768px 时居中留白；< 768px（如 DevTools 挤压）时撑满、均匀收窄

详见 [ADR-011](../adr/011-content-maxwidth-center.md)。

## 3. 各区域宽度 / 高度策略

### 宽度

| 区域 | 策略 | className 要点 |
|------|------|----------------|
| Sidebar | 固定宽，不参与水平伸缩 | `lg:w-64 lg:shrink-0` |
| ChatPanel | 弹性 + 限宽居中 | `flex-1 max-w-3xl mx-auto w-full` |
| 消息气泡 | 相对内容区的百分比 | 用户消息 `max-w-[85%]` 右对齐；助手 `max-w-[92%]` |

> Sidebar 固定 + ChatPanel 弹性是**业界标准**（VS Code / Linear / Cursor），不要改成「两边都弹性」——侧边栏太窄不可用。

### 高度

| 区域 | 策略 | className 要点 |
|------|------|----------------|
| 根容器 | 锁死视口 | `h-screen overflow-hidden`（铁律①） |
| Sidebar | 内部滚动 | `lg:overflow-y-auto`（铁律②） |
| ChatPanel main | flex 列容器，自身不滚动 | `min-h-0 flex-col` |
| 消息流 | 弹性占剩余高度 + 内部滚动 | `min-h-0 flex-1 overflow-y-auto`（铁律②） |
| 状态栏 / 输入区 | 固定高度（不弹性、不滚动） | 默认高度 |

## 4. 踩坑复盘

### 案例：会话多时输入框飘走、下方空白（已修复）

**现象**：打开多个会话后，左侧 Sidebar 撑高超过视口，右侧 ChatPanel 出现页面级滚动，底部一片空白，输入框不在视口最下方。

**根因**：
1. 桌面 `<aside>` 当时是 `overflow: visible`（无滚动约束）
2. 内部**会话列表**是 SidebarContent 唯一没有 `max-height` 的区块（dirSessions 有 `max-h-[35vh]`、目录树有 `max-h-[45vh]`，会话列表裸奔）
3. 内容溢出 aside → 溢出到文档流 → 撑开 `<body>` → 页面级滚动条 → ChatPanel（被 stretch 到 100vh）的输入框被推离视口底部

**修复**：
- `<aside>` 加 `lg:overflow-y-auto`：溢出转为侧边栏内部滚动（铁律②）
- 根容器加 `overflow-hidden`：双保险（铁律①）

**对比**：移动端抽屉 aside 一直有 `overflow-y-auto`，所以移动端从不溢出——说明这个约束从一开始就该对桌面端也生效。

### 经验

- **新增任何可能撑高的列表 / 区块**：要么给它 `max-h-[Xvh] overflow-y-auto`（局部滚动），要么确保它的滚动容器祖先有 `overflow-y-auto`（整栏滚动）。不能裸奔。
- **「页面能滚动」在单页全屏应用里几乎总是 bug**——正常情况只有视口内各滚动容器各自滚动。

## 5. 改动检查清单

改布局相关代码时逐条核对：

- [ ] 根容器：`h-screen overflow-hidden` 还在？（铁律①）
- [ ] 新增 / 改动可滚动区域：有 `overflow-y-auto` + `min-h-0`？（铁律②）
- [ ] 新增可能撑高的列表：有 `max-h` 约束或祖先可滚动？（§4 经验）
- [ ] 主内容区宽度：`max-w` + `mx-auto` 策略未被破坏？（铁律③ / ADR-011）
- [ ] 验证手段：`document.body.scrollHeight <= window.innerHeight`（页面级滚动不该出现）
