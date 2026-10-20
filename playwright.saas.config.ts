import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Multi-tenant SaaS audit journeys for Alpha Technologies, Beta Logistics and Gamma Solutions plus
 * two partners, in installed Google Chrome. See hrms-backend/docs/saas/C-three-company-seed.md.
 *
 *   hrms-backend (env from .local-secrets/wl-stack.env, PROXY_SHARED_SECRET, DOMAIN_DNS_FIXTURE_FILE=logs/saas-dns.json,
 *                 FRONTEND_URL=http://localhost:3300):
 *                  python scripts/demo_stack.py --fresh --data-dir .local-postgres-saas --port 8300
 *                  python scripts/seed_saas_three_companies.py --api http://localhost:8300/api/v1
 *   hrms-frontend: NEXT_DIST_DIR=.next-saas BACKEND_URL=http://localhost:8300 PLATFORM_HOSTS=localhost,127.0.0.1 \
 *                  PROXY_SHARED_SECRET=<same> npx next build && npx next start -p 3300
 *   then:          npx playwright test -c playwright.saas.config.ts
 *
 * Needs a fresh seed per full run (the branding and leave journeys change data).
 */
process.env.E2E_WL_PORT ??= "3300";
process.env.E2E_PG_DATA ??= ".local-postgres-saas";
process.env.E2E_EVIDENCE ??= path.join(__dirname, "test-evidence", "2026-10-20-saas");

export default defineConfig({
  testDir: "./e2e-saas",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-saas" }], ["json", { outputFile: "test-results-saas/results.json" }]],
  outputDir: "test-results-saas",
  use: {
    baseURL: `http://localhost:${process.env.E2E_WL_PORT}`,
    channel: "chrome",
    headless: process.env.E2E_HEADLESS === "1",
    viewport: { width: 1400, height: 880 },
    video: "on",
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 30) },
  },
});
