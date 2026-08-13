/**
 * vision 模块：复刻 @z_ai/mcp-server 的 8 个视觉工具，纯 HTTP 直调 GLM-4.6V。
 * 工具名/参数/prompt 全部与 MCP server 一致。见 docs/design/adr/001。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { visionChat, type ChatMessage, type ContentPart } from "./api.ts";
import { resolveImage, resolveVideo } from "./media.ts";
import {
	GENERAL_IMAGE_ANALYSIS_PROMPT,
	TEXT_EXTRACTION_PROMPT,
	ERROR_DIAGNOSIS_PROMPT,
	DIAGRAM_UNDERSTANDING_PROMPT,
	DATA_VIZ_ANALYSIS_PROMPT,
	UI_DIFF_CHECK_PROMPT,
	UI_TO_ARTIFACT_PROMPTS,
	type UiArtifactMode,
} from "./prompts.ts";

/** 复刻 BaseImageAnalysisService.executeVisionAnalysis：system prompt + 图片 + 用户指令。 */
async function analyzeImages(systemPrompt: string, userPrompt: string, imageUrls: string[]): Promise<string> {
	const userContent: ContentPart[] = [
		...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
		{ type: "text" as const, text: userPrompt },
	];
	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userContent },
	];
	return visionChat(messages);
}

/** 单图工具的统一 execute（4 个工具共用）。 */
function singleImageExecute(systemPrompt: string) {
	return async (_id: string, params: { image_source: string; prompt: string }) => {
		const url = resolveImage(params.image_source);
		const text = await analyzeImages(systemPrompt, params.prompt, [url]);
		return { content: [{ type: "text" as const, text }], details: { model: "glm-4.6v" } };
	};
}

