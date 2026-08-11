// 服务自重启：agent 通过 restart_server 工具触发，spawn 接班进程 + 强制退出自己。
// 接班进程启动时补 toolResult + 恢复 session + agent.continue()，让 agent 循环自然继续。
// 设计依据：docs/design/modules/restart.md
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionStore } from "./session-store.ts";

/**
 * web-console 专属临时目录（系统临时目录下）。
 * 后续所有运行时临时文件（restart-pending 等）都放这里，不污染项目目录。
 */
export const TEMP_DIR = path.join(os.tmpdir(), "pi-web-console");

/** 重启待恢复标记文件。接班进程启动时读它，处理完删除。 */
const PENDING_FILE = path.join(TEMP_DIR, "restart-pending.json");

/** 待恢复的重启请求（持久化到 PENDING_FILE） */
export interface RestartPending {
  /** 触发重启的 session（agent 所在会话） */
  sessionId: string;
  /** 该 session 的 jsonl 文件路径（接班进程要往里补 toolResult） */
  sessionFile: string;
  /** 悬空的 toolCallId（restart_server 工具调用，无 result） */
  toolCallId: string;
  /** session 的工作目录 */
  cwd: string;
  triggeredAt: number;
}

export function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function writePending(p: RestartPending): void {
  ensureTempDir();
  fs.writeFileSync(PENDING_FILE, JSON.stringify(p, null, 2));
}

export function readPending(): RestartPending | null {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    fs.unlinkSync(PENDING_FILE);
  } catch {
    /* 已不存在 */
  }
}

/** 重启是否已触发（防并发：多个 session 同时调 restart_server 只处理第一个） */
let restartTriggered = false;

/** 标记重启已触发。返回 false 表示已有重启在进行中，调用方应拒绝。 */
export function tryTriggerRestart(): boolean {
  if (restartTriggered) return false;
  restartTriggered = true;
  return true;
}

/**
 * spawn 接班进程（继承当前 Session + 环境变量，带 EADDRINUSE 重试等端口释放）。
 * detached + unref：父进程退出后子进程继续运行。
 */
export function spawnReplacement(): void {
  // 用绝对路径，不依赖 process.cwd()（服务可能不从 web-console 目录启动）。
  // tsx 的 package.json exports 不暴露 ./dist/cli.mjs 子路径，不能用 require.resolve，
  // 直接构造文件路径（import.meta.dirname = server/，tsx 在 ../node_modules/）。
  const webConsoleDir = path.resolve(import.meta.dirname, "..");
  const serverEntry = path.resolve(import.meta.dirname, "index.ts");
  const tsxCli = path.join(webConsoleDir, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(
    process.execPath,
    [tsxCli, serverEntry],
    { detached: true, stdio: "ignore", cwd: webConsoleDir, env: process.env },
  );
  child.unref();
}

/**
 * 接班进程启动时的恢复逻辑：
 * 1. 读 pending（没有说明是正常启动，跳过）
 * 2. 往 session 文件补 toolResult（"web 服务已重启完成"）
 * 3. 恢复 session（createAgentSession，读到补的 toolResult）
 * 4. agent.continue()——agent 看到 toolResult 后自然回复用户
 * 5. 放进 SessionStore（前端重连 open_session 时直接复用）
 * 6. 删 pending
 *
 * 补 toolResult 必须在 createAgentSession 之前：恢复时 buildSessionContext 读到
 * assistant(toolCall)→toolResult，agent.state 最后一条才是 toolResult，continue() 才合法。
 */
export async function recoverPendingSession(store: SessionStore): Promise<void> {
  const pending = readPending();
  if (!pending) return;

  console.log(`[web-console] 检测到重启待恢复: session ${pending.sessionId.slice(-8)}`);

  try {
    // 1. 补 toolResult 到 session 文件
    //    幂等：先检查该 toolCallId 是否已有 result（防崩溃后重复追加）。
    //    同时处理同一 assistant 轮次里的其他悬空 toolCall（理论上 agent 可能在一轮里
    //    同时调用 restart_server + 其他工具，它们的结果会随进程退出丢失）。
    const sm = SessionManager.open(pending.sessionFile);
    const entries = sm.getEntries();
    const existingResults = new Set(
      entries.filter((e) => e.type === "message" && (e as any).message?.role === "toolResult")
             .map((e) => (e as any).message.toolCallId),
    );
    // 找最后一条 assistant 的所有 toolCall
    const branch = sm.buildSessionContext().messages;
    const lastAssistant = [...branch].reverse().find((m: any) => m.role === "assistant");
    const pendingCalls = (lastAssistant?.content as any[] | undefined ?? [])
      .filter((c) => c?.type === "toolCall" && !existingResults.has(c.id));
    for (const tc of pendingCalls) {
      const isRestart = tc.name === "restart_server";
      sm.appendMessage({
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: isRestart ? "web 服务已重启完成，接班进程已接管。" : "（服务重启，此工具结果丢失）" }],
        isError: !isRestart,
        timestamp: Date.now(),
      });
    }
    if (pendingCalls.length === 0) {
      console.log(`[web-console] 无悬空 toolCall（已处理过？），跳过补 result`);
    }

    // 2. 恢复 session（读到补的 toolResult，agent.state 最后一条 = toolResult）
    const managed = await store.restoreFromSessionManager(pending.cwd, sm);
    console.log(`[web-console] session 恢复成功: ${managed.sessionId.slice(-8)}`);

    // 不自动 agent.continue()：否则 agent 看到 toolResult 后可能再次调用 restart_server，
    // 陷入重启自循环。只补 toolResult 让 session 状态完整（不悬空），用户看到「重启完成」后
    // 自己发下一条消息时，agent 自然继续（看到 toolResult + 新消息）。

    // 3. 清 pending
    clearPending();
  } catch (e) {
    console.error(`[web-console] 重启恢复失败 (session ${pending.sessionId.slice(-8)}, file ${pending.sessionFile}):`, e instanceof Error ? e.message : e);
    // 失败也清 pending，避免下次启动重复尝试。session 文件已含 toolResult（数据完整），
    // 但 agent 不会自动 continue——用户需手动再发一条消息触发。详见 restart.md §I7。
    clearPending();
  }
}
