# SKILL.md 写法方法论

> 本文件是 `od-dev-writing-skills` 规范 2 的细则 + 写法工程指南。写 / 改 SKILL.md 时按此。
> **定位:guidance(强建议),非硬规范** —— 硬规范只有 SKILL.md 的 4 条;各 §是 best-practice,按 skill 规模取舍(如 §1.6 头尾 recap 对短 skill 可省)。
> 锚定业界方法论:**Anthropic context engineering**(smallest high-signal tokens / right altitude / just-in-time)+ **lost-in-the-middle**(Liu et al. 2023)+ **Diátaxis**(文档按需求分模式)+ progressive disclosure。
> **本 skill 不依赖 superpowers:writing-skills**;其通用写法核心(触发词覆盖 / token / 结构 / form-to-failure)已整合进本文件(见 §6 与之区别)。

## 0. 核心认知:可读性 = agent 能不能 follow
SKILL.md 是**注入智能体上下文、让 agent 执行**的指令文档,不是给人读的 README。"可读性"不是文采,是 **agent 能否正确 follow** —— 下面所有写法都由它决定。

**context 是有限资源(context rot)**:LLM 对长上下文呈 **U 型回忆**(lost-in-the-middle):头尾记得住、中段最弱;且 token 越多回忆精度越降。→ **每个 token 都是成本**,SKILL.md 要找 **smallest set of high-signal tokens**(最小高信号 token 集),不是越全越好。

## 1. 怎么写更好(写法 craft)

### 1.1 right altitude(粒度,最关键)
在两个失败模式间找平衡(Anthropic Goldilocks):
- 太**脆**:硬编码 if-else 流程 → 易碎、维护重、换场景就废。
- 太**泛**:高层空话、假装有 shared context → 没具体信号,agent 不知怎么做。
- **最优**:**够具体能引导行为,又够抽象给强 heuristic**(判据式:「X 条件下选 A、Y 条件下选 B」)。

### 1.2 指令式 + 判据(规范 2)
祈使句 + 判据(「先 X 再 Y」「若 Z 则 W」),不叙述文档腔。**标题写成判据本身**(扫标题能读懂骨架),不是模糊主题词。

