import { defineConfig } from "vitest/config";

/**
 * chrome-devtools 扩展测试配置。
 *
 * 当前为最小配置；后续加 coverage（@vitest/coverage-v8）、
 * CDP mock 策略时在此扩展。
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
