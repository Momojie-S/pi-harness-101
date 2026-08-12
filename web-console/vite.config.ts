import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev 端口（web 服务统一走 30000 段，见 ops/docs/ports.md「端口规划」）：
//   - dev 后端（tsx）= 30000，由 dev:server 的 cross-env PORT 注入
//   - dev 前端（vite）= 30001（server.port，strictPort）
//   - 线上规划 30002（当前仍 3000）
// dev 前后端均不碰线上，本地 dev 与线上服务可同时运行。
const devBackendPort = process.env.PORT ?? "30000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // dev 前端（vite dev server）固定 30001；strictPort 避免被占时静默跳端口
    port: 30001,
    strictPort: true,
    // 开发时把 /ws 转发到后端（dev 后端 30000），生产环境前端与后端同源
    proxy: {
      "/ws": {
        target: `ws://localhost:${devBackendPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
