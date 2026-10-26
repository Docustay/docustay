// Runs every story as a browser test (addon-vitest; vitest 4 — STACK.md R0.3-b).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(viteConfig, defineConfig({
  test: {
    projects: [{
      extends: true,
      plugins: [storybookTest({ configDir: path.join(dirname, ".storybook") })],
      test: {
        name: "storybook",
        browser: { enabled: true, headless: true, provider: playwright({}), instances: [{ browser: "chromium" }] },
      },
    }],
  },
}));
