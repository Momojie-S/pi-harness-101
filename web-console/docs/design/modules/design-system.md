# 设计系统（Design System）

> 角色：前端视觉的**唯一事实来源**。所有配色 / 字体 / 圆角 / 间距 / 阴影 / 主题切换的实现细节在此。
> 选型理由见 [ADR-010](../adr/010-frontend-theme-system.md)；整体多端适配见 [design.md](../design.md)「多端适配」；组件结构见 [frontend-architecture.md](frontend-architecture.md)。
>
> 本文档是代码实施的精确蓝图——实施阶段「照文档落地」，不在此之外发明令牌。

## 1. 设计原则

1. **语义令牌驱动**：组件用语义 class（`bg-surface` / `text-secondary` / `border-default`），**不直接写色值**。改皮肤只改变量，组件代码不动。
2. **层次靠透明度**：深色用「白色低透明度叠加」做分层与边框（Linear 技法），浅色用黑色低透明度。这是根治"灰扑扑"的核心。
3. **克制**：圆角最大 12px；强调色（蓝紫）只用于一处主 CTA + 状态语义色，不滥用。
4. **双主题等价**：每个令牌都有亮 / 暗两套值；组件代码与主题解耦，不存在"只在某主题下成立"的写法。

## 2. 主题切换机制

- **根元素属性**：`<html data-theme="dark">` 或 `"light"`。
- **优先级**：`localStorage("pi-wc-theme")`（用户手动切换过）> `prefers-color-scheme`（系统）。
- **无 FOUC（防闪烁）**：`index.html` 的 `<head>` 最前面**内联一段同步脚本**，在首帧渲染前读 localStorage / 系统偏好并设好 `data-theme`，避免页面先以错主题闪一下再切。
- **CSS 变量分组**：变量按 `[data-theme="dark"]` / `[data-theme="light"]` 分组定义值；切换即换值，组件零改动。
- **切换入口**：顶栏（或侧边栏底部）放主题切换按钮；切换写 localStorage 并更新 `data-theme`。

```html
<!-- index.html <head> 首行（无 FOUC 内联脚本） -->
<script>
  (function () {
    var saved = localStorage.getItem("pi-wc-theme");
    var theme = saved || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
```

> **默认主题**：未存过偏好时**跟随系统**；系统未表态时默认 **dark**（web-console 是开发者深夜用的操控台，暗色为默认心智）。

## 3. 颜色令牌

### 3.1 命名层级

| 层级 | 含义 |
|------|------|
| `bg-canvas` | 页面底色（最底层） |
| `bg-surface` | 面板 / 卡片 / 输入框背景 |
| `bg-surface-2` | 抬升层：hover、嵌套卡片、选中态 |
| `bg-elevated` | 弹层：抽屉、模态、下拉（最上层，带阴影） |
| `border-default` | 常规分隔线 |
| `border-strong` | 强调分隔线（输入框聚焦边框等） |
| `text-primary` | 主要文字（正文、标题） |
| `text-secondary` | 次要文字（说明、标签） |
| `text-tertiary` | 三级文字（占位符、时间戳） |
| `text-disabled` | 禁用态文字 |
| `accent` | 主强调色（蓝紫）：主 CTA、链接、选中高亮 |
| `accent-hover` | 强调色 hover |
| `accent-contrast` | 强调色上的文字（按钮文字，=白） |
| `status-*` | 语义状态色，每个含 `fg`（前景/图标）、`bg-soft`（淡背景）、`border` |

### 3.2 深色主题（`data-theme="dark"`）

> 底色取自 Linear 实测（`#08090A`）；状态色取自 GitHub Primer（亮暗色都做得规范的业界标杆）。

```css
[data-theme="dark"] {
  /* 背景（逐级抬升） */
  --bg-canvas: #08090A;
  --bg-surface: #0F1011;
  --bg-surface-2: #16171A;
  --bg-elevated: #1C1D20;

  /* 边框：白色低透明度叠加（Linear 技法） */
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);

  /* 文字 */
  --text-primary: #F7F8F8;
  --text-secondary: #A8AEB8;
  --text-tertiary: #6B7178;
  --text-disabled: #4A4F55;

  /* 强调（蓝紫，Linear 实测） */
  --accent: #5E6AD2;
  --accent-hover: #767FE0;
  --accent-contrast: #FFFFFF;

  /* 语义状态 */
  --status-success-fg: #3FB950;  --status-success-bg: rgba(63,185,80,0.12);  --status-success-border: rgba(63,185,80,0.3);
  --status-warning-fg: #D29922;  --status-warning-bg: rgba(210,153,34,0.14); --status-warning-border: rgba(210,153,34,0.35);
  --status-danger-fg:  #F85149;  --status-danger-bg:  rgba(248,81,73,0.14);  --status-danger-border:  rgba(248,81,73,0.35);
  --status-info-fg:    #58A6FF;  --status-info-bg:    rgba(88,166,255,0.14); --status-info-border:    rgba(88,166,255,0.35);

  /* 阴影：深色弱阴影，主要靠边框 + 抬升色分层 */
  --shadow: 0 4px 12px rgba(0,0,0,0.35);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.5);
}
```