export function registerVisionTools(pi: ExtensionAPI) {
	// 1. ui_to_artifact
	pi.registerTool({
		name: "ui_to_artifact",
		label: "UI 转制品",
		description: `Convert UI screenshots into various artifacts: code, prompts, design specifications, or descriptions.
Use this tool ONLY when the user wants to: generate frontend code from UI design (output_type='code'); create AI prompts for UI generation (output_type='prompt'); extract design specifications (output_type='spec'); get natural language description of the UI (output_type='description').
Do NOT use for: screenshots containing text/code to extract, error messages, diagrams, or data visualizations.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			output_type: StringEnum(["code", "prompt", "spec", "description"] as const, {
				description:
					"Type of output to generate. 'code' (frontend code), 'prompt' (AI prompt to recreate UI), 'spec' (design specification), 'description' (natural language description).",
			}),
			prompt: Type.String({ description: "Detailed instructions describing what to generate from this UI image." }),
		}),
		async execute(_id, params) {
			const mode = params.output_type as UiArtifactMode;
			const url = resolveImage(params.image_source);
			const text = await analyzeImages(UI_TO_ARTIFACT_PROMPTS[mode], params.prompt, [url]);
			return { content: [{ type: "text" as const, text }], details: { model: "glm-4.6v", output_type: mode } };
		},
	});

	// 2. extract_text_from_screenshot
	pi.registerTool({
		name: "extract_text_from_screenshot",
		label: "截图文字提取",
		description: `Extract and recognize text from screenshots using advanced OCR capabilities.
Use this tool ONLY when the user has a screenshot containing text and wants to extract it. Specializes in OCR for code, terminal output, documentation, and general text.
Do NOT use for: UI design conversion, error diagnosis, or diagram understanding.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			prompt: Type.String({
				description: "Instructions for text extraction. Specify what type of text to extract and any formatting requirements.",
			}),
			programming_language: Type.Optional(
				Type.String({
					description:
						"Optional: specify the programming language if the screenshot contains code (e.g. 'python', 'javascript'). Leave empty for auto-detection or non-code text.",
				}),
			),
		}),
		async execute(_id, params) {
			const url = resolveImage(params.image_source);
			const prompt = params.programming_language?.trim()
				? `${params.prompt}\n\n<language_hint>The code is in ${params.programming_language}.</language_hint>`
				: params.prompt;
			const text = await analyzeImages(TEXT_EXTRACTION_PROMPT, prompt, [url]);
			return { content: [{ type: "text" as const, text }], details: { model: "glm-4.6v" } };
		},
	});

	// 3. diagnose_error_screenshot
	pi.registerTool({
		name: "diagnose_error_screenshot",
		label: "错误截图诊断",
		description: `Diagnose errors from screenshots of error dialogs, stack traces, and log output. Provides root cause analysis and actionable fix suggestions.
Use this tool ONLY when the user has a screenshot of an error (error dialog, exception stack trace, failed log output) and wants to understand and fix it.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			prompt: Type.String({ description: "Describe the error context and what you want to know (root cause / fix / prevention)." }),
		}),
		execute: singleImageExecute(ERROR_DIAGNOSIS_PROMPT),
	});

	// 4. understand_technical_diagram
	pi.registerTool({
		name: "understand_technical_diagram",
		label: "技术图纸解读",
		description: `Generate structured interpretation for architecture diagrams, flowcharts, UML, ER diagrams and other technical drawings.
Use this tool ONLY when the user has a technical diagram and wants to understand its structure, components, relationships, and design rationale.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			prompt: Type.String({ description: "What aspects of the diagram to explain (structure / data flow / patterns / concerns)." }),
		}),
		execute: singleImageExecute(DIAGRAM_UNDERSTANDING_PROMPT),
	});

	// 5. analyze_data_visualization
	pi.registerTool({
		name: "analyze_data_visualization",
		label: "数据图表分析",
		description: `Read dashboards and statistical charts, distill trends, anomalies, and business takeaways.
Use this tool ONLY when the user has a chart/dashboard/plot and wants insights, trends, anomalies, and actionable recommendations from the data.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			prompt: Type.String({ description: "What metrics/insights to extract and any business context for interpretation." }),
		}),
		execute: singleImageExecute(DATA_VIZ_ANALYSIS_PROMPT),
	});

	// 6. ui_diff_check
	pi.registerTool({
		name: "ui_diff_check",
		label: "UI 差异对比",
		description: `Compare two UI screenshots to identify visual differences and implementation discrepancies. Specialized for UI QA and design-to-implementation verification.
Use this tool ONLY when comparing an expected/reference UI with an actual implementation. Requires TWO images.
Do NOT use for: general image comparison, error diagnosis, or analyzing single UIs.`,
		parameters: Type.Object({
			expected_image_source: Type.String({ description: "Local file path or remote URL to the EXPECTED/reference design image" }),
			actual_image_source: Type.String({ description: "Local file path or remote URL to the ACTUAL/current implementation image" }),
			prompt: Type.String({ description: "Instructions for the comparison. Specify what aspects to focus on or detail level." }),
		}),
		async execute(_id, params) {
			const expected = resolveImage(params.expected_image_source);
			const actual = resolveImage(params.actual_image_source);
			const enhanced = `<images>
The first image is the EXPECTED/REFERENCE design (the target).
The second image is the ACTUAL/CURRENT implementation (what needs to be checked).
</images>

${params.prompt}`;
			const text = await analyzeImages(UI_DIFF_CHECK_PROMPT, enhanced, [expected, actual]);
			return { content: [{ type: "text" as const, text }], details: { model: "glm-4.6v" } };
		},
	});

	// 7. analyze_image
	pi.registerTool({
		name: "analyze_image",
		label: "通用图像分析",
		description: `General-purpose image analysis for scenarios not covered by specialized tools.
Use this tool as a FALLBACK when none of the other specialized tools (ui_to_artifact, extract_text_from_screenshot, diagnose_error_screenshot, understand_technical_diagram, analyze_data_visualization, ui_diff_check) fit.
Provides flexible image understanding for any visual content.`,
		parameters: Type.Object({
			image_source: Type.String({ description: "Local file path or remote URL to the image" }),
			prompt: Type.String({ description: "Detailed description of what you want to analyze, extract, or understand from the image." }),
		}),
		execute: singleImageExecute(GENERAL_IMAGE_ANALYSIS_PROMPT),
	});

	// 8. analyze_video
	pi.registerTool({
		name: "analyze_video",
		label: "视频内容分析",
		description: `Analyze video content using GLM-4.6V. Understand what happens in a video, extract key moments/actions, analyze scenes or sequences.
Supports both local files and remote URL. Maximum file size: 8MB. Supports MP4, MOV, M4V.`,
		parameters: Type.Object({
			video_source: Type.String({ description: "Local file path or remote URL to the video (supports MP4, MOV, M4V)" }),
			prompt: Type.String({ description: "Detailed text prompt describing what to analyze, extract, or understand from the video." }),
		}),
		async execute(_id, params) {
			const url = resolveVideo(params.video_source);
			const messages: ChatMessage[] = [
				{
					role: "user",
					content: [
						{ type: "video_url", video_url: { url } },
						{ type: "text", text: params.prompt },
					],
				},
			];
			const text = await visionChat(messages);
			return { content: [{ type: "text" as const, text }], details: { model: "glm-4.6v" } };
		},
	});
}
