import { defineConfig } from "@playwright/test";

/**
 * White-label and multi-company journeys for three branded companies, in installed Google Chrome.
 *
 *   hrms-backend (env from .local-secrets/wl-stack.env, PROXY_SHARED_SECRET, DOMAIN_DNS_FIXTURE_FILE=logs/wl-dns.json):
 *                  python scripts/demo_stack.py --fresh --data-dir .local-postgres-wl --port 8200
 *                  python scripts/seed_white_label_e2e.py --api http://localhost:8200/api/v1
 *   hrms-frontend: NEXT_DIST_DIR=.next-wl BACKEND_URL=http://localhost:8200 PLATFORM_HOSTS=localhost,127.0.0.1 \
 *                  PROXY_SHARED_SECRET=<same> npx next build && npx next start -p 3200
 *   then:          npx playwright test -c playwright.wl.config.ts
 *
 * Tenant hosts are *.hrms.localhost and the custom domain is people.betagulf.localhost; Chrome
 * resolves every *.localhost name to this machine. DNS records come from a local fixture and
 * TLS is simulated, so these runs verify the software, not real DNS or certificates.
 */
export default defineConfig({
  testDir: "./e2e-wl",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-wl" }], ["json", { outputFile: "test-results-wl/results.json" }]],
  outputDir: "test-results-wl",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3200",
    channel: "chrome",
    headless: process.env.E2E_HEADLESS === "1",
    viewport: { width: 1400, height: 880 },
    video: "on",
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 40) },
  },
});