### 1.3 frontmatter
- `name` + `description` 必填(共 max 1024 字符);`name` 仅字母数字连字符(name 本身也是触发信号 —— 用户 / agent 搜 skill 名;description 补 name 表达不了的:中文场景、次场景、负向路由)。
- `description` 是 skill 调用的**主触发器**(权威 —— Anthropic 官方:它是 Claude 决定是否调用 skill 的 primary mechanism;`When to Use` 类触发信息全放这,不散落正文)。**以触发为主 + 可带一句 purpose(做什么),绝不总结 workflow**(写了流程,agent 照 description 行事、不读正文,见「陷阱」)。**要 pushy 防 under-trigger**:Claude 倾向**漏触发** skill,description 要显式列触发场景 +「凡是 X/Y/Z 都用,即使没明说要」(Anthropic skill-creator 原话;why + 实测证据见 `design/decisions/0009-description-purpose-pushy.md`)。写法分四块:
  - **形式**:
    - 开头:条件触发句("当要…时用" / "Use when…"),**别用第一人称**(I / we);两种开头都可。
    - 语言 + 顺序:**按用户更可能用哪种语言提问排** —— 中文域中文为主、英文短语附后;英文主导域(debug / PR / CI,提问常带英文报错 / API 名 / GitHub 术语)英文可前置。英文给触发**短语列表**,**不必逐句对译**中文;纯中文场景可省英文。
    - 格式:code span(``)标接口名;bold 只用于**单处强调消歧关键词**(如"单个 Operation"),别整句权重堆砌。
    - 长度:name 尽量短;frontmatter(name + description)**总是加载进 context** → 官方建议 **~100 词**(够触发即可,别长篇)。硬上限 name + description 共 1024 字符;简单 skill 几十字,多场景数百字,**超 ~600 警惕冗余**,反复裁仍超 → 考虑 skill 拆分(§5)。**下限**:再短也满足"① 条件触发句开头 ② 有重叠兄弟时给去向"。
    - 空间紧张砍切顺序:**必要开头句(不可砍)> 触发场景(主 + 次)> 关键 keyword > 负向路由(压缩到最短形式即兄弟全名,**不归零**)> 装饰形式(英文 / code span / 双语排序,可砍)**;真到极限,外路由全名 > 装饰形式。
  - **写什么(4 条)**:
    1. **触发为主 + 可带 purpose,不写 workflow**(不写执行步骤;"范围关键词"—— 碰什么组件 / 接口 / 制品 —— 属触发上下文,不禁;purpose = 一句"做什么",不禁)。分界**边界测试**(只判范围内容:范围关键词 vs workflow):**负向路由(外路由 + 自路由)里表路由优先级的"先 X"(如自路由"先建档"、外路由"先用 X skill")指向 skill 选择,不是 workflow,豁免此测试**;其余内容,有**显式顺序标记**(先…再… / 然后 / 每…最后… / 编号 step 1,2,3)→ workflow,bad,删;**单个动作或扁平列举**(顿号 / 加号 / 逗号分隔,含组装动词 + 组件清单)→ 范围关键词,OK。**只看显式标记;隐含时序不管**(声明→检测→处理无标记的就 OK —— 显式标记才是触发 agent 照 description 执行流程的信号)。**routing vs 内部 workflow 判据**:routing 指向 skill 选择(用本 skill / 去别的 skill);workflow 指向本 skill 内部步骤 —— 后者一律不豁免(别把内部流程包装成 routing 钻豁免)。**"先 X"豁免当且仅当 X 是某 skill 的主场景名(本 skill 或别的 skill)= 调用一个 skill**;若 X 是某 skill 内部步骤名(如 debug skill 的"复现 bug""隔离根因")则不豁免。例:"用 `round_by_*` 判画面"、"把 Operation 组合成一个 app(app 类 + factory 注册 + config + GUI)"= 范围关键词 OK;"先建节点再连边,每节点读屏,最后返回结果"(显式顺序标记)= workflow bad。
    2. **触发场景覆盖正文所有场景(主 + 次)**:正文常延伸出相关次场景(写 → 改 → 调试 → 验证;建档 → 调试撞陌生画面)。只写主场景 → 次场景下搜不到 / 不加载 → 漏用。**哪些算场景**:能写成"当用户…时"的就是场景;讲"怎么做"的不是场景(是方法)。通读正文,列全部场景,主 + 次都进 description。**写时机**:新建先写 body 草稿 → 再写 description;编辑加了新场景 → 重读 body 改 description(同步)。
    3. **keyword 覆盖**(触发词优化,便于模型选到本 skill):错误 / 问题驱动型(debug / 排查)→ 错误信息("Hook timed out")、症状("flaky""卡住");任务驱动型(创建 / 写 / 审查)→ 任务描述短语 + 动作动词 + 涉及制品("创建 skill""写 op""审查 PR");通用 → 同义词、工具 / 命令 / 接口名。**机制**:触发靠模型读 description **语义**判断(不是关键词倒排检索)—— 关键词帮边际命中,**语义清晰更重要**。**usage 类 skill**(用户意图触发、无兄弟消歧,如画图)可 keyword 为主;dev 类才强依赖场景 + 负向路由。
    4. **负向路由**(description 里写"不触发 X、去做 Y"挡错路由):**先列出本仓 + 已挂载到本仓的所有 skill(`skills/`、`.claude/skills/` 挂载点、第三方插件如 `superpowers:*`),挑易混兄弟:识别全部同 query 双触发兄弟(空间允许全路由;紧张按混淆度排,**top-1~2 是紧张下限,非识别上限**)**。**快速初筛**:两 skill 主动词或主制品词重叠 ≥1 → 疑似兄弟,走双触发判定。**易混兄弟判据(同 query 双触发)**:用户用同一句模糊提问(如"我要做一个新自动化")会同时命中两个 skill 的触发场景才算兄弟(**共享主题词 ≠ 兄弟**)。**路由方向**:每个 skill 至少指向比自己更具体 / 更通用的易混项,不强制对称。两种模式 —— ① **外路由**(本 skill 不该接 → 点名去另一个 skill,写**全名含命名空间**,如「→ od-dev-gameplay-automation」「→ superpowers:systematic-debugging」);② **自路由**(别做 X 的反面 → 先做本 skill 主场景,如「别急着改 → 先建档」)。**有重叠兄弟时,无论 skill 多简单都必须给负向路由**(无重叠才可省)。**负向要具体,但条件化**:被否定的活动**是本 skill 某个次场景**时,笼统否定才误伤(需具体化或显式列为触发);**确实完全不在本 skill 范围**(如"写单个 op"否定"从零做新玩法")可直接否定不必细化。
  - **简单 / 窄域 skill 可简短**:核心要求"① 只写触发不写 workflow ② 覆盖正文场景"始终必守;keyword / 英文 / 多场景随复杂度叠加;**但有重叠兄弟时负向路由不免**(见写什么 4)。
  - **判据(写完即过的门)**:① 对正文每个主要场景,description 都有触发词?② **负向 checklist**:对照本仓 + 挂载 skill 清单,每个同 query 双触发兄弟都给去向(外路由全名 / 自路由反面)?③ **反向测**:列 body 每个主要场景一句话用户提问(含走样措辞),凭 description 判 agent 会不会加载,不确定补触发词。④ **workflow 边界自检**:对 description 草稿逐句跑边界测试,有显式顺序标记(先…再… / 然后 / 每…最后…)且不属于 routing"先 X"豁免 → 删。**经验测法(挂载后验证,非写完即过)**:draft → 挂载 → 写 3-5 句真实问法实跑 → 没加载补触发词。
  - **陷阱(实测)**:description 一旦写了流程,agent 照 description 行事、不读正文。例:写「执行计划时,每任务派子 agent + 任务间 code review」→ agent 只做一次 review;而正文 flowchart 要两次。改成只写触发「Use when 执行含独立任务的实现计划」→ agent 才读正文。
  - **范例**(本文简洁用短名,**真实 description 必须全名含命名空间**;精简示意,真实见各 skill):好 —— `screen-onboarding`(建档截图 + 调试撞陌生画面,主 + 次 + 自路由"先建档")、`write-application`(把 Operation 组合成可运行 app —— 组装动词 + 顿号组件清单,**范围关键词合规**,见写什么 1)、`deciding-a-fix`(已知机制决定修 + 外路由 → systematic-debugging;英文在前因 bug / issue report 常以英文报错 / GitHub issue 出现)。坏 → 好(workflow → 范围关键词):✗「写 op 时,先建节点再连边,每节点读屏,最后返回 round 结果」(显式顺序标记 = workflow)→ ✓「写 / 改 / 调试单个 op(用 `@operation_node`、`round_by_*`),含改 / 修已有 op 的 bug」(顿号扁平列举 = 范围关键词)。**边界例**:「声明节点、检测画面、处理动作、返回结果」(顿号、无显式标记,虽隐含时序但只看显式标记 = 范围关键词 OK)。

