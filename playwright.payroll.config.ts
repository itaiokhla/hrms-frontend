import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Payroll v2 journeys for Alpha Technologies (IN/INR), Beta Logistics (AE/AED) and Gamma Solutions
 * (US/USD) in installed Google Chrome (Goal 2 §18-§20, §24). Isolated stack (ARCHITECTURE.md §12):
 *
 *   hrms-backend:  venv/Scripts/python.exe scripts/payroll_stack.py reset          # only .local-postgres-payroll
 *                  venv/Scripts/python.exe scripts/payroll_stack.py serve          # API on 8400 (keep running)
 *                  venv/Scripts/python.exe scripts/seed_payroll_three_companies.py --api http://localhost:8400/api/v1
 *                  venv/Scripts/python.exe scripts/verify_payroll_seed.py
 *   hrms-frontend: NEXT_DIST_DIR=.next-payroll BACKEND_URL=http://localhost:8400 \
 *                    ../hrms-backend/venv/Scripts/python.exe ../hrms-backend/scripts/run_exclusive.py -- npx next build
 *                  NEXT_DIST_DIR=.next-payroll BACKEND_URL=http://localhost:8400 npx next start -p 3400
 *   then:          ../hrms-backend/venv/Scripts/python.exe ../hrms-backend/scripts/run_exclusive.py -- \
 *                    npx playwright test -c playwright.payroll.config.ts
 *
 * Credentials come from the git-ignored hrms-backend/.local-secrets/payroll-credentials.json written by
 * the seed. The journeys change data (runs finalized, batches prepared, settings changed): reset and
 * reseed before a full re-run. Read-only DB assertions use hrms-backend/scripts/e2e_payroll_db.py.
 * E2E_HEADED=1 opens a visible Chrome window (review mode); the default is headless Chrome (low-RAM machine).
 */
const EVIDENCE_DATE = process.env.E2E_EVIDENCE_DATE ?? new Date().toISOString().slice(0, 10);
process.env.E2E_PAYROLL_EVIDENCE ??= path.join(__dirname, "test-evidence", `${EVIDENCE_DATE}-payroll`);

export default defineConfig({
  testDir: "./e2e-payroll",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-payroll" }],
    ["json", { outputFile: "test-results-payroll/results.json" }],
  ],
  outputDir: "test-results-payroll",
  use: {
    baseURL: process.env.E2E_PAYROLL_BASE_URL ?? "http://localhost:3400",
    channel: "chrome",
    headless: process.env.E2E_HEADED !== "1",
    viewport: { width: 1400, height: 880 },
    video: "on",
    screenshot: "on",
    trace: "on",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
});
