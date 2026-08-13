/**
 * 同步脚本：从 @z_ai/mcp-server 源码提取所有 system prompt，写入 src/prompts/*.txt。
 *
 * 用法：node extensions/zhipu-vision/scripts/sync-prompts.mjs
 *
 * 当 @z_ai/mcp-server 更新 prompt / 工具时，重跑此脚本即可同步（无需手改）。
 * 见 README「与 @z_ai/mcp-server 的关系」+ docs/design/adr/001。
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = join(__dirname, "..");
const promptDir = join(extDir, "src", "prompts");
const tmpDir = join(__dirname, ".tmp-sync");

// 1. npm pack 到临时目录
console.log("1. npm pack @z_ai/mcp-server ...");
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
const tgz = execSync("npm pack @z_ai/mcp-server", { cwd: tmpDir, encoding: "utf8" }).trim();
console.log("   下载:", tgz);

// 2. 解压
console.log("2. 解压 ...");
execSync(`tar xzf ${tgz}`, { cwd: tmpDir, stdio: "inherit" });

// 3. 从源码 import prompt 模块
console.log("3. 提取 prompt ...");
const promptsDir = join(tmpDir, "package", "build", "prompts");
const P = await import(`file://${join(promptsDir, "index.js").replace(/\\/g, "/")}?t=${Date.now()}`);

mkdirSync(promptDir, { recursive: true });

const simple = {
	"general-image.txt": P.GENERAL_IMAGE_ANALYSIS_PROMPT,
	"text-extraction.txt": P.TEXT_EXTRACTION_PROMPT,
	"error-diagnosis.txt": P.ERROR_DIAGNOSIS_PROMPT,
	"diagram-analysis.txt": P.DIAGRAM_UNDERSTANDING_PROMPT,
	"data-viz.txt": P.DATA_VIZ_ANALYSIS_PROMPT,
	"ui-diff.txt": P.UI_DIFF_CHECK_PROMPT,
};
for (const [file, content] of Object.entries(simple)) {
	writeFileSync(join(promptDir, file), content, "utf8");
	console.log(`   ✓ ${file}: ${content.length} chars`);
}

for (const key of ["code", "prompt", "spec", "description"]) {
	const c = P.UI_TO_ARTIFACT_PROMPTS[key];
	writeFileSync(join(promptDir, `ui-to-artifact-${key}.txt`), c, "utf8");
	console.log(`   ✓ ui-to-artifact-${key}.txt: ${c.length} chars`);
}

// 4. 清理
rmSync(tmpDir, { recursive: true, force: true });
console.log("\n✅ 同步完成。prompt 已写入 src/prompts/。");
