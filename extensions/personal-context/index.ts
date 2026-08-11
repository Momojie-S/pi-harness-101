/**
 * personal-context —— 项目级个人本地 system prompt 注入
 *
 * pi 原生加载 `<cwd>/AGENTS.md`（团队共享）和 `~/.pi/agent/AGENTS.md`（全局），
 * 但不加载项目级**个人本地**配置。本扩展读取 `<cwd>/AGENTS.local.md`，
 * 追加到 systemPrompt 尾部，填补「项目本地」这一层（对齐 Claude Code 的 .local 模式）。
 *
 * 用法：项目根放 `AGENTS.local.md`（自行 gitignore），内容自动注入。
 * 设计依据：docs/design/design.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const localPath = join(ctx.cwd, "AGENTS.local.md");
    let content: string;
    try {
      content = readFileSync(localPath, "utf-8").trim();
    } catch {
      return; // 文件不存在 → 静默跳过
    }
    if (!content) return; // 空文件 → 跳过
    return {
      systemPrompt: `${event.systemPrompt}\n\n${content}`,
    };
  });
}