### 3.3 浅色主题（`data-theme="light"`）

```css
[data-theme="light"] {
  /* 背景 */
  --bg-canvas: #FBFBFC;
  --bg-surface: #FFFFFF;
  --bg-surface-2: #F3F4F6;
  --bg-elevated: #FFFFFF;

  /* 边框：黑色低透明度 */
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.14);

  /* 文字 */
  --text-primary: #1A1B1E;
  --text-secondary: #565C66;
  --text-tertiary: #8A909A;
  --text-disabled: #B8BCC4;

  /* 强调：浅色下加深饱和，保证对白文字 ≥ 4.5:1（WCAG AA） */
  --accent: #4F54E8;
  --accent-hover: #4046D9;
  --accent-contrast: #FFFFFF;

  /* 语义状态（GitHub Primer 浅色值） */
  --status-success-fg: #1A7F37;  --status-success-bg: rgba(26,127,55,0.10);  --status-success-border: rgba(26,127,55,0.3);
  --status-warning-fg: #9A6700;  --status-warning-bg: rgba(154,103,0,0.12);  --status-warning-border: rgba(154,103,0,0.35);
  --status-danger-fg:  #CF222E;  --status-danger-bg:  rgba(207,34,46,0.10);  --status-danger-border:  rgba(207,34,46,0.3);
  --status-info-fg:    #0969DA;  --status-info-bg:    rgba(9,105,218,0.10);  --status-info-border:    rgba(9,105,218,0.3);

  /* 阴影：浅色用实阴影 */
  --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
}
```

### 3.4 对比度要求

- 强调色按钮（`accent` 底 + `accent-contrast` 白字）：亮 / 暗主题下均 **≥ 4.5:1**（WCAG AA 正文级）。已校准（浅色用 `#4F54E8` 而非深色的 `#5E6AD2`）。
- 主要文字 `text-primary` on `bg-canvas`：亮 / 暗均 ≥ 7:1（AAA）。
- 次要文字 `text-secondary`：≥ 4.5:1。

## 4. 字体

```css
:root {
  --font-sans: "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI",
               "PingFang SC", "Microsoft YaHei", "Noto Sans SC",
               system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "SFMono-Regular",
               Consolas, "Liberation Mono", monospace;
}
```

- **英文 / 数字**：Inter 可变字体（自托管，family 名 `Inter Variable`）。用 `@fontsource-variable/inter` 的 `wght.css`（字重轴），各子集按 `unicode-range` 分割——**浏览器运行时只下载页面用到的 latin 子集（~48KB）**，其余子集（cyrillic/greek/…）虽打包进 dist 但不会被加载。
- **中文**：系统字体兜底（macOS 苹方、Windows 微软雅黑、Linux Noto Sans SC），**不引入中文字体**（体积过大）。
- **等宽**（工具名 / 代码块）：JetBrains Mono 兜底系统等宽。

**自托管配置**：`src/index.css` 顶部 `@import '@fontsource-variable/inter/wght.css';`（Vite 打包 woff2 到 `dist/client/assets/`）；`font-display` 由包内置为 `swap`（Inter 未加载时先用系统字体，无感切换）。

## 5. 圆角

```css
:root {
  --radius-sm: 4px;   /* 小元素：标签、状态点容器 */
  --radius: 6px;      /* 默认：输入框、按钮、菜单项 */
  --radius-md: 8px;   /* 中等：卡片、工具结果 */
  --radius-lg: 12px;  /* 大：模态、气泡、消息容器（最大值） */
  --radius-full: 9999px; /* 胶囊：主 CTA、头像、开关 */
}
```

> 克制原则：**最大 12px**，不再出现 `rounded-2xl`(16px) 等大圆角。主 CTA 用胶囊（`radius-full`）呼应 Linear。

## 6. 间距

沿用 Tailwind 默认 **4px 基准**（`p-1`=4 / `p-2`=8 / `p-3`=12 / `p-4`=16 …），不另设间距令牌。响应式调整用断点前缀：

