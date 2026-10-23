/**
 * Shared helpers for the payroll Chrome suite (playwright.payroll.config.ts).
 *
 * - three-tenant login helpers that read the git-ignored credential guide written by
 *   hrms-backend/scripts/seed_payroll_three_companies.py (never printed, never in evidence);
 * - role-specific, isolated Chrome contexts that record every API response status, console error and
 *   page error (for "no leakage" assertions and the sanitized network evidence);
 * - in-browser API calls (the user's own cookies + CSRF, exactly what a tampering user could send);
 * - read-only DB assertions through hrms-backend/scripts/e2e_payroll_db.py (payroll stack only);
 * - step-up codes read from the stack's development e-mail outbox (logs/outbox-payroll).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

export { expect, test };

export const BACKEND = path.join(__dirname, "..", "..", "hrms-backend");
const PYTHON = path.join(BACKEND, "venv", "Scripts", "python.exe");
export const EVIDENCE = process.env.E2E_PAYROLL_EVIDENCE ?? path.join(__dirname, "..", "test-evidence", "payroll");

export type CompanyKey = "alpha" | "beta" | "gamma";
export const KEYS: CompanyKey[] = ["alpha", "beta", "gamma"];
export const BRAND: Record<CompanyKey, string> = { alpha: "Alpha People", beta: "Beta Workforce", gamma: "Gamma HR Cloud" };
export const CURRENCY: Record<CompanyKey, string> = { alpha: "INR", beta: "AED", gamma: "USD" };
export const COMPANY_NAME: Record<CompanyKey, string> = {
  alpha: "Alpha Technologies",
  beta: "Beta Logistics",
  gamma: "Gamma Solutions",
};

export interface Account {
  email: string;
  password: string;
  name: string;
  roles: string[];
  [key: string]: unknown;
}
export interface CompanyCreds {
  name: string;
  company_id: number;
  slug: string;
  accounts: Record<string, Account>;
  runs: Record<string, { id: number; pay_group: string; period: [string, string]; status: string }>;
  [key: string]: unknown;
}
export interface Creds {
  api: string;
  anchors: Record<string, unknown>;
  blocked: unknown[];
  companies: Record<CompanyKey, CompanyCreds>;
}

let cached: Creds | null = null;
/** The seed's credential guide (git-ignored). */
export function creds(): Creds {
  if (!cached) {
    const file = process.env.E2E_PAYROLL_SECRETS ?? path.join(BACKEND, ".local-secrets", "payroll-credentials.json");
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as Creds;
  }
  return cached;
}
export const company = (key: CompanyKey) => creds().companies[key];
export const account = (key: CompanyKey, role: string): Account => {
  const a = company(key).accounts[role];
  if (!a) throw new Error(`No ${role} account for ${key} in the credential guide`);
  return a;
};

/* ------------------------------------------------------------------ evidence */
export function evidencePath(name: string): string {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  return path.join(EVIDENCE, name);
}

export function writeEvidence(name: string, data: unknown) {
  fs.writeFileSync(evidencePath(name), JSON.stringify(data, null, 2));
}

/** Append one record to an evidence JSON array (journey step log, financial table, denials). */
export function appendEvidence(name: string, record: unknown) {
  const file = evidencePath(name);
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    rows = [];
  }
  rows.push(record);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

/**
 * Screenshot to the evidence folder and the report. Inputs of type password and every element marked
 * as sensitive are masked (Playwright paints a box over them), so no secret reaches an image.
 */