### 1.4 正文结构(按需,非强制模板)
Overview(是什么 + 核心原则一两句)/ When to Use(症状 + 何时不用)/ Quick Reference(扫读表)/ Common Mistakes(常见错 + 修)。**reference / 穷举清单 / 长例子** → 进 `references/`,不堆正文(见 §2)。

### 1.5 form-to-failure(按失败类型选指令形态,高级)
写规则前先分清它防的是哪类失败 —— **形态选错会反效果**(有对照实验):

| 失败类型 | 正确形态 | 错误形态 |
|---|---|---|
| 压力下明知故犯(知道规则但不做) | **禁令 + 合理化反驳表 + red flags** | 软建议("prefer...") |
| 照做但产出**形状错**(冗长 / 埋没结论 / 复述规格) | **正向 recipe / contract**:说产出**是什么**(各部分 + 顺序) | 禁令清单("don't restate") |
| 漏掉本该有的元素 | **结构式**:模板里 REQUIRED 槽位 | 模板旁的散文提醒 |
| 行为该随条件变 | **条件式**(挂可观测谓词:"若有 brief,引用它") | 无条件规则 + 例外从句 |

**要点**:**禁令对「塑形」类失败反而更糟**(agent 会和 "don't X" 谈判)。recipe 不留谈判空间:产出要么符形状要么不符。**别加 nuance 从句**("don't X unless it matters" 重开谈判);真例外写成独立条件式。

