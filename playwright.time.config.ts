import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * The integrated time stack shared by leave-holiday and attendance-shift goals (docs/README.md §4; AS 14 IG-AS-05,
 * LH 14 IG-04). Never the user's demo stack (8000/3000) or another suite's ports.
 *
 *   hrms-backend:  venv/Scripts/python.exe scripts/demo_stack.py --fresh --data-dir .local-postgres-time --port 8500
 *                  venv/Scripts/python.exe scripts/seed_time_three_companies.py --api http://localhost:8500/api/v1
 *   hrms-frontend: NEXT_DIST_DIR=.next-time BACKEND_URL=http://localhost:8500 \
 *                    ../hrms-backend/venv/Scripts/python.exe ../hrms-backend/scripts/run_exclusive.py -- npx next build
 *                  NEXT_DIST_DIR=.next-time BACKEND_URL=http://localhost:8500 npx next start -p 3500
 *   then:          ../hrms-backend/venv/Scripts/python.exe ../hrms-backend/scripts/run_exclusive.py -- \
 *                    npx playwright test -c playwright.time.config.ts --project e2e-as
 *
 * Credentials come from the git-ignored hrms-backend/.local-secrets/time-credentials.json written by the seed.
 * Evidence (screenshots per check) goes to test-evidence/<date>-g<NN>/ (E2E_TIME_GOAL, default g01).
 */
const EVIDENCE_DATE = process.env.E2E_EVIDENCE_DATE ?? new Date().toISOString().slice(0, 10);
process.env.E2E_TIME_EVIDENCE ??= path.join(__dirname, "test-evidence", `${EVIDENCE_DATE}-${process.env.E2E_TIME_GOAL ?? "g01"}`);

const baseURL = process.env.E2E_TIME_BASE_URL ?? "http://localhost:3500";
if (/:(3000|3100|3200|3300|3400)\b/.test(baseURL)) throw new Error(`${baseURL} belongs to another stack; the time stack is 3500.`);

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-time" }],
    ["json", { outputFile: "test-results-time/results.json" }],
  ],
  outputDir: "test-results-time",
  use: {
    baseURL,
    channel: "chrome",
    headless: process.env.E2E_HEADED !== "1",
    viewport: { width: 1400, height: 880 },
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    timezoneId: "Asia/Kolkata",
  },
  projects: [
    { name: "e2e-lh", testDir: "./e2e-lh" },
    { name: "e2e-as", testDir: "./e2e-as" },
  ],
});
