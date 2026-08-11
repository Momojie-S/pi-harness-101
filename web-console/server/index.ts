import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SessionStore } from "./session-store.ts";
import { handleConnection } from "./ws.ts";

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
// 允许的工作目录（分号分隔）。未设置则允许任意（仅本地/受信网络使用）
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
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      // SPA fallback：非静态资源返回 index.html，交由前端路由
      try {
        const html = await readFile(path.join(DIST_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end("Not found（dist/ 未构建？先 npm run build）");
      }
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => handleConnection(ws, store, ALLOWED_DIRS));

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