export async function shot(page: Page, testInfo: TestInfo, name: string, opts: { fullPage?: boolean; mask?: Locator[] } = {}) {
  const file = evidencePath(`${name}.png`);
  await page.screenshot({
    path: file,
    fullPage: opts.fullPage ?? false,
    mask: [page.locator("input[type=password]"), page.locator("[data-sensitive]"), ...(opts.mask ?? [])],
  });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

/* ------------------------------------------------------------------ sessions */
export interface ApiCall {
  method: string;
  path: string;
  status: number;
}
export interface Session {
  name: string;
  key: CompanyKey;
  role: string;
  context: BrowserContext;
  page: Page;
  responses: ApiCall[];
  consoleErrors: string[];
  pageErrors: string[];
  close: () => Promise<void>;
}

/** Strip ids that look like secrets/tokens from logged paths (download tokens, signed links). */
function sanitizePath(url: string): string {
  const u = new URL(url);
  return u.pathname.replace(/\/downloads\/[^/]+/, "/downloads/<token>") + (u.search ? "?…" : "");
}

/** Console messages that are expected noise (denied probes the test itself issued, favicon, HMR). */
const BENIGN_CONSOLE = [/Failed to load resource: the server responded with a status of (401|403|404|409|422)/i, /favicon/i, /Download the React DevTools/i];

/**
 * An isolated Chrome context (own cookies/storage) for one person. Records API responses, console errors
 * and page errors for leakage assertions; the network summary (method, path, status — no bodies) is
 * written to the evidence folder on close.
 */
export async function openSession(
  browser: Browser,
  testInfo: TestInfo,
  key: CompanyKey,
  role: string,
  opts: { viewport?: { width: number; height: number }; label?: string; isMobile?: boolean } = {},
): Promise<Session> {
  const name = `${key}-${opts.label ?? role}`;
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? "http://localhost:3400",
    viewport: opts.viewport ?? { width: 1400, height: 880 },
    isMobile: opts.isMobile,
    hasTouch: opts.isMobile,
    acceptDownloads: true,
    recordVideo: { dir: testInfo.outputPath(`video-${name}`), size: { width: 1280, height: 800 } },
  });
  // Traces: `trace: "on"` in the config records every context of the browser fixture (no manual tracing).
  const page = await context.newPage();
  const session: Session = {
    name, key, role, context, page, responses: [], consoleErrors: [], pageErrors: [],
    close: async () => {
      const video = page.video();
      await context.close();
      if (video) {
        try {
          await testInfo.attach(`video – ${name}`, { path: await video.path(), contentType: "video/webm" });
        } catch {
          /* no video */
        }
      }
      writeEvidence(`network-${testInfo.title.replace(/\W+/g, "-").slice(0, 60)}-${name}.json`, {
        session: name,
        api: session.responses,
        console_errors: session.consoleErrors,
        page_errors: session.pageErrors,
      });
    },
  };
  context.on("response", (r) => {
    const url = r.url();
    if (url.includes("/api/v1/")) session.responses.push({ method: r.request().method(), path: sanitizePath(url), status: r.status() });
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !BENIGN_CONSOLE.some((re) => re.test(m.text()))) session.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => session.pageErrors.push(e.message.slice(0, 300)));
  return session;
}

/** Sign in through the real login form and land on the dashboard. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|me|payroll)/, { timeout: 45_000 });
}

/** Open a signed-in session for one seeded account. */
export async function login(browser: Browser, testInfo: TestInfo, key: CompanyKey, role: string, opts: Parameters<typeof openSession>[4] = {}) {
  const s = await openSession(browser, testInfo, key, role, opts);
  const a = account(key, role);
  await signIn(s.page, a.email, a.password);
  return s;
}