| 区域 | 移动端（<lg） | 桌面（lg+） |
|------|---------------|-------------|
| 消息区内边距 | `p-3` | `lg:p-4` |
| 侧边栏内边距 | `p-3` | `lg:p-4` |
| 输入区 | `p-2` | `lg:p-3` |
| 消息间距 | `space-y-3` | `lg:space-y-4` |

## 7. 阴影

通过 `--shadow` / `--shadow-lg` 令牌暴露（见 §3.2 / 3.3）。深色阴影弱（靠边框 + 抬升色分层），浅色用实阴影。仅 `bg-elevated`（弹层）用阴影。

## 8. 移动端规范

| 项 | 规范 | 说明 |
|----|------|------|
| **安全区** | 顶栏 `padding-top: env(safe-area-inset-top)`；输入区 `padding-bottom: env(safe-area-inset-bottom)`；侧栏 / 模态同理 | 配合 `index.html` 已有 `viewport-fit=cover`，防刘海 / 手势条遮挡 |
| **触摸目标** | 最小 40px，理想 44px | 会话项、按钮、关闭 `✕`、目录项均满足；现状多处不足 |
| **抽屉动画** | `transform: translateX(-100%) → 0`，`transition: 200ms ease-out`；遮罩 `opacity 0 → 1` | 现状直接条件渲染无过渡，需加 CSS transition |
| **移动端顶栏** | 含品牌名 + 当前会话名（不只汉堡 + 小字） | 提升识别度 |
| **输入区** | 小屏 `min-height` 增大、圆角、安全区下边距 | 改善手机打字体验 |
| **消息气泡宽度** | 用户 `max-w-[85%]`、助手 `max-w-[92%]`（保持现状） | 移动端窄屏已合理 |

## 9. Tailwind 配置映射

```js
// tailwind.config.js —— 把 CSS 变量映射成语义 utility
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // 不用 darkMode: 'class' —— 主题由 CSS 变量驱动，无需 Tailwind 暗色模式
  theme: {
    extend: {
      colors: {
        // 背景（逐级抬升）
        canvas: "var(--bg-canvas)",
        surface: { DEFAULT: "var(--bg-surface)", 2: "var(--bg-surface-2)", elevated: "var(--bg-elevated)" },
        // 文字（前景）—— fg = foreground
        fg: { DEFAULT: "var(--text-primary)", secondary: "var(--text-secondary)", tertiary: "var(--text-tertiary)", disabled: "var(--text-disabled)" },
        // 强调（蓝紫）
        accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", contrast: "var(--accent-contrast)" },
        // 语义状态（DEFAULT=图标/文字色，soft=淡背景）
        ok: { DEFAULT: "var(--status-success-fg)", soft: "var(--status-success-bg)" },
        warn: { DEFAULT: "var(--status-warning-fg)", soft: "var(--status-warning-bg)" },
        danger: { DEFAULT: "var(--status-danger-fg)", soft: "var(--status-danger-bg)" },
        info: { DEFAULT: "var(--status-info-fg)", soft: "var(--status-info-bg)" },
      },
      // 边框：DEFAULT 让 border / border-t 等 width class 自动带默认线色
      borderColor: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
        ok: "var(--status-success-border)",
        warn: "var(--status-warning-border)",
        danger: "var(--status-danger-border)",
        info: "var(--status-info-border)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"] },
      boxShadow: { DEFAULT: "var(--shadow)", lg: "var(--shadow-lg)" },
    },
  },
  plugins: [],
};
```

> **语义 utility 命名**（实现见 `tailwind.config.js`）：
> - **背景** `bg-canvas` / `bg-surface` / `bg-surface-2` / `bg-surface-elevated`
> - **文字** `text-fg`（主）/ `text-fg-secondary` / `text-fg-tertiary` / `text-fg-disabled`（`fg` = foreground；占位符用 `placeholder-fg-tertiary`）
> - **边框** `border`（默认线色，由 `borderColor.DEFAULT` 自动应用到所有 `border-*` width class）/ `border-strong`
> - **强调** `bg-accent` / `text-accent` / `hover:bg-accent-hover` / `text-accent-contrast`
> - **状态** `text-ok` / `text-warn` / `text-danger` / `text-info`；淡背景 `bg-ok-soft` / `bg-danger-soft` …；状态边框 `border-danger` / `border-info` …
> - **圆角** `rounded-sm` / `rounded` / `rounded-md` / `rounded-lg` / `rounded-full`

