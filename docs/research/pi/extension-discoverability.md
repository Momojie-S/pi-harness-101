# pi 扩展如何向用户/LLM 暴露文档

> 调研结论：当你的扩展给另一个 pi 安装时，用户和 LLM 各通过什么渠道了解它怎么用。

## 结论速览

pi **没有**统一的"扩展帮助系统"（如 `pi help <extension>` 或 `/help goal`）。文档通过**多个分散渠道**触达不同受众：

| 受众 | 渠道 | 谁负责写 | 何时生效 |
|------|------|---------|---------|
| **人类用户** | README.md | 扩展作者 | 安装时阅读 |
| **人类用户** | 命令 description（输入 `/` 时看到） | `registerCommand({ description })` | 命令注册即生效 |
| **LLM agent** | 工具 description + promptSnippet + promptGuidelines | `registerTool({ description, promptSnippet, promptGuidelines })` | 工具注册即注入 system prompt |
| **LLM agent** | `before_agent_start` 注入 system prompt | 扩展在事件里 `return { systemPrompt }` | 每次 agent turn |
| **LLM agent** | Skill（SKILL.md） | 扩展作者写 skill 文件 | 用户 `/skill:<name>` 加载时 |
| **包发现** | `pi-package` keyword + `pi` manifest | `package.json` | npm 发布后 pi.dev/packages 收录 |

## 分渠道详解

### 1. README.md（给人类）

最基础的文档。用户安装包后，去 npm / git 仓库 / 本地目录读 README 了解用法。

- pi **不**自动把 README 展示给用户或 LLM
- 这是"包装盒背面的说明书"——安装前/安装后自己读

### 2. 命令 description（给人类，输入 `/` 时）

```typescript
pi.registerCommand("goal", {
  description: "设置持久目标，自主循环直到完成",
  handler: async (args, ctx) => { ... },
});
```

用户在 TUI 输入 `/` 时，命令列表会显示这个 description。这是**用户发现命令的第一入口**。

- 简短一行，说"这个命令干什么"
- 不适合放完整用法——用户看到的是 autocomplete 列表
- 用法细节靠 README / 命令内反馈（如 `/goal` 无参时显示帮助）

### 3. 工具 description + promptSnippet + promptGuidelines（给 LLM）

如果扩展注册了 LLM 可调用的工具，这三个字段是 LLM 了解工具的唯一渠道：

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "详细描述这个工具做什么",           // LLM 看到的工具说明
  promptSnippet: "一句话摘要，出现在 Available tools", // system prompt 里的工具列表
  promptGuidelines: [                              // 追加到 Guidelines 段
    "Use my_tool when the user asks to summarize text.",
  ],
  parameters: Type.Object({ ... }),
  async execute(...) { ... },
});
```

- **description** → 工具的完整描述，LLM 据此决定何时调用
- **promptSnippet** → system prompt 中 "Available tools" 列表的一行
- **promptGuidelines** → system prompt 中 "Guidelines" 段的额外条目（必须带工具名，不能写 "Use this tool..."）

**这是 LLM 发现工具的标准机制。** 写得好，LLM 就知道什么时候该用；写得差，LLM 就不会用或误用。

### 4. before_agent_start 注入 system prompt（给 LLM）

不注册工具、但需要告诉 LLM 某些规则的扩展，用 `before_agent_start` 注入：

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    systemPrompt: event.systemPrompt + "\n\n## Goal 扩展规则\n当 goal 激活时...",
  };
});
```

**goal 扩展就是用这个**：它不注册 LLM 可调用的工具（循环由事件驱动，不是 LLM 主动调工具），而是通过 `before_agent_start` 注入框架 prompt，告诉 LLM 当前有活跃 goal、应该怎么推进。

### 5. Skill（SKILL.md）（给 LLM，按需加载）

Skill 是 markdown 文件，用户用 `/skill:<name>` 加载后注入 system prompt：

```
skills/
└── my-skill/
    └── SKILL.md    # 详细的使用说明
```

- 适合**复杂用法**（多步骤、需要 LLM 理解工作流）
- 用户主动加载才生效（`/skill:my-skill`）
- 或在 AGENTS.md 里指示"遇到 X 时加载 skill Y"

### 6. 包发现（给生态系统）

```json
// package.json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  }
}
```

- `pi-package` keyword → pi.dev/packages 收录
- `pi` manifest → pi install 时知道加载哪些资源
- 不影响 LLM 或用户的文档体验，纯发现机制

## goal 扩展的文档策略

| 渠道 | goal 用了吗 | 内容 |
|------|------------|------|
| README.md | ✅ | 完整使用说明（本次新增） |
| 命令 description | ✅ | "设置持久目标，自主循环直到完成" |
| 工具 promptSnippet/Guidelines | ❌ | goal 不注册 LLM 工具（循环事件驱动） |
| before_agent_start | ✅ | 注入框架 prompt（告诉 LLM 有活跃 goal） |
| Skill | ❌（可选 v2） | 复杂用法可写 skill，但 MVP 不需要 |
| pi-package keyword | ✅ | 仓库 package.json 已有 |

## 最佳实践

1. **README 是基础**：人类用户的入口，必须有
2. **命令 description 要短准**：用户输入 `/` 时第一眼看到
3. **工具三件套要写全**：`description` + `promptSnippet` + `promptGuidelines`，否则 LLM 不知道怎么用
4. **不注册工具的扩展**：用 `before_agent_start` 注入规则，告诉 LLM 当前上下文
5. **复杂工作流**：写 skill，用户按需加载
6. **命令无参时显示帮助**：`/goal` 无参 → 显示用法摘要（goal 已实现）

## 与其他 agent 框架对比

| 框架 | 扩展文档机制 |
|------|------------|
| **Claude Code** | MCP tool description（LLM）+ README（人类）；无统一帮助系统 |
| **pi** | 同上模式：工具 description + 命令 description + README + skill |
| **Cursor** | MCP tool description + 规则文件（.cursorrules） |

共性：**LLM 靠工具描述，人类靠 README**。没有"统一扩展帮助中心"。
