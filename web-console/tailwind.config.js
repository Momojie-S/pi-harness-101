/** @type {import('tailwindcss').Config} */
// 语义令牌驱动主题：颜色/圆角/字体/阴影全部映射到 CSS 变量，
// 组件用语义 class（bg-surface / text-fg / border ...），切换主题只改变量值。
// 详见 docs/design/modules/design-system.md。主题不使用 Tailwind darkMode（由 CSS 变量驱动）。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
        // 语义状态（fg 图标/文字，soft 淡背景）
        ok: { DEFAULT: "var(--status-success-fg)", soft: "var(--status-success-bg)" },
        warn: { DEFAULT: "var(--status-warning-fg)", soft: "var(--status-warning-bg)" },
        danger: { DEFAULT: "var(--status-danger-fg)", soft: "var(--status-danger-bg)" },
        info: { DEFAULT: "var(--status-info-fg)", soft: "var(--status-info-bg)" },
      },
      // 边框：DEFAULT 让 `border` / `border-t` 等 width class 自动带默认线色
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
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};
