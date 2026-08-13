import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextUsagePayload, ModelIdentity, ServerMessage } from "./types.ts";
import { spawnReplacement, tryTriggerRestart, writePending } from "./restart.ts";

/** 从消息列表提取摘要（首条 user 文本）。与前端 getSummary 同口径——
 *  刷新恢复时 sessions_active 带回，让侧边栏立即显示摘要而不用等 messages 加载。 */
function extractSummary(messages: readonly { role: string; content?: unknown }[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const c = m.content;
    if (c == null) continue;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b?.text ?? "").join("") : "";
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

// 一个 pi 会话（按 sessionId 管理，支持同目录多会话并发）
export interface ManagedSession {
  session: AgentSession;
  sessionManager: SessionManager;
  cwd: string;
  sessionId: string;
  // 可用的斜杠命令（skills + prompts），供前端 / 自动补全
  commands: { name: string; description?: string }[];
  subscribers: Set<(msg: ServerMessage) => void>;
  /** session_start 期间的 notify 缓冲：此时 subscribers 可能还为空（客户端未重连），
   *  notify 先存这里，客户端订阅时 flush（见 subscribe 方法）。 */
  pendingNotices: ServerMessage[];
  /** 打开会话各阶段耗时（诊断用） */
  openTiming?: { loaderMs: number; createMs: number; totalMs: number };
  /** 最后一个订阅者断开的时刻（null = 当前有订阅者）。
   *  sweepIdle 据此回收长期无客户端的会话（ADR-003 空闲回收，防内存泄漏）。
   *  创建时设为 Date.now()（尚未订阅即开始计时），首个订阅者到达时清 null。 */
  idleSince: number | null;
}

// 管理所有活跃会话。设计依据见 docs/design/adr/003（单进程多会话）。
export class SessionStore {
  private sessions = new Map<string, ManagedSession>();

  constructor(
    private modelRuntime: ModelRuntime,
    private modelProvider: string,
    private modelId: string,
  ) {}

  private async initSession(cwd: string, sessionManager: SessionManager): Promise<ManagedSession> {
    const model = this.modelRuntime.getModel(this.modelProvider, this.modelId);
    if (!model) throw new Error(`模型未找到: ${this.modelProvider}/${this.modelId}`);

    // 用 ResourceLoader 发现该 cwd 的 skills/prompts（供 / 命令补全），并复用给 createAgentSession
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    const t0 = performance.now();
    await loader.reload();
    const t1 = performance.now();
    // restart_server 工具：agent 可调用它重启 web 服务。闭包捕获 session 信息，
    // 触发后落盘 pending + spawn 接班 + 退出（execute 永不 resolve，进程直接 exit）。
    const restartTool = this.createRestartTool(sessionManager.getSessionId(), sessionManager.getSessionFile(), cwd);

    const { session, extensionsResult } = await createAgentSession({
      cwd,
      model,
      modelRuntime: this.modelRuntime,
      sessionManager,
      resourceLoader: loader,
      customTools: [restartTool],
    });
    const t2 = performance.now();

    // runtime.getCommands() 已汇总 extension + prompt + skill 三种命令
    //（见 AgentSession._bindExtensionCore），直接用，勿再手动拼 skill/prompt（会重复）
    const commands = extensionsResult.runtime
      .getCommands()
      .map((c: any) => ({ name: c.name, description: c.description }));

    const managed: ManagedSession = { session, sessionManager, cwd, sessionId: session.sessionId, commands, subscribers: new Set(), pendingNotices: [], openTiming: { loaderMs: Math.round(t1 - t0), createMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0) }, idleSince: Date.now() };
    // 订阅事件，广播给所有订阅者（事件带 sessionId，前端按此路由）
    session.subscribe((event) => {
      const msg: ServerMessage = { type: "agent_event", sessionId: managed.sessionId, event };
      // try/catch 每个 sub：pi 的 _emit 对 listener 抛错零防护（for 循环裸调），
      // 一个 sub 抛错会中断本次事件给后续 sub 的分发，更糟的是抛穿 _emit 可能波及 agent 主流程。
      for (const sub of managed.subscribers) {
        try { sub(msg); } catch { /* 单个订阅者失败不影响其他 / 不中断 session 事件流 */ }
      }
      // 每轮结束后推送 context 占用（getContextUsage 是实时计算的，此时刚好刷新）
      if (event.type === "agent_settled") {
        const usage = this.getContextUsage(managed.sessionId);
        if (usage) {
          const cuMsg: ServerMessage = { type: "context_usage", sessionId: managed.sessionId, usage };
          for (const sub of managed.subscribers) {
            try { sub(cuMsg); } catch { /* 同上 */ }
          }
        }
      }
    });
    // web-console 注入 UIContext：让扩展的 ctx.ui.notify 能转发到前端（默认 noOpUIContext 下 hasUI=false，
    // 所有扩展的 notify 都走 console.log 用户看不到）。这里注入最小 UIContext：notify → 广播 ui_notify 消息；
    // 其余方法 no-op（后续按需支持 select/confirm/setStatus/setWidget 等，见 docs/design/modules/extension-ui.md）。
    // mode 设为 "rpc"（非 tui，扩展用它守护终端专用 UI）。
    const broadcast = (msg: ServerMessage) => {
      for (const sub of managed.subscribers) {
        try { sub(msg); } catch { /* 单个订阅者失败不影响其他 */ }
      }
    };
    const webConsoleUIContext = {
      notify: (message: string, level: "info" | "warning" | "error" = "info") => {
        const msg: ServerMessage = { type: "ui_notify", sessionId: managed.sessionId, message, level };
        if (managed.subscribers.size === 0) {
          managed.pendingNotices.push(msg);
        } else {
          broadcast(msg);
        }
      },
      // 以下暂为 no-op（后续按需实现，见 extension-ui.md）
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      onTerminalInput: () => () => {},
      setStatus: (key: string, text: string | undefined) => {
        broadcast({ type: "ui_set_status", sessionId: managed.sessionId, key, text: text ?? undefined });
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      custom: async () => undefined,
      editor: async () => undefined,
      setEditorText: () => {},
    };
    await session.bindExtensions({ uiContext: webConsoleUIContext as any, mode: "rpc" });

    this.sessions.set(managed.sessionId, managed);
    return managed;
  }

  async create(cwd: string): Promise<ManagedSession> {
    return this.initSession(cwd, SessionManager.create(cwd));
  }

  async continueRecent(cwd: string): Promise<ManagedSession> {
    return this.initSession(cwd, SessionManager.continueRecent(cwd));
  }

  async openHistory(cwd: string, path: string): Promise<ManagedSession> {
    return this.initSession(cwd, SessionManager.open(path));
  }

  /**
   * 按 sessionId 精确恢复会话（用于重启后前端重连：store miss 时按 sid 查文件，
   * 而非 continueRecent 返回错误的最近 session）。找不到返回 null。
   */
  async openBySessionId(cwd: string, sessionId: string): Promise<ManagedSession | null> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const sessions = await SessionManager.list(cwd);
    const match = sessions.find((s: any) => s.id === sessionId);
    if (!match) return null;
    return this.initSession(cwd, SessionManager.open(match.path));
  }

  /** 从已有的 SessionManager 恢复会话（用于重启后的接班进程） */
  async restoreFromSessionManager(cwd: string, sessionManager: SessionManager): Promise<ManagedSession> {
    return this.initSession(cwd, sessionManager);
  }

  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** 按 sessionFile 查找活跃会话（刷新恢复：open_history 时复用正在运行的 session，不新建） */
  findBySessionFile(path: string): ManagedSession | undefined {
    for (const [, m] of this.sessions) {
      if (m.sessionManager.getSessionFile() === path) return m;
    }
    return undefined;
  }

  getCommands(sessionId: string): { name: string; description?: string }[] {
    return this.sessions.get(sessionId)?.commands ?? [];
  }

  /** 重载会话的扩展/skills/prompts（保留对话历史，只换 runtime）。
   *  pi 的 AgentSession.reload() 重读 settings + resourceLoader、重建 runtime、触发 session_start。
   *  reload 后命令列表会变（新扩展的命令），重新拉取并更新 ManagedSession。 */
  async reloadSession(sessionId: string): Promise<{ name: string; description?: string }[]> {
    const m = this.sessions.get(sessionId);
    if (!m) return [];
    await m.session.reload();
    // reload 重建了 _extensionRunner，重新拉取命令列表
    //（_extensionRunner 是 TS private，JS 可访问；getCommands 是 ExtensionRunner 的方法）
    const runner = (m.session as any)._extensionRunner;
    if (runner?.getCommands) {
      m.commands = runner.getCommands().map((c: any) => ({ name: c.name, description: c.description }));
    }
    return m.commands;
  }

  async listModels(): Promise<{ provider: string; id: string; name: string }[]> {
    const models = await this.modelRuntime.getAvailable();
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name }));
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<ModelIdentity> {
    const m = this.sessions.get(sessionId);
    if (!m) throw new Error("会话不存在");
    const model = this.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`模型未找到: ${provider}/${modelId}`);
    await m.session.setModel(model);
    return { provider: model.provider, id: model.id, name: model.name };
  }

  /** 当前模型标识（供 session_opened 携带、状态栏展示） */
  getModelInfo(sessionId: string): ModelIdentity | null {
    const m = this.sessions.get(sessionId)?.session.model;
    if (!m) return null;
    return { provider: m.provider, id: m.id, name: m.name };
  }

  /** 当前 context 占用（实时计算，每轮结束后刷新） */
  getContextUsage(sessionId: string): ContextUsagePayload | null {
    const cu = this.sessions.get(sessionId)?.session.getContextUsage();
    if (!cu) return null;
    return { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent };
  }

  subscribe(sessionId: string, fn: (msg: ServerMessage) => void) {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    m.subscribers.add(fn);
    m.idleSince = null; // 有订阅者，取消空闲计时
    // flush session_start 期间缓冲的 notify（客户端刚连上）
    if (m.pendingNotices.length > 0) {
      for (const msg of m.pendingNotices) {
        try { fn(msg); } catch {}
      }
      m.pendingNotices = [];
    }
  }

  unsubscribe(sessionId: string, fn: (msg: ServerMessage) => void) {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    m.subscribers.delete(fn);
    // 最后一个订阅者断开后开始计空闲（sweepIdle 据此回收长期无客户端的会话，防内存泄漏）
    if (m.subscribers.size === 0) m.idleSince = Date.now();
  }

  /** 移除并释放会话（内部方法，由 releaseSession / sweepIdle 调用）。dispose 释放 SDK 资源（eventListeners、
   *  agent subscribe、extensionRunner、abort controllers），再从 Map 删除让它可被 GC。
   *  调用方须确保会话非 streaming（强 dispose 会 abort 正在跑的 agent）。 */
  removeSession(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    try {
      m.session.dispose();
    } catch (e) {
      console.error(`[web-console] dispose 会话 ${sessionId.slice(-8)} 失败:`, e instanceof Error ? e.message : e);
    }
    this.sessions.delete(sessionId);
  }

  /** 释放会话（用户关闭 tab 触发）：idle 会话立即 dispose；streaming 会话让 agent 跑完再由
   *  sweepIdle 回收。design.md 核心机制「异步执行」：agent 独立执行不依赖客户端连接，
   *  关 tab 不应终止正在进行的 agent 工作（强 dispose 会 abort + 丢工作）。 */
  releaseSession(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    if (m.session.isStreaming) return; // agent 运行中：不回收，idle 计时已由 unsubscribe 设置，跑完后 sweep 回收
    this.removeSession(sessionId);    // idle：立即释放
  }

  /** 空闲回收（ADR-003）：释放「无订阅者 + 非运行中 + 超过 idleMs」的会话。返回回收数量。
   *  不回收正在 streaming 的会话（agent 在跑，强回收会丢工作）。
   *  会话已落盘（jsonl），回收后用户重连 open_session 从磁盘重新加载，数据不丢。 */
  sweepIdle(idleMs: number): number {
    const now = Date.now();
    let released = 0;
    for (const [sid, m] of this.sessions) {
      if (m.idleSince === null) continue;       // 当前有客户端连着，不回收
      if (m.session.isStreaming) continue;        // agent 运行中，不回收
      if (now - m.idleSince < idleMs) continue;   // 还没到空闲阈值
      try {
        m.session.dispose();
      } catch (e) {
        console.error(`[web-console] sweepIdle dispose ${sid.slice(-8)} 失败:`, e instanceof Error ? e.message : e);
      }
      this.sessions.delete(sid);
      released++;
      console.log(`[web-console] 空闲回收会话 ${sid.slice(-8)}（cwd ${m.cwd}，空闲 ${Math.round((now - m.idleSince!) / 60000)}min）`);
    }
    return released;
  }

  /** 列出所有活跃 session（供 WS 重连恢复） */
  listActive(): { sessionId: string; cwd: string; sessionFile: string | undefined; streaming: boolean; summary: string; messages: unknown[]; messageTotal: number; messageOffset: number; model: ModelIdentity | null }[] {
    return Array.from(this.sessions.values()).map((m) => {
      const allMsgs = m.session.messages;
      const offset = Math.max(0, allMsgs.length - 10); // sessions_active 只带最近 10 条（给所有会话，条数多了首屏传输慢）；完整 50 条由 session_opened 后台补
      return {
        sessionId: m.sessionId,
        cwd: m.cwd,
        sessionFile: m.sessionManager.getSessionFile(),
        streaming: m.session.isStreaming,
        summary: extractSummary(allMsgs),
        // 带回首屏 messages：前端切换会话即时显示，不用等 open_session 往返（frp 抖动下多个 session_opened 串行是「加载不出来」的根因）
        messages: allMsgs.slice(offset),
        messageTotal: allMsgs.length,
        messageOffset: offset,
        model: this.getModelInfo(m.sessionId),
      };
    });
  }

  /**
   * 创建 restart_server 自定义工具。闭包捕获 session 信息，
   * agent 调用时：落盘 pending → 广播 restarting → spawn 接班 → 退出。
   */
  private createRestartTool(sessionId: string, sessionFile: string | undefined, cwd: string): ToolDefinition {
    return {
      name: "restart_server",
      label: "重启 web 服务",
      description: "重启 web-console 后端服务（部署后、更新代码后使用）。重启过程中连接会短暂断开，接班进程接管后会自动恢复并通知完成。",
      parameters: Type.Object({}),
      execute: async (toolCallId) => {
        if (!sessionFile) throw new Error("当前会话未持久化，无法重启恢复");
        // 并发保护：多个 session 同时触发 restart 只处理第一个
        if (!tryTriggerRestart()) {
          throw new Error("服务正在重启中（已被其他会话触发），请稍后重连");
        }
        console.log(`[web-console] agent 触发服务重启: session ${sessionId.slice(-8)}`);
        // 1. 落盘 pending（接班进程启动时读它补 toolResult）
        writePending({ sessionId, sessionFile, toolCallId, cwd, triggeredAt: Date.now() });
        // 2. 广播 restarting 给所有 WS 客户端（重启是全局的，所有 session 都会断）
        for (const [, m] of this.sessions) {
          const msg: ServerMessage = { type: "restarting", sessionId: m.sessionId };
          for (const sub of m.subscribers) sub(msg);
        }
        // 3. spawn 接班 + 退出。同步执行，不依赖 async/await（避免被 pi 的工具执行循环卡住）。
        spawnReplacement();
        console.log(`[web-console] 接班进程已 spawn，200ms 后退出`);
        // 给 spawn 完成的时间，然后强制退出
        setTimeout(() => {
          console.log(`[web-console] 强制退出当前进程`);
          // process.exit(0) 可能被 tsx loader/preflight hook 拦截导致 hang。
          // process.kill(SIGKILL) 更强制（Windows 上等价 TerminateProcess）。
          process.kill(process.pid, "SIGKILL");
        }, 200);
        // execute 永不 resolve——进程会被上面的 kill 终止。
        return new Promise<never>(() => {});
      },
    };
  }
}