### 1.6 头尾放不变量(lost-in-the-middle)
**关键规则 / 不变量放开头**(primacy)+ **结尾放自检 / recap**(recency);别把「必须做」埋正文中间(U 型最弱区)。

### 1.7 token 效率(每个 token 都是成本)
目标(参考):频繁加载的 skill 正文尽量短(<200~500 词);getting-started 类 <150。手法:细节移 `--help` / reference;**别 `@` 强制加载**别的文件(烧 context);压缩例子;去冗余(别重复 cross-reference 已说的)。验证:`wc -w SKILL.md`。

### 1.8 调参值 / magic number 归属(rule #4 边界)
具体数值(`pc_rect +10px` 留白、sleep 1.5s、`lcs_percent=0.8`)常让人拿不准归 skill 还是 doc:
- **原则 / 规则归 skill**(「模板 bbox 每边留白以容忍匹配误差」「操作后等动画再验」「loose 匹配要收紧阈值防误匹配」)。
- **精确调参值是 data** → 默认归 **doc / design**(具体游戏 / 实测定值)。
- **例外**:若该值是与方法论不可分的**稳定操作约定**(如「留白 ≈ +10px」是 screen_info 编辑器通用惯例、非某游戏专属),则留 skill 并标「≈,按实测调」。
- **判据**:换项目 / 换版本这值还成立吗?成立(通用约定)→ skill(带「可调」);不成立(实测 / 游戏专属)→ doc / design。

### 1.9 写清楚:通俗直白,别用缩写 / 自造黑话

skill 正文是给智能体执行的指令,也是给人读的参考,要**读得懂**。这是可读性(§0)在语言层面的落地:

- **别用缩写、中英混杂黑话**:把长说法压成两三字、或塞英文词,读者 / 干净上下文的智能体不一定懂。用完整平实说法;首次出现的术语带一句解释。
- **别堆修饰造名词**:几个限定词叠成一个新名词,不如用动词 + 例子讲清。
- **对 / 错要标清**:讲反模式(错误做法)时明确标「错 / 别犯」,别用模糊领起词让读者猜是推荐还是不推荐。
- **判据**:写完通读一句 —— "没参与讨论的人读得懂吗?"读不懂就改平实。

## 2. 怎么拆分文件(progressive disclosure)
核心:**always-on**(SKILL.md,每次触发都加载,token 贵)**只放必须每次都有的**;**情境性细节**进 `references/` 按需加载(skill 指令「到第 Y 步读 references/X」)。这叫 **just-in-time + 轻量标识符**(Anthropic 背书:agent 维护 file path / link,运行时按需读,像人用索引不全背)。

### 2.1 内容归属
- **always-on**(SKILL.md):方法论 / 不变量 / 判据 / frontmatter。每次触发都要。
- **situational**(`references/`):深度模板、穷举清单、API 参考、长例子、form-to-failure 大表。只有某步 / 某分支才要。
- **maintainer-only**(`design/`):设计 + ADR,不进 agent 上下文(规范 1)。
- **自带工具 / 脚本**(skill 目录内、被 SKILL.md 调用执行):放 skill 根或 `scripts/` 子目录;**`references/` 只放 agent 读的参考文档(.md),不放可执行脚本**。

### 2.2 拆分触发器(信号 → 抽 references/)
- 一节 > 100 行且只服务某子场景 → 抽。
- 同段检查清单在 3 处重复 → 抽一次,引用。
- **穷举列表**(全部阵营名 / 全部 screen 名)→ references/,SKILL.md 只引「当前清单见 references/X」(= 引用卫生档 3 运行时读,永不过时)。
- 长例子 / 图示 → references/ 或 design/(规范 4:SKILL.md 只留抽象判据)。
- **反向**:子节只一行 → 折回父节(防过早拆分,反过度工程)。

**拆 vs 不拆裁决**(§2 拆分 vs §3.4 反过度拆分,不冲突):问「这内容服务**每次都用**的核心,还是**某分支**才要?」某分支才要 + 有分量(挡住核心 / 重复)→ 拆 references/;每次都要的核心 → 留 SKILL.md 内联(**即使长** —— 每次都要付 token,拆出去反而每次再读更费)。别把「核心但长」误当「情境深度」拆掉。

