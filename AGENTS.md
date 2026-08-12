# AGENTS.md

本项目是 **pi coding agent** 的学习与定制工坊：通过 extensions / skills / tools 机制构建完全可控的 coding agent（从 Claude Code 迁移而来）。仓库本身是一个 **pi package**（`package.json` 带 `"pi"` 清单），可 `pi install` 安装，也可本地直接引用。

## 红线约束（每次改动都必须遵守）

1. **无构建步骤（针对 pi 加载的资源）**：pi 通过 jiti 直接加载**扩展 / skill / prompt / theme** 的 TypeScript，改完用 `/reload` 热加载，**不要**引入 tsc / webpack 等编译流程。**独立应用**（如 `web-console/`）不在此限——它不被 pi 加载，而是消费 pi SDK，按自身 ADR 决定（见 `web-console/docs/design/adr/001-allow-build-step.md`）。
2. **chrome-devtools-mcp 兼容性是硬约束**（见 ADR-002）：扩展的 52 个工具必须与 chrome-devtools-mcp 的工具名、参数、行为一一对应，不自创命名。
3. **CDP 客户端统一用 `chrome-remote-interface`**（见 ADR-001），不引入 puppeteer / playwright 等替代库。
4. **架构决策走 ADR 流程**：涉及范围 / 依赖 / 设计取舍的决策，先在**该制品的** `docs/design/adr/` 记录，再实现（详见下方「文档与决策记录规范」）。

## 工程方法论（长远利益优先）

本仓以**学习与定制**为目的，不是赶工交付。所有方案选择遵循「长远利益优先」——宁可多花工作量，也要选**长期可维护、正确、有学习价值**的方案。这是贯穿红线以下所有工作的元原则。

1. **长远利益 > 短期省力**：选方案时问「半年后回头看哪个更对」，不因「工作量大」而妥协。例：`/tree` `/fork` 需要完整会话树视图（大功能），仍做完整而非砍半；前端选 React（生态成熟、AI 辅助可靠）而非最省事选项。
2. **追根因，不打补丁**：发现 bug 先找根因再修，不在症状层堆补丁。例：命令列表重复的根因是「手动拼 skill/prompt + `runtime.getCommands()` 双数据源」，解法是收敛到单一数据源，而非在结果数组上去重。
3. **基于事实，不基于假设**：下结论前验证到源码 / 文档 / 运行时，不凭猜测。例：曾假设「`session.prompt` 不解析 `/` 命令、当文本发 LLM」是核心 bug，深挖 `agent-session.js` 后发现 `expandPromptTemplates` 默认 `true`、prompt 内部完整分流 `/` 命令——用证据推翻了自己的误判。
4. **完整 > 妥协**：一个功能要做就做完整（对齐 CLI 全部行为），不留半成品或「TODO 后续」。半成品比没有更糟：制造虚假完成感 + 持续维护负担。
5. **正确抽象的耐心**：宁可花时间拆分 / 重构到合理边界，也不让「上帝文件」堆积。当前 `web-console/src/App.tsx`（487 行、含全部 state / 事件 / picker / 命令逻辑的上帝组件）是已知技术债，应逐步拆分为 hooks 与子组件。
6. **决策留痕（ADR）**：涉及范围 / 依赖 / 设计取舍的决策走 ADR，记录「选了什么、放弃了什么、为什么」，供未来的自己与协作者复盘。

> 这六条不是口号，是**遇到取舍时的决策顺序**：先问长远利益（1）→ 找根因（2）→ 验证事实（3）→ 做完整（4）→ 抽象到位（5）→ 留痕（6）。

## 文档与决策记录规范

本仓每个独立制品（扩展 / web-console / 未来应用）都维护两类文档：**`README.md`（使用说明）+ `docs/design/`（设计）**。前者答「怎么用」，后者答「为什么这么设计」。所有制品遵循同一套约定。

### 使用说明（README.md）

每个制品根目录有 `README.md`，写给「拿到这个制品要用的人」：

- **快速开始**：dev / build / start 的精确命令 + 环境要求
- **环境变量**：每个变量的语义、默认值、**何时需要**（如非交互 / 系统服务运行时的特殊配置）
- **生产部署**：常驻（开机自启）+ 外网访问的**通用方式**，不写死某台机器的值
- **安全提醒**：暴露面 + 必要的防护

> **通用 vs 实例的边界**：README 只写**通用、可移植**的知识（换台机器也成立）。某台机器的**具体实例**（路径、域名、凭据、任务名）归该机器的运维文档，不写死在制品 README——既避免泄露凭据，也让制品可开源。例：web-console 的 README 写「常驻用计划任务 / PM2」，而 `pi.momojie.online` 的具体 frp/nginx/密码在 `ops/pi-web-console.md`。

### 设计文档（docs/design/）

采用**总览—决策—分模块**三层结构：

### 结构

```
<制品>/docs/design/
├── design.md      ← 总览：背景、整体架构图、技术栈、功能清单、索引到各文档
├── adr/           ← 决策记录（ADR）：记「为什么」
│   ├── TEMPLATE.md
│   └── NNN-<slug>.md
└── modules/       ← 分模块详解（按需）：记「怎么设计 / 现状」
    └── <module>.md
```

### 三层文档的边界（避免重复）

