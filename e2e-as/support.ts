/**
 * Shared helpers of the time-stack suites (playwright.time.config.ts: projects e2e-as and e2e-lh).
 * Accounts come from the git-ignored credential file of hrms-backend/scripts/seed_time_three_companies.py; passwords
 * are never printed, and screenshots mask password inputs.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

export { expect, test };

export const BACKEND = path.join(__dirname, "..", "..", "hrms-backend");
export const EVIDENCE = process.env.E2E_TIME_EVIDENCE ?? path.join(__dirname, "..", "test-evidence", "time");

export type CompanyKey = "alpha" | "beta" | "gamma";

interface Account {
  email: string;
  password: string;
  name: string;
}
interface Store {
  companies: Record<CompanyKey, { company_id: number; accounts: Record<string, Account>; ids: Record<string, any> }>;
}

let cached: Store | null = null;
export function store(): Store {
  if (!cached) {
    const file = process.env.E2E_TIME_SECRETS ?? path.join(BACKEND, ".local-secrets", "time-credentials.json");
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as Store;
  }
  return cached;
}

export const account = (key: CompanyKey, person: string): Account => {
  const a = store().companies[key].accounts[person];
  if (!a) throw new Error(`No ${person} account for ${key} in the time-stack credential file`);
  return a;
};

export const employeeId = (key: CompanyKey, person: string): number => store().companies[key].ids.people[person].employee_id;

export async function signIn(page: Page, key: CompanyKey, person: string) {
  const a = account(key, person);
  await page.goto("/login");
  await page.locator("#email").fill(a.email);
  await page.locator("#password").fill(a.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|me|attendance|leaves)/, { timeout: 45_000 });
}

/** A separate signed-in Chrome context for one person (closed by the caller). */
export async function openAs(browser: Browser, key: CompanyKey, person: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, person);
  return { page, close: () => context.close() };
}

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const file = path.join(EVIDENCE, `${name}.png`);
  await page.screenshot({ path: file, mask: [page.locator("input[type=password]")] });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

/** Call the API from inside the signed-in page (the person's cookies and CSRF token). */
export async function api<T = any>(page: Page, method: string, apiPath: string, body?: unknown) {
  return page.evaluate(
    async ({ method, apiPath, body }) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1];
      const res = await fetch(`/api/v1${apiPath}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 200);
      }
      return { status: res.status, data: data as any };
    },
    { method, apiPath, body },
  ) as Promise<{ status: number; data: T }>;
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}
