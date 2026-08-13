import type { WebSocket } from "ws";
import path from "node:path";
import { readFile, readdir, stat, access } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionStore, type ManagedSession } from "./session-store.ts";
import type { ClientMessage, EntryTreeNode, ServerMessage } from "./types.ts";

// 不支持预览的二进制文件扩展名（svg/pem/crt 等文本格式不列入）
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "heic",
  "mp3", "mp4", "m4a", "wav", "flac", "aac", "ogg", "avi", "mkv", "mov", "webm",
  "zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "wasm", "pyc", "o", "obj",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "db", "sqlite", "sqlite3", "mdb",
  "ttf", "otf", "woff", "woff2", "eot",
  "psd", "ai", "swf",
]);
const MAX_PREVIEW_SIZE = 1024 * 1024; // 1MB

/** 分页：首屏返回最近 N 条消息，避免大对话（实测最大 4.2MB）一次性传输+渲染 */
const MSG_INITIAL_PAGE = 50;
/** 分页：每次「加载更多」的条数 */
const MSG_PAGE_SIZE = 50;

// 精简 session entry 树节点（供 /tree /fork 渲染）
function simplifyNode(node: any): EntryTreeNode {
  const e = node.entry;
  let summary = "";
  if (e.type === "message" && e.message) {
    const c = e.message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b.text || "").join("") : "";
    summary = `${e.message.role}: ${text.slice(0, 80)}`;
  } else {
    summary = `[${e.type}]`;
  }
  return { id: e.id, parentId: e.parentId, type: e.type, summary, timestamp: e.timestamp, children: (node.children || []).map(simplifyNode) };
}

/** 构造 session_opened 消息 + 预取根目录与命令。
 *  预取省去前端收到 session_opened 后补发的 2 次 WS 往返（list_dir + list_commands）——
 *  frp 链路抖动下单次往返可能 700ms，预取把「新建/打开/导航/分叉会话」从 3 次往返降到 1 次。 */
