/**
 * 媒体源处理：把「本地文件路径 / http url」统一解析成 GLM-4.6V 能接受的 url。
 *
 * 复刻自 @z_ai/mcp-server build/core/file-service.js：
 * - http(s) url：原样返回（智谱服务器自己去拉取）
 * - 本地文件：读成 base64 dataurl
 * - 带格式与大小校验（图片 jpg/jpeg/png ≤5MB；视频 mp4/mov/m4v/avi/wmv/webm ≤8MB）
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];
const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
};
const VIDEO_MIME: Record<string, string> = {
	mp4: "video/mp4",
	mov: "video/quicktime",
	m4v: "video/x-m4v",
	avi: "video/x-msvideo",
	wmv: "video/x-ms-wmv",
	webm: "video/webm",
};

export function isUrl(s: string): boolean {
	try {
		const u = new URL(s);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

function readLocalAsDataUrl(
	source: string,
	maxMB: number,
	kind: "image" | "video",
): string {
	if (!existsSync(source)) {
		throw new Error(`${kind === "image" ? "图片" : "视频"}文件不存在：${source}`);
	}
	const stat = statSync(source);
	if (stat.size > maxMB * 1024 * 1024) {
		throw new Error(
			`${kind === "image" ? "图片" : "视频"}过大：${(stat.size / 1024 / 1024).toFixed(2)}MB，上限 ${maxMB}MB`,
		);
	}
	const ext = extname(source).toLowerCase();
	if (kind === "image" && !IMAGE_EXTS.includes(ext)) {
		throw new Error(`不支持的图片格式：${ext || "(无扩展名)"}，仅支持 ${IMAGE_EXTS.join(", ")}`);
	}
	const key = ext.slice(1);
	const mime = (kind === "image" ? IMAGE_MIME : VIDEO_MIME)[key] ?? `${kind === "image" ? "image" : "video"}/${key || "png"}`;
	const b64 = readFileSync(source).toString("base64");
	return `data:${mime};base64,${b64}`;
}

/** 把图片源解析成 GLM-4.6V 可用的 url（url 直传 / 本地转 base64 dataurl） */
export function resolveImage(source: string, maxMB = 5): string {
	if (isUrl(source)) return source;
	return readLocalAsDataUrl(source, maxMB, "image");
}

/** 把视频源解析成 GLM-4.6V 可用的 url */
export function resolveVideo(source: string, maxMB = 8): string {
	if (isUrl(source)) return source;
	return readLocalAsDataUrl(source, maxMB, "video");
}
