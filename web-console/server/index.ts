import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SessionStore } from "./session-store.ts";
import { handleConnection } from "./ws.ts";
import { recoverPendingSession } from "./restart.ts";

const PORT = Number(process.env.PORT ?? 3000);
// 前端构建产物（vite build → dist/）。生产模式下后端直接 serve，单端口对外。
const DIST_DIR = path.resolve(import.meta.dirname, "..", "dist", "client");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
// 模型配置（provider/id 格式），默认 zai-coding-cn 的 glm-5.2
const WC_MODEL = process.env.WC_MODEL ?? "zai-coding-cn/glm-5.2";
// 工作目录根（分号分隔）：cwd 须在某根的子树内。未设则不限制（完全放开，靠网络层认证）。见 ADR-009
const ALLOWED_DIRS = process.env.ALLOWED_DIRS
  ? process.env.ALLOWED_DIRS
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
  : null;

async function main() {
  console.log("[web-console] 初始化 ModelRuntime...");
  const modelRuntime = await ModelRuntime.create();

  const [provider, modelId] = WC_MODEL.split("/");
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) throw new Error(`模型未找到: ${WC_MODEL}`);
  console.log(`[web-console] 模型: ${model.provider}/${model.id} (${model.name})`);

  const store = new SessionStore(modelRuntime, provider, modelId);

  const server = http.createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // 静态文件 serve（生产：前端 dist/）
    const rel = url === "/" ? "/index.html" : url;
    const filePath = path.join(DIST_DIR, rel);
    const safe = path.relative(DIST_DIR, filePath);
    if (safe.startsWith("..") || path.isAbsolute(safe)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
      // 缓存策略：assets/ 下带 hash 的产物 immutable 长缓存；index.html 等每次验证（no-cache），
      // 确保刷新能拿到最新 hash 引用——否则浏览器启发式缓存旧 index.html，永远加载旧 JS。
      if (rel.startsWith("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
      else headers["Cache-Control"] = "no-cache";
      res.writeHead(200, headers);
      res.end(data);
    } catch {
      // SPA fallback：非静态资源返回 index.html，交由前端路由
      try {
        const html = await readFile(path.join(DIST_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end("Not found（dist/ 未构建？先 npm run build）");
      }
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  // 心跳：30s ping 一次，既保活（防 nginx/frp idle 超时静默断开）又检测半开连接
  //（代理静默断开时 ws 库未必及时触发 close；无 pong 则 terminate，触发前端自动重连恢复）。
  const alive = new WeakSet<WebSocket>();
  const pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) { client.terminate(); continue; }
      alive.delete(client);
      client.ping();
    }
  }, 30_000);
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    handleConnection(ws, store, ALLOWED_DIRS);
  });
  server.on("close", () => clearInterval(pingInterval));

  // 启动时检查是否有重启待恢复（接班进程场景）
  await recoverPendingSession(store);

  // listen 加 EADDRINUSE 重试：重启时老进程刚退出、端口释放有短暂窗口。
  // 有限重试（最多 10 次），避免端口被其他进程永久占用时无限循环。
  let listenRetries = 0;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && listenRetries < 10) {
      listenRetries++;
      console.log(`[web-console] 端口 ${PORT} 被占用，1 秒后重试（${listenRetries}/10）…`);
      setTimeout(() => server.listen(PORT), 1000);
    } else {
      console.error(`[web-console] server error:`, err);
      process.exit(1);
    }
  });
  server.listen(PORT, () => {
    console.log(`[web-console] 服务就绪: http://localhost:${PORT}  (ws: /ws)`);
    console.log(
      `[web-console] 允许目录: ${ALLOWED_DIRS ? ALLOWED_DIRS.join(", ") : "任意（未设 ALLOWED_DIRS）"}`,
    );
  });
}

main().catch((e) => {
  console.error("[web-console] 启动失败:", e);
  process.exit(1);
});