/* ------------------------------------------------------------------ API + DB */
/** Call the API from inside the signed-in browser (the user's cookies and CSRF token). */
export async function api<T = any>(page: Page, method: string, apiPath: string, body?: unknown, headers: Record<string, string> = {}) {
  return page.evaluate(
    async ({ method, apiPath, body, headers }) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1];
      const res = await fetch(`/api/v1${apiPath}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 200);
      }
      return { status: res.status, data, contentType: res.headers.get("content-type") ?? "" };
    },
    { method, apiPath, body, headers },
  ) as Promise<{ status: number; data: T; contentType: string }>;
}

/** Read-only payroll DB query (hrms-backend/scripts/e2e_payroll_db.py). */
export function db<T = Record<string, any>>(query: string, params: Record<string, string | number> = {}): T[] {
  const args = [path.join(BACKEND, "scripts", "e2e_payroll_db.py"), query, ...Object.entries(params).map(([k, v]) => `${k}=${v}`)];
  const out = execFileSync(PYTHON, args, { cwd: BACKEND, encoding: "utf8" });
  return JSON.parse(out) as T[];
}

/**
 * The six-digit step-up code e-mailed to `email` after `since` (ms epoch), read from the stack's
 * development outbox by Python's e-mail parser (handles quoted-printable/base64 bodies).
 */
export async function outboxCode(companyId: number, email: string, since: number, timeoutMs = 20_000): Promise<string> {
  const script = [
    "import email,re,sys,pathlib",
    "from email import policy",
    "folder=pathlib.Path(sys.argv[1]); safe=re.sub(r'[^a-zA-Z0-9@._-]','_',sys.argv[2]); since=float(sys.argv[3])",
    "files=sorted((p for p in folder.glob(f'auth.step_up_code-{safe}-*.eml') if p.stat().st_mtime>=since-1),key=lambda p:p.stat().st_mtime)",
    "code=''",
    "if files:",
    "  m=email.message_from_bytes(files[-1].read_bytes(),policy=policy.default); part=m.get_body(preferencelist=('plain','html'))",
    "  t=part.get_content() if part is not None else ''",
    "  r=re.search(r'Code:\\s*(\\d{6})',t); code=r.group(1) if r else ''",
    "sys.stdout.write(code)",
  ].join("\n");
  const folder = path.join(BACKEND, "logs", "outbox-payroll", String(companyId));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = execFileSync(PYTHON, ["-c", script, folder, email, String(since / 1000)], { cwd: BACKEND, encoding: "utf8" }).trim();
    if (code) return code;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`No step-up code for this account reached the outbox ${folder}`);
}

/** Complete the "Confirm it's you" step-up modal through the UI (e-mailed code). */
export async function completeStepUpModal(page: Page, key: CompanyKey, role: string) {
  const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
  await expect(dialog).toBeVisible();
  const since = Date.now();
  await dialog.getByRole("button", { name: /e-mail me a code|send a new code/i }).click();
  const code = await outboxCode(company(key).company_id, account(key, role).email, since);
  await dialog.getByPlaceholder("123456").fill(code);
  await dialog.getByRole("button", { name: /^confirm$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Step up through the API (for preparation steps that are not under test). */
export async function stepUpApi(page: Page, key: CompanyKey, role: string) {
  const status = await api(page, "GET", "/payroll/step-up");
  if ((status.data as any)?.active) return;
  const since = Date.now();
  const sent = await api(page, "POST", "/payroll/step-up/email-code");
  expect(sent.status, "step-up e-mail code").toBeLessThan(300);
  const code = await outboxCode(company(key).company_id, account(key, role).email, since);
  const ok = await api(page, "POST", "/payroll/step-up", { code });
  expect(ok.status, "step-up verify").toBeLessThan(300);
}

/* ------------------------------------------------------------------ assertions */
/** Expect an authorized denial without disclosure (403/404; never 2xx, never 5xx). */
export function expectDenied(status: number, what: string) {
  expect([401, 403, 404], what).toContain(status);
}

/** The page shows no foreign brand/company and no "select tenant" control. */
export async function expectNoForeignBrand(page: Page, own: CompanyKey) {
  const body = await page.locator("body").innerText();
  for (const other of KEYS.filter((k) => k !== own)) {
    expect(body, `${own} page must not show ${BRAND[other]}`).not.toContain(BRAND[other]);
    expect(body, `${own} page must not show ${COMPANY_NAME[other]}`).not.toContain(COMPANY_NAME[other]);
  }
  await expect(page.getByRole("combobox", { name: /tenant|company switch|switch company/i })).toHaveCount(0);
}

/** No unmasked bank number pattern (long digit runs / full IBAN) in visible text. */
export async function expectNoUnmaskedBankData(page: Page) {
  const body = await page.locator("body").innerText();
  expect(body, "no full IBAN visible").not.toMatch(/\b(AE|IN|US)\d{2}\s?\d{3}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{3}\b/);
  expect(body, "no 9+ digit account number visible").not.toMatch(/(?<![\d.,])\d{11,}(?![\d.,])/);
}

/** Wait until the page is not showing skeletons/spinners (best effort). */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
}

/** Text helper: the visible text of the main region (or body). */
export async function mainText(page: Page): Promise<string> {
  const main = page.locator("main");
  return (await main.count()) ? main.first().innerText() : page.locator("body").innerText();
}

/** No horizontal page scroll at this viewport. */
export async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

/** Step log for evidence pack A/B. */
export function step(journey: string, n: number | string, title: string, result: "pass" | "fixme" | "info", detail: unknown = null) {
  appendEvidence(`steps-${journey}.json`, { step: n, title, result, detail, at: new Date().toISOString() });
}
