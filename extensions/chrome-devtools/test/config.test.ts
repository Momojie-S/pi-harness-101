/**
 * loadConfig 端口优先级单元测试。
 *
 * 用真实临时目录 + 环境变量隔离，保证测试自包含（不依赖机器上的真实配置）。
 * 运行：cd extensions/chrome-devtools && npm test
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_PORT, CONFIG_DIR_NAME } from "../src/config";

describe("loadConfig 端口优先级", () => {
	let tmpRoot: string;
	let savedChromePort: string | undefined;
	let savedHome: string | undefined;
	let savedUserProfile: string | undefined;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "cdp-cfg-"));
		savedChromePort = process.env.CHROME_DEBUG_PORT;
		savedHome = process.env.HOME;
		savedUserProfile = process.env.USERPROFILE;
		delete process.env.CHROME_DEBUG_PORT;
		// 隔离 HOME/USERPROFILE，避免读到机器上的真实全局配置
		process.env.HOME = tmpRoot;
		process.env.USERPROFILE = tmpRoot;
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
		restoreEnv("CHROME_DEBUG_PORT", savedChromePort);
		restoreEnv("HOME", savedHome);
		restoreEnv("USERPROFILE", savedUserProfile);
	});

	function restoreEnv(key: string, value: string | undefined) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	function writeProjectConfig(cwd: string, port: number | undefined) {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "chrome-devtools.json"),
			JSON.stringify({ port }),
		);
	}

	function writeGlobalConfig(home: string, port: number) {
		mkdirSync(join(home, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(home, ".pi", "agent", "chrome-devtools.json"),
			JSON.stringify({ port }),
		);
	}

	it("无任何配置时返回默认端口", () => {
		const cfg = loadConfig(tmpRoot);
		expect(cfg.port).toBe(DEFAULT_PORT);
		expect(cfg.source).toBe("默认值");
	});

	it("环境变量 CHROME_DEBUG_PORT 优先级最高", () => {
		process.env.CHROME_DEBUG_PORT = "9222";
		const cfg = loadConfig(tmpRoot);
		expect(cfg.port).toBe(9222);
		expect(cfg.source).toContain("环境变量");
	});

	it("项目配置 .pi/chrome-devtools.json 次之", () => {
		writeProjectConfig(tmpRoot, 8888);
		const cfg = loadConfig(tmpRoot);
		expect(cfg.port).toBe(8888);
		expect(cfg.source).toContain("项目配置");
	});

	it("全局配置 ~/.pi/agent/chrome-devtools.json 再次之", () => {
		writeGlobalConfig(tmpRoot, 7777);
		const cfg = loadConfig(tmpRoot);
		expect(cfg.port).toBe(7777);
		expect(cfg.source).toContain("全局配置");
	});

	it("环境变量优先于项目配置", () => {
		process.env.CHROME_DEBUG_PORT = "9222";
		writeProjectConfig(tmpRoot, 8888);
		expect(loadConfig(tmpRoot).port).toBe(9222);
	});

	it("项目配置优先于全局配置", () => {
		writeProjectConfig(tmpRoot, 8888);
		writeGlobalConfig(tmpRoot, 7777);
		expect(loadConfig(tmpRoot).port).toBe(8888);
	});

	it("非数字环境变量回退到下一级", () => {
		process.env.CHROME_DEBUG_PORT = "abc";
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("越界环境变量(>65535)回退", () => {
		process.env.CHROME_DEBUG_PORT = "99999";
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("环境变量为 0 回退", () => {
		process.env.CHROME_DEBUG_PORT = "0";
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("环境变量为负数回退", () => {
		process.env.CHROME_DEBUG_PORT = "-1";
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("项目配置缺少 port 字段时回退", () => {
		writeProjectConfig(tmpRoot, undefined);
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("项目配置文件损坏(非 JSON)时回退", () => {
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
		writeFileSync(join(tmpRoot, ".pi", "chrome-devtools.json"), "{not json");
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("项目配置 port 为 0 时回退（与环境变量校验一致）", () => {
		writeProjectConfig(tmpRoot, 0);
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("项目配置 port 越界(>65535)时回退", () => {
		writeProjectConfig(tmpRoot, 99999);
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("项目配置 port 为负数时回退", () => {
		writeProjectConfig(tmpRoot, -1);
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});

	it("HOME 与 USERPROFILE 均为空时不报错（兼容无 HOME 的 CI/Docker）", () => {
		process.env.HOME = "";
		process.env.USERPROFILE = "";
		// 无任何配置 → 默认值；全局配置分支被跳过（homeDir 为空）
		expect(loadConfig(tmpRoot).port).toBe(DEFAULT_PORT);
	});
});

describe("CONFIG_DIR_NAME 同步护栏", () => {
	/**
	 * 此值内联在 src/config.ts，与 pi 的 CONFIG_DIR_NAME 静默耦合。
	 * pi 若改配置目录名，这个测试会失败，提醒同步。
	 */
	it("CONFIG_DIR_NAME 须与 pi 的 '.pi' 保持一致", () => {
		expect(CONFIG_DIR_NAME).toBe(".pi");
	});
});
