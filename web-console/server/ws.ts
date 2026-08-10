import type { WebSocket } from "ws";
import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionStore } from "./session-store.ts";
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

// 处理单个 WebSocket 连接。一个连接可同时订阅多个会话（多 tab）。
export function handleConnection(
  ws: WebSocket,
  store: SessionStore,
  allowedDirs: string[] | null,
) {
  // 本连接订阅的会话：sessionId -> 转发函数
  const subscriptions = new Map<string, (msg: ServerMessage) => void>();

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

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
          if (allowedDirs && !allowedDirs.includes(msg.cwd)) {
            return send({ type: "error", message: `目录不在白名单: ${msg.cwd}` });
          }
          let managed;
          if (msg.sessionId) {
            managed = store.get(msg.sessionId) ?? (await store.continueRecent(msg.cwd));
          } else {
            managed = await store.create(msg.cwd);
          }
          // 订阅该会话的事件（幂等：已订阅则跳过）
          if (!subscriptions.has(managed.sessionId)) {
            const fn = (m: ServerMessage) => send(m);
            subscriptions.set(managed.sessionId, fn);
            store.subscribe(managed.sessionId, fn);
          }
          send({
            type: "session_opened",
            sessionId: managed.sessionId,
            cwd: managed.cwd,
            messages: managed.session.messages,
          });
          break;
        }

        case "close_session": {
          const fn = subscriptions.get(msg.sessionId);
          if (fn) {
            store.unsubscribe(msg.sessionId, fn);
            subscriptions.delete(msg.sessionId);
          }
          send({ type: "session_closed", sessionId: msg.sessionId });
          break;
        }

        case "prompt": {
          const m = store.get(msg.sessionId);
          if (!m) return send({ type: "error", message: "会话不存在", sessionId: msg.sessionId });
          await m.session.prompt(msg.message);
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

        case "list_commands":
          send({ type: "commands", sessionId: msg.sessionId, commands: store.getCommands(msg.sessionId) });
          break;
        case "list_models":
          send({ type: "models", sessionId: msg.sessionId, models: await store.listModels() });
          break;
        case "set_model": {
          const { name } = await store.setModel(msg.sessionId, msg.provider, msg.modelId);
          send({ type: "model_changed", sessionId: msg.sessionId, provider: msg.provider, modelId: msg.modelId, name });
          break;
        }
        case "compact": {
          const m = store.get(msg.sessionId);
          if (m) await m.session.compact();
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
          if (allowedDirs && !allowedDirs.includes(msg.cwd)) {
            return send({ type: "error", message: `目录不在白名单: ${msg.cwd}` });
          }
          const managed = await store.openHistory(msg.cwd, msg.path);
          if (!subscriptions.has(managed.sessionId)) {
            const fn = (m: ServerMessage) => send(m);
            subscriptions.set(managed.sessionId, fn);
            store.subscribe(managed.sessionId, fn);
          }
          send({ type: "session_opened", sessionId: managed.sessionId, cwd: managed.cwd, messages: managed.session.messages });
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
            send({ type: "session_opened", sessionId: msg.sessionId, cwd: m.cwd, messages: m.session.messages });
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
          send({ type: "session_opened", sessionId: newManaged.sessionId, cwd: newManaged.cwd, messages: newManaged.session.messages });
          break;
        }

        default:
          send({ type: "error", message: "未知消息类型" });
      }
    } catch (e) {
      send({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  });

  ws.on("close", () => {
    for (const [sid, fn] of subscriptions) store.unsubscribe(sid, fn);
  });
}