| 文档 | 回答 | 何时写 |
|------|------|--------|
| `design.md` | 这是什么、整体怎么搭 | 项目立项时；随演进更新 |
| `adr/NNN-*.md` | **为什么**这么选（面临什么选择、考虑了什么、决定什么、后果） | 涉及范围 / 依赖 / 设计取舍 → **先记 ADR 再实现** |
| `modules/<m>.md` | 某模块**怎么设计**（结构、数据流、接口、组件） | 模块复杂到 `design.md` 一段讲不清时 |

> ADR 与 module 文档互补不冲突：ADR 记历史决策点（「为什么用 X 不用 Y」），module 文档记当前设计（「X 长什么样、怎么工作」）。

### ADR 触发条件

凡涉及以下任一，**先记 ADR 再动手**：
- 范围变更（新增 / 移除大功能、改变边界）
- 引入 / 替换依赖、库、框架
- 设计取舍（多方案二选一，各有代价）

纯实现的小改动（修 bug、补细节）不需要 ADR。

### 文档同步纪律（改代码的收尾检查）

每次改动收尾时，按改动类型检查是否需要同步文档——**文档和代码不同步，文档就失去信任、沦为废纸**。这条纪律是上面 ADR 触发条件的泛化：ADR 管「为什么」，这里管「所有文档」。

| 改动类型 | 要同步的文档 |
|----------|-------------|
| 引入 / 替换依赖、框架；设计取舍（多方案二选一） | **ADR**（先记再实现，见上） |
| 新增 / 移除大功能、改变模块边界 | **design.md** 功能清单 + 相关 module 文档 |
| 改了对外契约（WS 消息、API、配置项、类型） | 相关 module 文档（契约字段说明） |
| 关键代码的「为什么这么写」（易踩坑的技巧、非显然的约束） | **代码注释**（第一道防线，就地说明；详见各制品 layout.md 等） |
| 纯 bugfix、补细节、重命名、调样式 | 通常不需要文档 |

> **判断标准**：半年后回头看，这次改动的「为什么」是否还能从文档 / 注释里找到？找不到就要补。改完代码主动过一遍这张表，不要等"以后再说"——以后就是永不。

### 现有制品

- `extensions/chrome-devtools/docs/design/`（CDP 兼容性、chrome-remote-interface 选型等，见红线 2/3）
- `web-console/docs/design/`（`design.md` 总览 + `adr/` 决策记录 + `modules/` 分模块设计，三层结构见上方「文档与决策记录规范」）

## 目录结构

```
├── extensions/
│   └── chrome-devtools/      # 核心扩展：52 个 CDP 工具（兼容 chrome-devtools-mcp）
│       ├── index.ts          # 单文件入口
│       └── docs/design/      # 设计文档 + ADR
├── web-console/              # 独立 Node 应用：浏览器远程操作 pi（消费 pi SDK，允许构建，自带 docs/design/）
├── .agents/skills/           # 项目维护用 skill（开发本 repo 时按需加载）
├── skills/                   # 包对外发布的 skill（给安装本包的用户）
├── prompts/  themes/         # prompt 模板 / 自定义主题
├── docs/                     # 学习笔记
├── .pi/chrome-devtools.json  # 扩展配置 { "port": 19999 }
└── package.json              # pi package 清单
```

> `.agents/skills/` 与 `skills/` 区分：前者是**维护本项目自身**的 skill（开发时按需加载），后者是本包**对外发布**给用户的 skill。

## 技术栈

TypeScript（pi 直载，无编译） · chrome-remote-interface（CDP 通信） · pi `ExtensionAPI` · typebox

## 编码约定

- 文档、注释、commit message 用**中文**（与现有 README / ADR 一致）。
- 扩展以单文件 `index.ts` 为入口；CDP 相关一律走 chrome-remote-interface。
- 目前无测试框架与 lint 配置；保持 `index.ts` 内工具注册结构清晰、可检索。

## 关键文档

- chrome-devtools 扩展完整设计：`extensions/chrome-devtools/docs/design/design.md`（背景、架构图、UID 系统、配置、52 工具详表、已知限制）
- ADR 记录：`extensions/chrome-devtools/docs/design/adr/`

## 可用 Skills

两个开发类 skill 管的是**不同制品**，刻意分工、不冲突：

| Skill | 管什么 | 何时加载 |
|-------|--------|---------|
| `pi-extension-dev` | pi **扩展**的开发流程 + 扩展的 design.md / ADR | 开发 / 调试扩展、写扩展设计文档或 ADR 时 |
| `od-dev-writing-skills` | 怎么写好 **skill 内容**（4 条硬规范）+ skill 自身的 design/decisions | 创建 / 修改任何 skill、写 SKILL.md 时 |

> `od-dev-writing-skills` 是从 OneDragon-Skills 仓**手动复制的快照**（非活链接）；来源与同步方式见该 skill 的 `SOURCE.md`。

两者 ADR 格式不同、各管各的制品：扩展 ADR 走 `pi-extension-dev`（`extensions/<name>/docs/design/adr/`，TEMPLATE.md 格式）；skill 自身设计决策走 `od-dev-writing-skills`（`<skill>/design/decisions/`，arc42 §9 格式）。用 `/skill:<name>` 可手动加载。
