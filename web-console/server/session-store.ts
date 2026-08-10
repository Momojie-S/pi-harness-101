import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ServerMessage } from "./types.ts";

// 一个 pi 会话（按 sessionId 管理，支持同目录多会话并发）
export interface ManagedSession {
  session: AgentSession;
  sessionManager: SessionManager;
  cwd: string;
  sessionId: string;
  // 可用的斜杠命令（skills + prompts），供前端 / 自动补全
  commands: { name: string; description?: string }[];
  subscribers: Set<(msg: ServerMessage) => void>;
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
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd,
      model,
      modelRuntime: this.modelRuntime,
      sessionManager,
      resourceLoader: loader,
    });

    // runtime.getCommands() 已汇总 extension + prompt + skill 三种命令
    //（见 AgentSession._bindExtensionCore），直接用，勿再手动拼 skill/prompt（会重复）
    const commands = extensionsResult.runtime
      .getCommands()
      .map((c: any) => ({ name: c.name, description: c.description }));

    const managed: ManagedSession = { session, sessionManager, cwd, sessionId: session.sessionId, commands, subscribers: new Set() };
    // 订阅事件，广播给所有订阅者（事件带 sessionId，前端按此路由）
    session.subscribe((event) => {
      const msg: ServerMessage = { type: "agent_event", sessionId: managed.sessionId, event };
      for (const sub of managed.subscribers) sub(msg);
    });
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

  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  getCommands(sessionId: string): { name: string; description?: string }[] {
    return this.sessions.get(sessionId)?.commands ?? [];
  }

  async listModels(): Promise<{ provider: string; id: string; name: string }[]> {
    const models = await this.modelRuntime.getAvailable();
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name }));
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<{ name: string }> {
    const m = this.sessions.get(sessionId);
    if (!m) throw new Error("会话不存在");
    const model = this.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`模型未找到: ${provider}/${modelId}`);
    await m.session.setModel(model);
    return { name: model.name };
  }

  subscribe(sessionId: string, fn: (msg: ServerMessage) => void) {
    this.sessions.get(sessionId)?.subscribers.add(fn);
  }

  unsubscribe(sessionId: string, fn: (msg: ServerMessage) => void) {
    this.sessions.get(sessionId)?.subscribers.delete(fn);
  }
}
