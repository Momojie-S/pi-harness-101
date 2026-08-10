# ADR-003: 扩展测试采用 vitest + 纯逻辑抽取

## 状态

Accepted

## 背景

chrome-devtools 扩展是单文件 `index.ts`（2400+ 行），工具注册与 CDP 调用逻辑耦合，且 import 了 `@earendil-works/pi-coding-agent`（扩展目录解析不到）和 `chrome-remote-interface`——难以直接单元测试。

项目有「无构建步骤」红线（pi 经 jiti 直载 TS，不编译），测试方案**不能给运行时引入编译依赖**。需要决定如何为扩展建立可维护、可 CI 自动化的测试。

## 决策

采用 **vitest** 作为测试框架，并把可单测的纯逻辑从 `index.ts` 抽到 `src/` 子模块。

具体：

1. **框架**：vitest，放 `devDependencies`（仅 dev 时使用）。pi 运行时经 jiti 直载 TS，**不经过** vitest / vite / esbuild，不违反红线。选 vitest 是因为 **pi 官方自己也用 vitest**（`scripts.test: "vitest --run"`），保持技术栈一致。
2. **可测试性抽取**：把无 CDP / 无 pi 包依赖的纯逻辑（如端口配置解析）抽到 `src/config.ts`，`index.ts` 引用它。测试直接测 `src/` 模块，零外部依赖、秒级跑完。
3. **测试隔离**：用真实临时目录 + 环境变量备份恢复，不依赖机器配置。
4. **分层策略**：纯逻辑层（vitest 单测）→ CDP 契约层（mock CDP）→ 端到端（真实浏览器）。当前先落地第 1 层，后续按需铺开。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **vitest + 纯逻辑抽取**（本方案） | 与 pi 官方一致；DX 好；纯逻辑测试零依赖 | vitest 依赖体积 ~29MB（vite/esbuild/rollup） |
| `node:test` + `tsx` | 依赖 <1MB | 与 pi 官方不一致；DX 略逊 |
| 不抽取、直接测 `index.ts` | 不改生产代码 | index.ts import 了 pi 包（解析不到）和 CDP，测试需大量 mock，难以落地 |
| 仅手动集成测试（pi 官方示例风格） | 零框架 | 无法 CI 自动化；回归靠人肉 |

## 后果

### 正面
- 纯逻辑可秒级单测，CI 友好，不依赖浏览器。
- 抽取改善了 `index.ts` 的关注点分离（config 逻辑独立可检）。
- 与 pi 官方测试栈一致，降低认知成本。

### 负面
- 引入 ~29MB dev 依赖（`node_modules` 已 gitignore，不入库）。
- 纯逻辑抽取是**渐进的**：当前只抽了 `config`，其余工具逻辑（如 `takeSnapshot` 的 uid 映射）仍耦合在 `index.ts`，需逐步重构（抽出纯转换函数 + 注入 CDP client）才能进入第 1/2 层测试。
- `CONFIG_DIR_NAME` 内联为 `".pi"`（与 pi 静默耦合）——已加护栏测试（断言该值）缓解，改 pi 时须同步。

## 参考
- pi `docs/development.md`：测试用 `./test.sh` / `npm test`（`vitest --run`）
- 扩展设计文档：`extensions/chrome-devtools/docs/design/design.md`
- 测试骨架：`extensions/chrome-devtools/{src/config.ts, test/config.test.ts}`