### 2.3 命名 / 目录即信号
references 文件名 / 目录结构本身给 agent 信号(`test_utils.py` 在 `tests/` vs `src/core_logic/` 含义不同)。组织清晰 = 减少 SKILL.md 里要解释的话。

## 3. 编写过程中怎么重新组织(refactor)
把 SKILL.md 当**需定期重构的代码**,不是只追加的文档。借 Fowler 重构的命名变换套到散文:

| 变换 | 何时做 |
|---|---|
| Extract Section | 一节混多个关注点 → 拆 / 抽 references/ |
| Merge Duplicates | 同规则说 3 遍 → 留一处 + 交叉引用 |
| Reorder by Dependency | 依赖别的规则的规则排后面;不变量置顶(lost-in-the-middle) |
| Move | 情境细节 → references/ |
| Inline | 过度拆的一行子节 → 折回父节 |
| Rename heading to criterion | 标题从主题词改成判据 |

**重构触发器**(写中遇到就停一下重构):在重复自己 → Merge;加到第 5 条「例外」→ 重新抽象或例外进 references/;核心规则被埋 → 重排 / 抽出挡路细节;新规则不知放哪 → 可能是别的模式(Diátaxis:how-to / reference / explanation? explanation → design/ ADR);**费力找 / 理解某条规则 → 结构该过一遍重构了**(可读性债)。

### 3.1 minimal 起步 + RCA 过滤的增量(重要:别 over-fit)
- **从 minimal 开始测**(别一次堆全);**但**为**观察到的失败**加指令时,**先 RCA**:
  - 这是**通用 gap**(任何合理模型按方法论走都会犯)还是 **model/env 特异**(只你这套犯)?
  - **只为通用 gap 加**;**模型补偿性指令**(只补弱模型怪癖)不进**共享** SKILL.md(进 design ADR 记「某模型需额外哄」)—— 否则对强模型是噪声(违反 smallest-high-signal-tokens)。
  - 理由:共享 skill 跨人 / 模型 / 环境;你本地看到的失败**外部效度不足**(可能只是你模型的弱点,或别人环境的失败你根本没看到)。
- **共享 skill 主基底 = methodology**(模型无关、抗异构);failure-derived 规则只作 RCA 过滤后的补充。
- 与「两类 skill」一致:方法论覆盖型以方法论为据(不强依赖 baseline);纠正型即使做 RED,也只把**通用失败**写进去。

## 4. 例子与反模式
- **一个优质例子 > 多个平庸**:完整可跑、注释讲 WHY、来自真实场景、可改编(非填空模板);别多语言实现。
- **反模式**:叙事性例子(「某次 session 我们…」)、多语言稀释、flowchart 里塞代码、generic 标签(helper1 / step2)。
- **flowchart 只用于「非显然决策点 / 可能早停的循环」**;reference / 代码 / 线性步骤用表 / 代码块 / 编号列表,不用 flowchart。

## 5. 何时建 skill(别滥用)
建:技术非显然、跨项目会复用、广适用、别人也受益。
**不建**:一次性方案;他处已充分文档化的标准做法;**项目专属约定 → 进 instructions 文件(CLAUDE.md / AGENTS.md)不进 skill**;**机械约束(能用 regex / 校验强制的)→ 自动化,别占文档**(文档留给判断类)。

## 6. 与 superpowers:writing-skills 的区别(本 skill 刻意偏离 + 整合)
本 skill **不依赖** superpowers:writing-skills,已整合其**通用写法核心**(frontmatter / 触发词覆盖 / token 效率 / 结构模板 / form-to-failure / 例子与反模式 / 何时建)到上文。**刻意偏离**一处:
- superpowers 的 **Iron Law:每个 skill 必须先 RED(baseline 看失败),无例外**。本 skill **弱化**:按「两类 skill」,**方法论覆盖型 RED 可省**(团队工具 / 模型异构 → 单一 baseline 外部效度不足,见 §3.1),GREEN 验证两类都不可省。
- 本 skill **叠加** superpowers 没有的:design/ + ADR(规范 1)、自包含硬门 + 引用卫生(规范 3)、SKILL.md 写法工程指南(本文件)。

详见 [ADR-0005](../design/decisions/0005-drop-superpowers-dependency.md)(去 superpowers 依赖)。
