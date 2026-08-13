/**
 * 加载 8 个工具的 system prompt。
 *
 * prompt 原样复刻自 @z_ai/mcp-server@0.1.4 build/prompts/*.js（用 .temp/extract-prompts.mjs
 * 直接从源码提取，保证字面一致）。存成独立 txt 文件：零转义、易读、易同步（源码更新时
 * 重跑提取脚本即可）。定位方式与 pi 官方 examples（doom-overlay / dynamic-resources）一致：
 * import.meta.url + fileURLToPath。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

function read(name: string): string {
	return readFileSync(join(PROMPTS_DIR, name), "utf8");
}

export const GENERAL_IMAGE_ANALYSIS_PROMPT = read("general-image.txt");
export const TEXT_EXTRACTION_PROMPT = read("text-extraction.txt");
export const ERROR_DIAGNOSIS_PROMPT = read("error-diagnosis.txt");
export const DIAGRAM_UNDERSTANDING_PROMPT = read("diagram-analysis.txt");
export const DATA_VIZ_ANALYSIS_PROMPT = read("data-viz.txt");
export const UI_DIFF_CHECK_PROMPT = read("ui-diff.txt");

export const UI_TO_ARTIFACT_PROMPTS = {
	code: read("ui-to-artifact-code.txt"),
	prompt: read("ui-to-artifact-prompt.txt"),
	spec: read("ui-to-artifact-spec.txt"),
	description: read("ui-to-artifact-description.txt"),
} as const;

export type UiArtifactMode = keyof typeof UI_TO_ARTIFACT_PROMPTS;
