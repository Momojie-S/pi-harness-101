// 主题切换 hook（ADR-010）。
// 默认由 index.html 内联脚本根据 localStorage / prefers-color-scheme 预设 data-theme（无 FOUC）。
// 本 hook 读初始值 → 维护 React state → 同步写 data-theme + localStorage。
// 在 App 层调用一次，通过 props 把 { theme, toggleTheme } 下传给 ThemeToggle，避免多实例状态分叉。
import { useCallback, useState } from "react";

export type Theme = "dark" | "light";
const STORAGE_KEY = "pi-wc-theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "light" || attr === "dark" ? attr : "dark";
  });

  const apply = useCallback((t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* localStorage 不可用时静默 */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, [apply]);

  return { theme, toggleTheme };
}
