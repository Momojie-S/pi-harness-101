/**
 * 冒烟测试：验证核心逻辑（不依赖 pi 加载）。
 * 运行：cd extensions/zhipu-vision && node ../../web-console/node_modules/tsx/dist/cli.mjs test/smoke.ts
 */
import { visionChat } from "../src/vision/api.ts";
import { resolveImage } from "../src/vision/media.ts";
import { loadVisionConfig } from "../src/config.ts";
import { GENERAL_IMAGE_ANALYSIS_PROMPT, UI_TO_ARTIFACT_PROMPTS } from "../src/vision/prompts.ts";

async function main() {
	// 1. 配置
	const cfg = loadVisionConfig();
	console.log("[1] 配置:", { keySource: cfg.keySource, endpoint: cfg.endpoint, model: cfg.model });
	if (cfg.keySource === "none") {
		console.error("FAIL: 未配置 API Key");
		process.exit(1);
	}

	// 2. prompt 加载（验证 import.meta.url 路径解析）
	console.log("[2] prompt 加载: general-image=" + GENERAL_IMAGE_ANALYSIS_PROMPT.length + " chars, ui-to-artifact.code=" + UI_TO_ARTIFACT_PROMPTS.code.length + " chars");
	if (GENERAL_IMAGE_ANALYSIS_PROMPT.length < 1000) throw new Error("prompt 加载异常");

	// 3. media：http url 直传
	const httpUrl = resolveImage("https://cdn.bigmodel.cn/static/logo/register.png");
	console.log("[3a] http url 直传:", httpUrl === "https://cdn.bigmodel.cn/static/logo/register.png" ? "OK" : "FAIL");

	// 4. 端到端：用 system prompt + 图片调 glm-4.6v（复刻 analyze_image 工具的完整路径）
	console.log("[4] 调用 GLM-4.6v（analyze_image 等价路径）...");
	const result = await visionChat([
		{ role: "system", content: GENERAL_IMAGE_ANALYSIS_PROMPT },
		{
			role: "user",
			content: [
				{ type: "image_url", image_url: { url: "https://cdn.bigmodel.cn/static/logo/register.png" } },
				{ type: "text", text: "What is in this image? Answer in one short sentence." },
			],
		},
	]);
	console.log("[4] 结果:", result.slice(0, 200));
	console.log("\n✅ 全部通过");
}

main().catch((e) => {
	console.error("❌ FAIL:", e instanceof Error ? e.message : String(e));
	process.exit(1);
});
