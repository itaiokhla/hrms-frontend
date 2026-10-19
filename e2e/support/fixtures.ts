import fs from "node:fs";
import path from "node:path";

import { expect, test as base, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import * as OTPAuth from "otpauth";

export const PASSWORD = "Demo@12345";
/** Nikhil's password after the password-reset test (02) changes it. */
export const NIKHIL_NEW_PASSWORD = "Reset@2026x";
export const PLATFORM = { email: "ops@hrms-platform.io", password: "Platform@12345" };

export const NIMBUS = {
  name: "Nimbus Technologies",
  admin: "ananya.rao@nimbustech.io",
  hr: "vikram.shah@nimbustech.io",
  recruiter: "pooja.sharma@nimbustech.io",
  finance: "priya.nair@nimbustech.io",
  payroll: "karan.mehta@nimbustech.io",
  auditor: "neha.joshi@nimbustech.io",
  vp: "rohan.gupta@nimbustech.io",
  manager: "sneha.iyer@nimbustech.io",
  lead: "arjun.das@nimbustech.io",
  divya: "divya.menon@nimbustech.io",
  farhan: "farhan.ali@nimbustech.io",
  meera: "meera.pillai@nimbustech.io",
  nikhil: "nikhil.jain@nimbustech.io",
  sales: "tara.kapoor@nimbustech.io",
  rahul: "rahul.verma@nimbustech.io",
  isha: "isha.bose@nimbustech.io",
};

export const SAFFRON = {
  name: "Saffron Foods",
  admin: "rajesh.kumar@saffronfoods.in",
  hr: "kavita.menon@saffronfoods.in",
  plant: "suresh.pillai@saffronfoods.in",
  supervisor: "lakshmi.narayanan@saffronfoods.in",
  ramesh: "ramesh.babu@saffronfoods.in",
  ganesh: "ganesh.murthy@saffronfoods.in",
  pooja: "pooja.sharma@saffronfoods.in",
  accounts: "deepa.raghavan@saffronfoods.in",
};

export const ORBIT = {
  name: "Orbit Logistics",
  admin: "daniel.dsouza@orbitlogistics.io",
  ops: "fatima.khan@orbitlogistics.io",
  joseph: "joseph.mathew@orbitlogistics.io",
  aman: "aman.verma@orbitlogistics.io",
};

export const FIXTURES = path.join(__dirname, "..", "fixtures");
const BACKEND_LOG =
  process.env.E2E_BACKEND_LOG ?? path.join(__dirname, "..", "..", "..", "hrms-backend", "logs", "demo-backend.log");

/** Date helper in yyyy-mm-dd, offset from today (local time). */
export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------------ narration */
const NARRATION = () => {
  // The caption lives in a *closed* shadow root: visible to whoever watches the run,
  // but invisible to Playwright selectors, so it can never satisfy or break a query.
  let label: HTMLElement | null = null;
  const render = () => {
    let text: string | null = null;
    try {
      text = sessionStorage.getItem("__e2e_step");
    } catch {
      return; // the blank page a new window starts on has no storage
    }
    if (!text || !document.body) return;
    if (!label || !label.isConnected) {
      const host = document.createElement("div");
      host.id = "__e2e_banner";
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: "2147483647",
        pointerEvents: "none", background: "rgba(17,20,40,0.92)", color: "#fff", padding: "10px 18px",
        borderRadius: "999px", font: "600 14px/1.3 system-ui, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        maxWidth: "90vw", textAlign: "center",
      });
      label = document.createElement("span");
      host.attachShadow({ mode: "closed" }).appendChild(label);
      document.getElementById("__e2e_banner")?.remove();
      document.body.appendChild(host);
    }
    label.textContent = `▶ ${text}`;
  };
  window.addEventListener("__e2e_step", render);
  document.addEventListener("DOMContentLoaded", render);
  setInterval(render, 700);
};

export async function narrate(page: Page, text: string) {
  await page
    .evaluate((t) => {
      sessionStorage.setItem("__e2e_step", t);
      window.dispatchEvent(new Event("__e2e_step"));
    }, text)
    .catch(() => undefined);
}

/** test.step that also shows the step title on screen for whoever is watching. */
export async function step<T>(page: Page | Page[], title: string, body: () => Promise<T>): Promise<T> {
  return base.step(title, async () => {
    for (const p of Array.isArray(page) ? page : [page]) await narrate(p, title);
    return body();
  });
}

