// 「最近打开」工作目录的本地持久化（localStorage）。
// 纯前端记忆，跨设备不同步（见 ADR-009 后果）。
const KEY = "web-console:recent-dirs";
const MAX = 12;

/** 读取最近打开的目录列表（最新在前）。localStorage 不可用时返回空数组。 */
export function getRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 把一个目录加入「最近打开」（去重、置顶、截断到 MAX）。 */
export function addRecentDir(dir: string): void {
  if (!dir) return;
  const cur = getRecentDirs();
  const next = [dir, ...cur.filter((d) => d.toLowerCase() !== dir.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）——静默降级，不记忆
  }
}

/** 从「最近打开」移除一个目录。 */
export function removeRecentDir(dir: string): void {
  const next = getRecentDirs().filter((d) => d.toLowerCase() !== dir.toLowerCase());
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 静默降级
  }
}
