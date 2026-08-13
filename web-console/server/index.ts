import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SessionStore } from "./session-store.ts";
import { handleConnection } from "./ws.ts";
import { recoverPendingSession, TEMP_DIR } from "./restart.ts";
import { writeHeapSnapshot } from "node:v8";
import fs from "node:fs";

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

  // 会话空闲回收（ADR-003）：定期释放无客户端订阅且非运行中的会话，防内存泄漏。
  // 单进程多会话，不回收则只增不减，长跑必 OOM（曾实测接班进程 11.5 分钟涨满 4GB 崩溃）。
  // 会话已落盘，回收后用户重连 open_session 从磁盘重新加载，数据不丢。
  // WC_SESSION_IDLE_MS 可调超时（默认 2h）；设 0 关闭回收。
  const IDLE_SWEEP_INTERVAL = 5 * 60_000;                              // 每 5 分钟扫描一次
  const SESSION_IDLE_TIMEOUT = Number(process.env.WC_SESSION_IDLE_MS ?? 2 * 60 * 60_000); // 默认 2h
  if (SESSION_IDLE_TIMEOUT > 0) {
    setInterval(() => {
      const released = store.sweepIdle(SESSION_IDLE_TIMEOUT);
      if (released > 0) console.log(`[web-console] 空闲回收 ${released} 个会话`);
    }, IDLE_SWEEP_INTERVAL);
  }

  // 内存监控 + 堆快照（定位 OOM 增长项）：
  // - 每 30s 记 memoryUsage（轻量，看增长曲线）
  // - heapUsed 超 1.5GB 后，每再涨 500MB 抓一份完整堆快照（最多 5 份），覆盖 OOM 前趋势。
  //   writeHeapSnapshot 对大堆慢（秒级阻塞），故只在危险水位抓，不频繁抓。
  // - 启动时清理上次遗留的快照（防磁盘堆积）。快照在 %TEMP%\pi-web-console\heap-*.heapsnapshot。
  try {
    for (const f of fs.readdirSync(TEMP_DIR)) {
      if (f.startsWith("heap-") && f.endsWith(".heapsnapshot")) fs.unlinkSync(path.join(TEMP_DIR, f));
    }
  } catch { /* 目录不存在等，忽略 */ }
  const SNAPSHOT_START = 1.5 * 1024 ** 3;
  let nextSnapshotAt = SNAPSHOT_START;
  let snapshotCount = 0;
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    console.log(`[mem] heap=${heapMB}MB rss=${Math.round(mem.rss / 1024 / 1024)}MB external=${Math.round(mem.external / 1024 / 1024)}MB`);
    if (snapshotCount < 5 && mem.heapUsed >= nextSnapshotAt) {
      snapshotCount++;
      const file = path.join(TEMP_DIR, `heap-${snapshotCount}-${heapMB}MB-${Date.now()}.heapsnapshot`);
      console.log(`[mem] 抓堆快照 #${snapshotCount} @${heapMB}MB → ${path.basename(file)}`);
      try { writeHeapSnapshot(file); } catch (e) { console.error("[mem] 快照失败:", e instanceof Error ? e.message : e); }
      nextSnapshotAt += 0.5 * 1024 ** 3;
    }
  }, 30_000);

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