async function buildSessionOpened(store: SessionStore, managed: ManagedSession): Promise<ServerMessage> {
  const allMsgs = managed.session.messages;
  const offset = Math.max(0, allMsgs.length - MSG_INITIAL_PAGE);
  // 预取根目录（等价 list_dir 无 path；失败则空，前端目录树显示加载提示）
  let dirContent: { name: string; type: "file" | "dir"; path: string }[] = [];
  try {
    const dirents = await readdir(managed.cwd, { withFileTypes: true });
    dirContent = dirents
      .map((d) => ({ name: d.name, type: d.isDirectory() ? ("dir" as const) : ("file" as const), path: path.join(managed.cwd, d.name) }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  } catch { /* 根目录不可读，留空 */ }
  return {
    type: "session_opened",
    sessionId: managed.sessionId,
    cwd: managed.cwd,
    sessionFile: managed.sessionManager.getSessionFile(),
    messages: allMsgs.slice(offset),
    messageTotal: allMsgs.length,
    messageOffset: offset,
    model: store.getModelInfo(managed.sessionId) ?? { provider: "", id: "", name: "" },
    contextUsage: store.getContextUsage(managed.sessionId),
    timing: managed.openTiming,
    dirContent,
    commands: store.getCommands(managed.sessionId),
  };
}

// cwd 是否在允许的根目录（含子目录）内。roots 为 null/空表示不限制（完全放开，靠网络层认证，见 ADR-009）。
// Windows 路径大小写不敏感，统一转小写比对。
function isUnderRoots(cwd: string, roots: string[] | null): boolean {
  if (!roots || roots.length === 0) return true;
  const norm = path.resolve(cwd).toLowerCase();
  return roots.some((r) => {
    const root = path.resolve(r).toLowerCase();
    return norm === root || norm.startsWith(root + path.sep);
  });
}

// 处理单个 WebSocket 连接。一个连接可同时订阅多个会话（多 tab）。
export function handleConnection(
  ws: WebSocket,
  store: SessionStore,
  allowedDirs: string[] | null,
) {
  // 本连接订阅的会话：sessionId -> 转发函数
  const subscriptions = new Map<string, (msg: ServerMessage) => void>();

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) {
      // try/catch 必需：pi 的 _emit 对 listener 抛错零防护，ws.send 一旦抛错（连接半开/底层 socket 异常）
      // 会抛穿 _emit、中断 agent 后续事件分发（message_end/agent_settled 全丢）。心跳会检测半开并清理。
      try { ws.send(JSON.stringify(msg)); } catch { /* 连接异常，静默丢弃 */ }
    }
  };

  // 刷新恢复：自动订阅所有活跃 session（确保正在运行的 agent 的后续 event 能到达）+ 发送列表
  const active = store.listActive();
  for (const info of active) {
    const fn = (m: ServerMessage) => send(m);
    subscriptions.set(info.sessionId, fn);
    store.subscribe(info.sessionId, fn);
  }
  if (active.length > 0) send({ type: "sessions_active", sessions: active });

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ type: "error", message: "无效的 JSON" });
    }

    try {
      switch (msg.type) {
        case "list_dirs":
          send({ type: "dirs", dirs: allowedDirs ?? [] });
          break;

        case "open_session": {
          if (!isUnderRoots(msg.cwd, allowedDirs)) {
            return send({ type: "error", message: `目录不在允许范围: ${msg.cwd}` });
          }
          let managed;
          if (msg.sessionId) {
            // 重连场景：按 sessionId 精确恢复（不能用 continueRecent——它会返回 cwd 下最近 session，
            // 可能 ≠ 前端的 sid，导致「对话不存在」）
            managed = store.get(msg.sessionId) ?? (await store.openBySessionId(msg.cwd, msg.sessionId));
            if (!managed) {
              return send({ type: "error", message: "该会话未找到（可能已过期），请新建会话", sessionId: msg.sessionId });
            }
          } else {
            managed = await store.create(msg.cwd);
          }
          // 订阅该会话的事件（幂等：已订阅则跳过）
          if (!subscriptions.has(managed.sessionId)) {
            const fn = (m: ServerMessage) => send(m);
            subscriptions.set(managed.sessionId, fn);
            store.subscribe(managed.sessionId, fn);
          }
          send(await buildSessionOpened(store, managed));
          break;
        }

        case "close_session": {
          const fn = subscriptions.get(msg.sessionId);
          if (fn) {
            store.unsubscribe(msg.sessionId, fn);
            subscriptions.delete(msg.sessionId);
          }
          // 释放后端会话（ADR-003）。用户关 tab 即意图释放：idle 会话立即 dispose，
          // streaming 会话让 agent 跑完再由 sweepIdle 回收（design.md 异步执行，不强杀）。
          store.releaseSession(msg.sessionId);
          send({ type: "session_closed", sessionId: msg.sessionId });
          break;
        }

        case "prompt": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在", sessionId: msg.sessionId });
          // agent 工作中时 SDK 的 prompt 会抛 "Agent is already processing"，
          // 自动降级为 steer（不打断当前工作）。前端 streaming 状态可能和后端不同步（WS 重连等），后端兜底最稳。
          if (m.session.isStreaming) {
            await m.session.steer(msg.message);
          } else {
            await m.session.prompt(msg.message);
          }
          break;
        }
        case "steer": {
          const m = store.get(msg.sessionId);
          if (m) await m.session.steer(msg.message);
          break;
        }
        case "follow_up": {
          const m = store.get(msg.sessionId);
          if (m) await m.session.followUp(msg.message);
          break;
        }
        case "abort": {
          const m = store.get(msg.sessionId);
          if (m) await m.session.abort();
          break;
        }

        case "read_file": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在" });
          const resolved = path.resolve(m.cwd, msg.path);
          const rel = path.relative(m.cwd, resolved);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return send({ type: "error", message: `路径越界（须在 ${m.cwd} 内）` });
          }
          try {
            const ext = path.extname(resolved).slice(1).toLowerCase();
            if (BINARY_EXTS.has(ext)) {
              return send({ type: "file_content", path: resolved, content: `（.${ext || "无扩展名"} 是二进制文件，不支持预览）` });
            }
            const st = await stat(resolved);
            if (st.size > MAX_PREVIEW_SIZE) {
              return send({ type: "file_content", path: resolved, content: `（文件 ${(st.size / 1024).toFixed(0)} KB，超过预览上限 1 MB）` });
            }
            const buf = await readFile(resolved);
            if (buf.includes(0)) {
              return send({ type: "file_content", path: resolved, content: `（检测到二进制内容，不支持预览）` });
            }
            send({ type: "file_content", path: resolved, content: buf.toString("utf8") });
          } catch (e) {
            send({ type: "error", message: `读取失败: ${e instanceof Error ? e.message : e}` });
          }
          break;
        }

        case "list_dir": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在" });
          const target = msg.path ? path.resolve(m.cwd, msg.path) : m.cwd;
          const rel = path.relative(m.cwd, target);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return send({ type: "error", message: `路径越界（须在 ${m.cwd} 内）` });
          }
          try {
            const dirents = await readdir(target, { withFileTypes: true });
            const entries = dirents
              .map((d) => ({ name: d.name, type: d.isDirectory() ? ("dir" as const) : ("file" as const), path: path.join(target, d.name) }))
              .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
            send({ type: "dir_content", sessionId: msg.sessionId, path: target, entries });
          } catch (e) {
            send({ type: "error", message: `列目录失败: ${e instanceof Error ? e.message : e}` });
          }
          break;
        }

        case "browse_dir": {
          // 不绑定会话的目录浏览（ADR-009 规划），越界用 isUnderRoots 拦截。
          // 无 path：返回「根列表」——allowedDirs 或系统盘符（Windows C-Z）/ 根目录（其他平台）。
          // 这样能跨盘符：从根列表进任意盘，盘符根的上级回到根列表。
          if (!msg.path) {
            let roots: { name: string; path: string }[];
            if (allowedDirs && allowedDirs.length > 0) {
              roots = allowedDirs.map((r) => ({ name: r.split(/[\\/]/).pop() || r, path: r }));
            } else if (process.platform === "win32") {
              roots = [];
              for (let c = 67; c <= 90; c++) { // C-Z（跳过 A/B 软驱）
                const letter = String.fromCharCode(c);
                const drive = `${letter}:\\`;
                try { await access(drive); roots.push({ name: `${letter}:`, path: drive }); } catch { /* 盘符不存在 */ }
              }
            } else {
              roots = [{ name: "/", path: "/" }];
            }
            send({ type: "browse_result", path: "", parent: null, dirs: roots });
            break;
          }
          const target = path.resolve(msg.path);
          if (!isUnderRoots(target, allowedDirs)) {
            return send({ type: "error", message: `目录不在允许范围: ${target}` });
          }
          try {
            const dirents = await readdir(target, { withFileTypes: true });
            const dirs = dirents
              .filter((d) => d.isDirectory() && !d.name.startsWith("."))
              .map((d) => ({ name: d.name, path: path.join(target, d.name) }))
              .sort((a, b) => a.name.localeCompare(b.name));
            // 上级：盘符根 → ""（回根列表）；否则 dirname（越界则 null）
            const isDriveRoot = /^[A-Za-z]:\\$/.test(target);
            const parent = isDriveRoot ? "" : (isUnderRoots(path.dirname(target), allowedDirs) ? path.dirname(target) : null);
            send({ type: "browse_result", path: target, parent, dirs });
          } catch (e) {
            send({ type: "error", message: `浏览失败: ${e instanceof Error ? e.message : e}` });
          }
          break;
        }

        case "list_commands":
          send({ type: "commands", sessionId: msg.sessionId, commands: store.getCommands(msg.sessionId) });
          break;
        case "list_models":
          send({ type: "models", sessionId: msg.sessionId, models: await store.listModels() });
          break;
        case "set_model": {
          const model = await store.setModel(msg.sessionId, msg.provider, msg.modelId);
          send({ type: "model_changed", sessionId: msg.sessionId, model });
          break;
        }
        case "compact": {
          const m = store.get(msg.sessionId);
          if (m) await m.session.compact();
          break;
        }
        case "reload_session": {
          // 重载当前会话的扩展/skills/prompts（保留对话历史）。reload 后刷新命令列表推给前端。
          try {
            const commands = await store.reloadSession(msg.sessionId);
            send({ type: "reloaded", sessionId: msg.sessionId, commands });
          } catch (err) {
            send({ type: "error", message: `reload 失败: ${err instanceof Error ? err.message : String(err)}`, sessionId: msg.sessionId });
          }
          break;
        }
        case "set_thinking": {
          const m = store.get(msg.sessionId);
          if (m) { m.session.setThinkingLevel(msg.level as any); send({ type: "thinking_changed", sessionId: msg.sessionId, level: msg.level }); }
          break;
        }
        case "list_sessions": {
          const sessions = await SessionManager.list(msg.cwd);
          send({
            type: "sessions_list",
            cwd: msg.cwd,
            sessions: sessions.map((s) => ({ path: s.path, name: s.name, modified: s.modified.toISOString(), messageCount: s.messageCount, firstMessage: s.firstMessage })),
          });
          break;
        }
        case "open_history": {
          if (!isUnderRoots(msg.cwd, allowedDirs)) {
            return send({ type: "error", message: `目录不在允许范围: ${msg.cwd}` });
          }
          // 刷新恢复：先查是否有同 path 的活跃 session（agent 可能还在运行），有则复用不新建
          const managed = store.findBySessionFile(msg.path) ?? await store.openHistory(msg.cwd, msg.path);
          if (!subscriptions.has(managed.sessionId)) {
            const fn = (m: ServerMessage) => send(m);
            subscriptions.set(managed.sessionId, fn);
            store.subscribe(managed.sessionId, fn);
          }
          send(await buildSessionOpened(store, managed));
          break;
        }
        case "list_entries": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在" });
          send({ type: "entries_tree", sessionId: msg.sessionId, tree: m.sessionManager.getTree().map(simplifyNode), leafId: m.sessionManager.getLeafId() });
          break;
        }
        case "navigate": {
          const m = store.get(msg.sessionId);
          if (m) {
            await m.session.navigateTree(msg.targetId);
            send(await buildSessionOpened(store, m));
          }
          break;
        }
        case "fork": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在" });
          const newPath = m.sessionManager.createBranchedSession(msg.entryId);
          if (!newPath) return send({ type: "error", message: "分叉失败" });
          const newManaged = await store.openHistory(m.cwd, newPath);
          if (!subscriptions.has(newManaged.sessionId)) {
            const fn = (mm: ServerMessage) => send(mm);
            subscriptions.set(newManaged.sessionId, fn);
            store.subscribe(newManaged.sessionId, fn);
          }
          send(await buildSessionOpened(store, newManaged));
          break;
        }

        case "load_earlier": {
          // 分页：返回 [max(0, before-PAGE), before) 的消息片段
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在" });
          const all = m.session.messages;
          const end = Math.min(msg.before, all.length);
          const start = Math.max(0, end - MSG_PAGE_SIZE);
          send({ type: "earlier_messages", sessionId: msg.sessionId, messages: all.slice(start, end), offset: start, hasMore: start > 0 });
          break;
        }

        default:
          send({ type: "error", message: "未知消息类型" });
      }
    } catch (e) {
      // session 相关操作（prompt/steer/compact 等）的错误带上 sessionId，
      // 前端会在消息流时间线里显示（和 TUI 一致）；无 sessionId 的走 globalError。
      const message = e instanceof Error ? e.message : String(e);
      const sessionId = "sessionId" in msg ? (msg as any).sessionId as string | undefined : undefined;
      send({ type: "error", message, sessionId });
    }
  });

  ws.on("error", (err) => {
    console.error("[ws] 连接错误:", err.message);
  });
  ws.on("close", () => {
    for (const [sid, fn] of subscriptions) store.unsubscribe(sid, fn);
  });
}