/* ------------------------------------------------------------------ fixtures */
type Fixtures = { pageErrors: string[] };

export const test = base.extend<Fixtures>({
  pageErrors: [
    async ({ page, context }, use) => {
      await context.addInitScript(NARRATION);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Tailwind's `lg` breakpoint: below it the sidebar becomes a drawer behind "Open menu". */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 1024;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  const shell = isPhone(page)
    ? page.getByRole("button", { name: "Open menu" })
    : page.getByRole("navigation", { name: "Main" });
  await expect(shell).toBeVisible();
}

/** The page's own error/notice banner (Next.js also renders an empty role=alert route announcer). */
export function formAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export interface Actor {
  name: string;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/** A separate browser window for another person, recorded to its own video. */
export async function openAs(
  browser: Browser,
  testInfo: TestInfo,
  name: string,
  email?: string,
  options: { password?: string; viewport?: { width: number; height: number }; isMobile?: boolean } = {},
): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: options.viewport ?? { width: 1360, height: 860 },
    isMobile: options.isMobile,
    hasTouch: options.isMobile,
    permissions: ["camera"],
    recordVideo: { dir: testInfo.outputPath(`video-${name.replace(/\W+/g, "-")}`), size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(NARRATION);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (email) await login(page, email, options.password);
  return {
    name,
    context,
    page,
    close: async () => {
      const video = page.video();
      await context.close();
      if (video) await testInfo.attach(`video – ${name}`, { path: await video.path(), contentType: "video/webm" });
      expect(errors, `uncaught errors in ${name}'s window`).toEqual([]);
    },
  };
}

export interface ApiResult<T = unknown> {
  status: number;
  data: T;
}

/** Call the API from inside the signed-in browser, exactly as a tampering user could. */
export async function api<T = any>(page: Page, method: string, apiPath: string, body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, apiPath, body }) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1];
      const res = await fetch(`/api/v1${apiPath}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { status: res.status, data };
    },
    { method, apiPath, body },
  ) as Promise<ApiResult<T>>;
}

export async function sidebarLinks(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  return (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

/** Development mode writes one-time codes and invitation links to the backend log. */
export async function lastDevEmail(to: string, kind: "code" | "url", timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const pattern = new RegExp(`\\[DEV ONLY\\] Email to ${to.replace(/[.+]/g, "\\$&")} \\([^)]*\\): ${kind}=(\\S+)`, "g");
  while (Date.now() < deadline) {
    const text = fs.existsSync(BACKEND_LOG) ? fs.readFileSync(BACKEND_LOG, "utf8") : "";
    const matches = [...text.matchAll(pattern)];
    if (matches.length) return matches[matches.length - 1][1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No development email for ${to} found in ${BACKEND_LOG}`);
}

const lastTotpStep = new Map<string, number>();

/**
 * The authenticator's current code. The server accepts each code only once, so if
 * this run already used the current 30-second step, wait for the next one, just as
 * a person would wait for their app to show a new code.
 */
export async function totp(secret: string): Promise<string> {
  const period = 30_000;
  while (Math.floor(Date.now() / period) <= (lastTotpStep.get(secret) ?? -1)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const step = Math.floor(Date.now() / period);
  lastTotpStep.set(secret, step);
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: step * period,
  });
}

/**
 * Waits for a toast with this text, then marks it as seen. A later check for the same
 * message therefore needs a new toast: one still fading out from the previous action
 * (they stay in the DOM ~4.5 s) can't satisfy it.
 */
export async function toast(page: Page, text: string | RegExp) {
  const fresh = page
    .getByRole("status")
    .filter({ hasText: text })
    .and(page.locator(":not([data-e2e-seen])"))
    .first();
  await expect(fresh).toBeVisible();
  await fresh.evaluate((el) => el.setAttribute("data-e2e-seen", "")).catch(() => undefined);
}

export async function openEmployee(page: Page, fullName: string) {
  await page.goto("/employees");
  await page.getByPlaceholder("Search name, email, code or role").fill(fullName);
  // Full names are unique within a company, so the debounced search settles on one row.
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(fullName);
  await rows.first().click();
  await expect(page.getByRole("dialog", { name: fullName })).toBeVisible();
}

/** Waits until the (fake) webcam is streaming real frames, instead of a fixed sleep. */
export async function cameraReady(page: Page) {
  await expect(page.locator("video")).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("video")?.videoHeight ?? 0) > 0);
  await page.waitForTimeout(400); // a few frames for the capture
}
