/**
 * personal-context —— 项目级个人本地 system prompt 注入
 *
 * pi 原生加载 `<cwd>/AGENTS.md`（团队共享）和 `~/.pi/agent/AGENTS.md`（全局），
 * 但不加载项目级**个人本地**配置。本扩展读取 `<cwd>/AGENTS.local.md`，
 * 追加到 systemPrompt 尾部，填补「项目本地」这一层（对齐 Claude Code 的 .local 模式）。
 *
 * 来源标注：在内容的一级标题里标注文件绝对路径，让 agent 知道这段来自哪个文件
 * —— 避免内容注入了但 agent 不认得来源（LLM 对 system prompt 末尾无标注内容容易忽略）。
 *
 * 用法：项目根放 `AGENTS.local.md`（自行 gitignore），内容自动注入。
 * 设计依据：docs/design/design.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    let localPath: string;
    try {
      localPath = join(ctx.cwd, "AGENTS.local.md");
    } catch {
      return;
    }
    let raw: string;
    try {
      raw = readFileSync(localPath, "utf-8");
    } catch {
      return; // 文件不存在 → 静默跳过
    }
    const content = raw.trim();
    if (!content) return; // 空文件 → 跳过

    // 来源标注：复用文件自身一级标题（末尾追加路径），或新增一级标题
    const nlIdx = content.indexOf("\n");
    const head = nlIdx === -1 ? content : content.slice(0, nlIdx);
    const body = nlIdx === -1 ? "" : content.slice(nlIdx + 1);
    let annotated: string;
    if (/^# /.test(head)) {
      // 已有一级标题 → 标题末尾追加文件绝对路径
      annotated = `${head}  [${localPath}]${body ? "\n" + body : ""}`;
    } else {
      // 无一级标题 → 新增
      annotated = `# 项目个人本地配置（${localPath}）\n\n${content}`;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${annotated}`,
    };
  });
}
