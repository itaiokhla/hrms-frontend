import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Attendance / lunch / location journeys for three synthetic companies, in installed Google Chrome.
 *
 *   hrms-backend:  python scripts/demo_stack.py --fresh --data-dir .local-postgres-e2e --port 8100
 *                  python scripts/seed_gps_e2e.py --api http://localhost:8100/api/v1
 *   hrms-frontend: NEXT_DIST_DIR=.next-e2e BACKEND_URL=http://localhost:8100 npx next build
 *                  NEXT_DIST_DIR=.next-e2e npx next start -p 3100
 *   then:          npx playwright test -c playwright.gps.config.ts
 *
 * Locations are synthetic (Chrome's geolocation emulation): these runs verify the
 * software, not real-world GPS accuracy or how long a hidden tab keeps running.
 */
const fakeCamera = path.join(__dirname, "e2e", "fixtures", "face-stream.mjpeg");

export default defineConfig({
  testDir: "./e2e-gps",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-gps" }], ["json", { outputFile: "test-results-gps/results.json" }]],
  outputDir: "test-results-gps",
  globalSetup: "./e2e-gps/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome",
    headless: process.env.E2E_HEADLESS === "1",
    viewport: { width: 1440, height: 900 },
    permissions: ["camera"],
    video: "on",
    screenshot: "on",
    trace: "on",
    actionTimeout: 20_000,
    launchOptions: {
      slowMo: Number(process.env.E2E_SLOWMO ?? 60),
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${fakeCamera}`,
      ],
    },
  },
});