## 10. 迁移对照表（现有硬编码 → 语义令牌）

代码实施阶段逐个替换。**必须一次做完整**，不留半迁移。

| 现状（硬编码） | 迁移后（语义令牌） | 说明 |
|----------------|--------------------|------|
| `bg-slate-950` | `bg-canvas` | 页面底 |
| `bg-slate-900` / `bg-slate-900/60` | `bg-surface` | 卡片 / 面板 |
| `bg-slate-800` / `hover:bg-slate-800` | `bg-surface-2` / `hover:bg-surface-2` | hover / 嵌套 / 选中 |
| `bg-slate-700`（选中会话） | `bg-surface-2` | 选中态用抬升层 |
| `border-slate-800` | `border`（默认线色自动） | 常规分隔 |
| `border-slate-700` | `border-strong` | 输入框 / 强调分隔 |
| `text-slate-100` | `text-fg` | 主要文字 |
| `text-slate-300` | `text-fg-secondary` | 次要文字 |
| `text-slate-400` / `text-slate-500` | `text-fg-secondary` / `text-fg-tertiary` | 说明 / 标签 |
| `text-slate-600` / `text-slate-700` | `text-fg-tertiary` / `text-fg-disabled` | 占位 / 禁用 |
| `placeholder-slate-600` | `placeholder-fg-tertiary` | 输入框占位符 |
| `bg-blue-600` / `hover:bg-blue-500` | `bg-accent` / `hover:bg-accent-hover`（+ `rounded-full`） | 主 CTA（发送按钮）改胶囊 |
| `bg-blue-600`（用户气泡） | `bg-accent`（+ `text-accent-contrast`） | 用户消息气泡 |
| `text-blue-400`（文件路径链接） | `text-accent` | 可点击路径 |
| `text-amber-400`（工具名） | `text-accent` | 统一用强调色 |
| `text-green-400` / `text-red-400`（状态） | `text-ok` / `text-danger` | 语义状态 |
| `bg-red-600`（停止按钮） | `bg-danger`（+ `text-accent-contrast`, `rounded-full`） | 停止用危险色 |
| `bg-red-950/40 border-red-800 text-red-300`（错误框） | `bg-danger-soft border-danger text-danger` | 错误提示 |
| `border-blue-800 bg-blue-950/40 text-blue-300`（重启提示） | `border-info bg-info-soft text-info` | 信息提示 |
| `rounded-lg`（主 CTA） | `rounded-full` | CTA 改胶囊 |
| `rounded-2xl`（若有） | `rounded-lg` | 收敛到 12px 上限 |
| 字体（无，系统默认） | `font-sans`（body 全局设） | Inter + 中文兜底 |

> 状态色 utility 已在 config 映射：`text-ok/warn/danger/info`（图标/文字）、`bg-ok-soft/danger-soft/...`（淡背景）、`border-danger/info/...`（状态边框）。

## 11. 实施清单（已全部完成 ✅）

1. ✅ `index.html`：加无 FOUC 内联脚本（`<head>` 首行，读 localStorage / `prefers-color-scheme` 预设 `data-theme`）。
2. ✅ `src/index.css`：`:root`（字体 + 圆角）+ `[data-theme="dark"]` / `[data-theme="light"]` 全部变量 + 全局基础样式（body / 选区 / 滚动条 / `pt-safe`·`pb-safe` 工具类）；`@import '@fontsource-variable/inter/wght.css'`。
3. ✅ `tailwind.config.js`：按 §9 映射语义 utility（`fg` / `ok`·`warn`·`danger`·`info` / `borderColor` 状态色）。
4. ✅ 主题切换：`src/hooks/useTheme.ts`（App 层调一次）+ `src/components/ThemeToggle.tsx`（受控，入 Sidebar 底部 + ChatPanel 移动顶栏）。
5. ✅ 逐组件迁移：`App` / `Sidebar` / `ChatPanel` / `MessageView` / `StatusBar` / `CommandPalette` / `FileTree` / `EntryTree` / 6 个 Picker。
6. ✅ 移动端专项：safe-area（顶栏 `pt-safe` / 输入区 `pb-safe` / 抽屉 `pt-safe`）、抽屉滑入动画（始终在 DOM + `translate-x` + `transition 200ms` + 遮罩 `opacity`）、会话项触摸目标（移动端 `py-2`）。
7. ✅ 验收：亮 / 暗切换实测（`data-theme`、背景色、强调色、localStorage 持久化均正确）；移动端 390×844 视口实测（抽屉 `translateX(-288→0)`、遮罩 opacity、safe-area padding 均生效）。
