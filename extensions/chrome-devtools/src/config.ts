/**
 * chrome-devtools 扩展的配置加载（纯逻辑，无 CDP / pi 包依赖）。
 *
 * 从 index.ts 抽出，便于单元测试端口优先级解析。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 与 pi 的 CONFIG_DIR_NAME 一致。
 * 此处内联以解除对 pi 包的运行时依赖（便于测试）。
 * ⚠️ 静默耦合：pi 若改配置目录名，这里不会报错——已加护栏测试断言此值，
 *    改 pi 时须同步此处（见 test/config.test.ts）。
 */
export const CONFIG_DIR_NAME = ".pi";

export const DEFAULT_PORT = 19999;
const CONFIG_FILENAME = "chrome-devtools.json";

/** 端口号合法性校验（环境变量与配置文件入口共用，保持一致）。 */
function isValidPort(port: number): boolean {
	return port > 0 && port <= 65535;
}

/** 读取并解析 JSON 配置文件，失败返回 null。 */
export function readJsonConfig<T>(filePath: string): T | null {
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

/**
 * 按优先级解析调试端口：环境变量 > 项目配置 > 全局配置 > 默认值。
 * 三个入口的端口校验规则一致（1~65535）。
 * @returns 端口及来源描述（来源用于日志/提示）。
 */
export function loadConfig(cwd: string): { port: number; source: string } {
	const envPort = process.env.CHROME_DEBUG_PORT;
	if (envPort) {
		const port = parseInt(envPort, 10);
		if (!isNaN(port) && isValidPort(port)) {
			return { port, source: `环境变量 CHROME_DEBUG_PORT=${port}` };
		}
	}

	const projectConfigPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
	if (existsSync(projectConfigPath)) {
		const config = readJsonConfig<{ port?: number }>(projectConfigPath);
		if (config?.port != null && isValidPort(config.port)) {
			return { port: config.port, source: `项目配置 ${projectConfigPath}` };
		}
	}

	const homeDir = process.env.USERPROFILE || process.env.HOME || "";
	if (homeDir) {
		const globalConfigPath = join(homeDir, CONFIG_DIR_NAME, "agent", CONFIG_FILENAME);
		if (existsSync(globalConfigPath)) {
			const config = readJsonConfig<{ port?: number }>(globalConfigPath);
			if (config?.port != null && isValidPort(config.port)) {
				return { port: config.port, source: `全局配置 ${globalConfigPath}` };
			}
		}
	}

	return { port: DEFAULT_PORT, source: "默认值" };
}
