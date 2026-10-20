import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Browser tests against a running demo stack:
 *   hrms-backend:  python scripts/demo_stack.py --fresh && python scripts/seed_demo.py
 *   hrms-frontend: npm run build && npm start
 *   then:          npm run e2e            (add --headed to watch in Chrome)
 */
const fakeCamera = path.join(__dirname, "e2e", "fixtures", "face-stream.mjpeg");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    permissions: ["camera"],
    video: "on",
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    launchOptions: {
      slowMo: Number(process.env.E2E_SLOWMO ?? 120),
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${fakeCamera}`,
      ],
    },
  },
});
