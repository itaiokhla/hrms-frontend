import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  BACKEND, BRAND, COMPANY_NAME, KEYS, account, api, company, evidencePath, expect, login, openSession, settle, shot, test, writeEvidence,
  type CompanyKey, type Session,
} from "./support";

/**
 * White label on the payroll pages (Goal 2 §16) in installed Google Chrome: Alpha People, Beta Workforce and
 * Gamma HR Cloud side by side in separate contexts, on every payroll page, in the tab title and favicon, after
 * navigation, Back and reload, under forced backend failures, in the payslip PDF (inheritance PLATFORM → PARTNER →
 * TENANT → LEGAL ENTITY), in e-mails and in-app notifications, and when two tabs publish a brand at once.
 *
 * Inheritance set up by the seed (scripts/seed_payroll_three_companies.py) before any run is finalized:
 * - PLATFORM: "Powered by Intertech HRMS" credit, used by Gamma (a direct tenant that shows the credit);
 * - PARTNER: Beta is a tenant of "Northwind Payroll Partners (fictitious)", whose published credit is
 *   "Powered by Northwind Payroll Cloud" (Beta keeps its own name and colours: the partner grants them);
 * - TENANT: product name, display name, colours and legal footer of each company (Alpha hides the credit);
 * - LEGAL ENTITY: Alpha's IN01 publishes its own document accent (#B45309) and legal footer.
 */

const PRIMARY_HEX: Record<CompanyKey, string> = { alpha: "#4338CA", beta: "#0F766E", gamma: "#EA580C" };
const PLATFORM_CREDIT = "Powered by Intertech HRMS";
const PLATFORM_PRODUCT = "Intertech HRMS";

interface CurrentBrand {
  version: string;
  product_name: string;
  display_name: string;
  icons: Record<string, string | null>;
  tokens: { light: Record<string, string> } | null;
  powered_by_label: string;
  show_powered_by: boolean;
}

/** What Chrome shows as the brand of the current page (server-rendered first paint + client shell). */
async function chromeBrand(page: Session["page"]) {
  return page.evaluate(() => ({
    title: document.title,
    product: document.querySelector('[data-testid="sidebar-product"]')?.textContent?.trim() ?? null,
    display: document.querySelector('[data-testid="sidebar-brand"]')?.getAttribute("title") ?? null,
    icons: Array.from(document.querySelectorAll("link[rel~=icon]")).map((l) => l.getAttribute("href") ?? ""),
    version: document.documentElement.getAttribute("data-brand-version"),
    primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    html: document.documentElement.outerHTML,
  }));
}

/** Names that must never appear anywhere in another company's page (DOM, inline data, title). */
function foreignNames(own: CompanyKey): string[] {
  return KEYS.filter((k) => k !== own).flatMap((k) => [BRAND[k], COMPANY_NAME[k]]);
}

async function expectOwnBrand(s: Session, own: CurrentBrand, others: CurrentBrand[], where: string) {
  const seen = await chromeBrand(s.page);
  const label = `${s.name} on ${where}`;
  expect(seen.product, `${label}: sidebar product name`).toBe(own.product_name);
  expect(seen.display, `${label}: sidebar display name`).toBe(own.display_name);
  expect(seen.title, `${label}: tab title`).toContain(own.product_name);
  expect(seen.version, `${label}: brand version of the first paint`).toBe(own.version);
  expect(seen.primary, `${label}: primary colour token`).toBe(own.tokens!.light.primary);
  const ownIcons = Object.values(own.icons).filter(Boolean) as string[];
  expect(seen.icons.length, `${label}: favicon links`).toBeGreaterThan(0);
  for (const href of seen.icons) expect(ownIcons, `${label}: favicon ${href} belongs to the own brand`).toContain(href);
  for (const other of others) {
    for (const href of Object.values(other.icons).filter(Boolean) as string[]) {
      expect(seen.html, `${label}: no favicon/asset of ${other.product_name}`).not.toContain(href);
    }
  }
  for (const name of foreignNames(s.key)) expect(seen.html, `${label}: no "${name}" anywhere in the page`).not.toContain(name);
  await expect(s.page.getByRole("combobox", { name: /tenant|company switch|switch company/i })).toHaveCount(0);
  return seen;
}

async function brandOf(s: Session): Promise<CurrentBrand> {
  const r = await api<CurrentBrand>(s.page, "GET", "/branding/current");
  expect(r.status, `${s.name} GET /branding/current`).toBe(200);
  return r.data;
}

function pdfInfo(file: string, png?: string) {
  const args = [path.join(BACKEND, "scripts", "e2e_pdf.py"), file, ...(png ? [png] : [])];
  return JSON.parse(execFileSync(path.join(BACKEND, "venv", "Scripts", "python.exe"), args, {
    cwd: BACKEND, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  })) as { sha256: string; pages: number; text: string; metadata: Record<string, string>; fill_colours: string[]; has_black_square: boolean };
}

interface OutboxMail { template: string; file_id: string; from_name: string; subject: string; text: string; html_colours: string[]; html_has_image: boolean }
function outbox(companyId: number, prefix = "payroll."): OutboxMail[] {
  const out = execFileSync(path.join(BACKEND, "venv", "Scripts", "python.exe"), [path.join(BACKEND, "scripts", "e2e_payroll_outbox.py"), String(companyId), prefix], {
    cwd: BACKEND, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(out) as OutboxMail[];
}

const ADMIN_PAGES = (key: CompanyKey) => [
  "/dashboard", "/payroll", "/settings/payroll/general", "/payroll/components", "/payroll/structures",
  `/payroll/runs/${company(key).runs.finalized.id}`, "/payroll/approvals", "/payroll/bank-details", "/payroll/payslips",
  "/payroll/payments", "/payroll/reports",
];

/** Brands of the three companies as their administrators see them (also proves they are three distinct brands). */
async function threeBrands(sessions: Session[]): Promise<Record<CompanyKey, CurrentBrand>> {
  const brands = Object.fromEntries(await Promise.all(sessions.map(async (s) => [s.key, await brandOf(s)]))) as Record<CompanyKey, CurrentBrand>;
  expect(new Set(KEYS.map((k) => brands[k].product_name)).size).toBe(3);
  expect(new Set(KEYS.map((k) => brands[k].version)).size).toBe(3);
  expect(new Set(KEYS.map((k) => brands[k].icons["favicon-32"])).size).toBe(3);
  expect(new Set(KEYS.map((k) => brands[k].tokens!.light.primary)).size).toBe(3);
  for (const k of KEYS) expect(brands[k].product_name).toBe(BRAND[k]);
  return brands;
}

/** Back, Back, Forward and reload in every context: the brand never changes (no cross-context cache). */
async function backAndReload(sessions: Session[], brands: Record<CompanyKey, CurrentBrand>) {
  const others = (k: CompanyKey) => KEYS.filter((x) => x !== k).map((x) => brands[x]);
  for (const s of sessions) {
    await s.page.goBack();
    await settle(s.page);
    await expectOwnBrand(s, brands[s.key], others(s.key), `back to ${s.page.url()}`);
    await s.page.goBack();
    await settle(s.page);
    await expectOwnBrand(s, brands[s.key], others(s.key), `back to ${s.page.url()}`);
    await s.page.goForward();
    await s.page.reload();
    await settle(s.page);
    await expectOwnBrand(s, brands[s.key], others(s.key), `reload of ${s.page.url()}`);
  }
}

test("brands side by side: three administrators on every payroll page, title, favicon, Back and reload", async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const admins: Session[] = [];
  const evidence: Record<string, unknown>[] = [];
  try {
    for (const key of KEYS) admins.push(await login(browser, testInfo, key, "admin", { label: "admin-wl" }));
    const brands = await threeBrands(admins);
    const others = (k: CompanyKey) => KEYS.filter((x) => x !== k).map((x) => brands[x]);
    // Every payroll page, the three administrators interleaved page by page (all contexts stay open).
    const pages = ADMIN_PAGES("alpha").length;
    for (let i = 0; i < pages; i++) {
      for (const s of admins) {
        const url = ADMIN_PAGES(s.key)[i];
        await s.page.goto(url);
        await settle(s.page);
        const seen = await expectOwnBrand(s, brands[s.key], others(s.key), url);
        evidence.push({ session: s.name, url, title: seen.title, product: seen.product, version: seen.version, favicon: seen.icons[0] });
        await shot(s.page, testInfo, `wl-${s.key}-${url.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`);
      }
    }
    await backAndReload(admins, brands);
    // Each context's cookies belong to its own session only (no shared brand hint or session).
    const hints = await Promise.all(admins.map(async (s) => (await s.context.cookies()).find((c) => c.name === "hrms_bh")?.value ?? ""));
    expect(new Set(hints.filter(Boolean)).size, "brand hints are per context").toBe(hints.filter(Boolean).length);
    writeEvidence("wl-pages-admins.json", { brands: Object.fromEntries(KEYS.map((k) => [k, { product: brands[k].product_name, version: brands[k].version }])), pages: evidence });
    for (const s of admins) expect(s.pageErrors, `${s.name} page errors`).toEqual([]);
  } finally {
    for (const s of admins) await s.close();
  }
});

test("brands side by side: three employees on My Salary, bank details, payslips and the payslip preview", async ({ browser }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const employees: Session[] = [];
  const evidence: Record<string, unknown>[] = [];
  try {
    for (const key of KEYS) employees.push(await login(browser, testInfo, key, "emp1", { label: "emp1-wl" }));
    // Employees cannot read the branding admin API; their brand is the session's /branding/current.
    const brands = await threeBrands(employees);
    const others = (k: CompanyKey) => KEYS.filter((x) => x !== k).map((x) => brands[x]);
    for (const s of employees) {
      const slips = (await api(s.page, "GET", "/me/payroll/payslips")).data.items as { id: number }[];
      expect(slips.length, `${s.name} has payslips`).toBeGreaterThan(0);
      for (const url of ["/me/salary", "/me/bank-accounts", "/me/payslips", `/me/payslips/${slips[0].id}`]) {
        await s.page.goto(url);
        await settle(s.page);
        const seen = await expectOwnBrand(s, brands[s.key], others(s.key), url);
        evidence.push({ session: s.name, url, title: seen.title, product: seen.product, version: seen.version });
        await shot(s.page, testInfo, `wl-${s.key}-emp-${url.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`);
      }
    }
    await backAndReload(employees, brands);
    writeEvidence("wl-pages-employees.json", { pages: evidence });
    for (const s of employees) expect(s.pageErrors, `${s.name} page errors`).toEqual([]);
  } finally {
    for (const s of employees) await s.close();
  }
});

test("sign-in page: platform brand before sign-in, own brand after sign-out, never another company's", async ({ browser }, testInfo) => {
  const sessions: Session[] = [];
  try {
    for (const key of KEYS) sessions.push(await openSession(browser, testInfo, key, "admin", { label: "login-wl" }));
    for (const s of sessions) {
      await s.page.goto("/login");
      await settle(s.page);
      const html = await s.page.content();
      // Tenant hosts are off on this stack: the shared sign-in page is the platform's.
      await expect(s.page.locator("body")).toContainText(PLATFORM_PRODUCT);
      for (const k of KEYS) expect(html, `${s.name}: no tenant brand before sign-in`).not.toContain(BRAND[k]);
      await shot(s.page, testInfo, `wl-${s.key}-login-before`);
    }
    // Sign in all three, then sign out through the account menu.
    for (const s of sessions) {
      const a = account(s.key, "admin");
      await s.page.locator("#email").fill(a.email);
      await s.page.locator("#password").fill(a.password);
      await s.page.getByRole("button", { name: /sign in/i }).click();
      await s.page.waitForURL(/\/(dashboard|me|payroll)/, { timeout: 45_000 });
    }
    for (const s of sessions) {
      await settle(s.page);
      await expect(s.page.getByTestId("sidebar-product")).toHaveText(BRAND[s.key]);
      await s.page.getByRole("button", { name: "Account menu" }).click();
      await s.page.getByRole("menuitem", { name: /sign out/i }).click();
      await s.page.waitForURL(/\/login/, { timeout: 30_000 });
      await settle(s.page);
      const html = await s.page.content();
      for (const name of foreignNames(s.key)) expect(html, `${s.name}: sign-in page after sign-out shows no "${name}"`).not.toContain(name);
      const shows = (await s.page.locator("body").innerText());
      // Either the remembered own brand (signed brand hint of this browser) or the neutral platform brand.
      expect(shows.includes(BRAND[s.key]) || shows.includes(PLATFORM_PRODUCT), `${s.name}: own or platform brand`).toBe(true);
      await shot(s.page, testInfo, `wl-${s.key}-login-after-sign-out`);
    }
  } finally {
    for (const s of sessions) await s.close();
  }
});

test("forced backend failures keep each context's own brand (500, network error, brand endpoint down)", async ({ browser }, testInfo) => {
  const admins: Session[] = [];
  try {
    for (const key of KEYS) admins.push(await login(browser, testInfo, key, "admin", { label: "admin-fail" }));
    const brands = Object.fromEntries(await Promise.all(admins.map(async (s) => [s.key, await brandOf(s)]))) as Record<CompanyKey, CurrentBrand>;
    const others = (k: CompanyKey) => KEYS.filter((x) => x !== k).map((x) => brands[x]);
    const failures: Record<string, unknown>[] = [];
    // 1) Every payroll API answers 500: the run page shows the error state with Retry, in the own brand.
    for (const s of admins) {
      await s.context.route("**/api/v1/payroll/**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Injected failure (test)", code: "INTERNAL" }) }));
      await s.page.goto(`/payroll/runs/${company(s.key).runs.finalized.id}`);
      await expect(s.page.getByText("Couldn't load this")).toBeVisible({ timeout: 30_000 });
      await expect(s.page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expectOwnBrand(s, brands[s.key], others(s.key), "run page with payroll API 500");
      await shot(s.page, testInfo, `wl-${s.key}-forced-500`);
      failures.push({ session: s.name, kind: "500", error_state: true });
      await s.context.unroute("**/api/v1/payroll/**");
    }
    // 2) Network failure (connection refused) on the payroll API.
    for (const s of admins) {
      await s.context.route("**/api/v1/payroll/**", (r) => r.abort("connectionrefused"));
      await s.page.goto("/payroll/structures");
      await expect(s.page.getByText("Couldn't load this")).toBeVisible({ timeout: 30_000 });
      await expect(s.page.getByText(/couldn't reach the server/i)).toBeVisible();
      await expectOwnBrand(s, brands[s.key], others(s.key), "structures with the network down");
      await shot(s.page, testInfo, `wl-${s.key}-forced-network-error`);
      failures.push({ session: s.name, kind: "network" });
      await s.context.unroute("**/api/v1/payroll/**");
    }
    // 3) The client-side brand endpoint fails: the server-rendered brand of this session still applies.
    for (const s of admins) {
      await s.context.route("**/api/v1/branding/**", (r) => r.fulfill({ status: 503, body: "unavailable" }));
      await s.page.goto("/payroll");
      await settle(s.page);
      await expectOwnBrand(s, brands[s.key], others(s.key), "overview with the brand endpoint down");
      failures.push({ session: s.name, kind: "brand endpoint 503" });
      await s.context.unroute("**/api/v1/branding/**");
    }
    // Recovery: Try again after the failure clears loads the real page, still in the own brand.
    for (const s of admins) {
      await s.page.goto(`/payroll/runs/${company(s.key).runs.finalized.id}`);
      await settle(s.page);
      await expect(s.page.getByRole("heading", { level: 1 })).toContainText(COMPANY_NAME[s.key]);
      await expectOwnBrand(s, brands[s.key], others(s.key), "run page after recovery");
    }
    writeEvidence("wl-forced-failures.json", failures);
    for (const s of admins) {
      const leaked = s.consoleErrors.filter((m) => foreignNames(s.key).some((n) => m.includes(n)));
      expect(leaked, `${s.name}: console never names another company`).toEqual([]);
    }
  } finally {
    for (const s of admins) await s.close();
  }
});

test("payslip PDFs carry the legal-entity document brand (PLATFORM → PARTNER → TENANT → LEGAL ENTITY)", async ({ browser }, testInfo) => {
  const results: Record<string, unknown>[] = [];
  for (const key of KEYS) {
    const emp = await login(browser, testInfo, key, "emp1", { label: "emp1-pdf" });
    try {
      const p = emp.page;
      const slips = (await api(p, "GET", "/me/payroll/payslips")).data.items as { id: number; run_id: number }[];
      const slip = slips.find((d) => d.run_id === company(key).runs.finalized.id) ?? slips[0];
      expect(slip, `${key} emp1 has a payslip`).toBeTruthy();
      await p.goto(`/me/payslips/${slip.id}`);
      await settle(p);
      await shot(p, testInfo, `wl-${key}-payslip-preview`);
      const [download] = await Promise.all([
        p.waitForEvent("download", { timeout: 45_000 }),
        p.getByRole("button", { name: /download/i }).or(p.getByRole("link", { name: /download/i })).first().click(),
      ]);
      const file = evidencePath(`wl-${key}-payslip.pdf`);
      await download.saveAs(file);
      const pdf = pdfInfo(file, evidencePath(`wl-${key}-payslip-page1.png`));
      const brand = (await api(p, "GET", "/branding/current")).data as CurrentBrand;
      const C = company(key) as any;
      expect(pdf.has_black_square).toBe(false);
      expect(pdf.metadata.creator, "product name of the tenant").toBe(BRAND[key]);
      for (const name of foreignNames(key)) expect(pdf.text, `${key} payslip names no "${name}"`).not.toContain(name);
      const entityBrand = C.entity_document_brand?.IN01;
      if (key === "alpha") {
        // LEGAL ENTITY level: IN01's accent and legal footer replace the tenant's; the credit stays hidden.
        expect(entityBrand, "seeded IN01 document brand").toBeTruthy();
        expect(pdf.text).toContain(entityBrand.legal_footer);
        expect(pdf.text).not.toContain("Alpha Technologies Pvt Ltd (fictitious test company)");
        expect(pdf.fill_colours).toContain(entityBrand.accent_color.toUpperCase());
        expect(pdf.fill_colours).not.toContain(PRIMARY_HEX.alpha);
        expect(pdf.text).not.toMatch(/Powered by/);
      } else if (key === "beta") {
        // PARTNER level: the reseller's credit; TENANT level: Beta's footer and colour.
        expect(C.partner?.powered_by_label).toBe("Powered by Northwind Payroll Cloud");
        expect(brand.powered_by_label).toBe(C.partner.powered_by_label);
        expect(pdf.text).toContain(C.partner.powered_by_label);
        expect(pdf.text).not.toContain(PLATFORM_CREDIT);
        expect(pdf.text).toContain("Beta Logistics LLC (fictitious test company)");
        expect(pdf.fill_colours).toContain(PRIMARY_HEX.beta);
      } else {
        // PLATFORM level: a direct tenant that shows the credit gets the platform's; TENANT colour.
        expect(pdf.text).toContain(PLATFORM_CREDIT);
        expect(pdf.fill_colours).toContain(PRIMARY_HEX.gamma);
      }
      // The printed verification link opens the public verification page (no session) in Chrome.
      const verifyUrl = pdf.text.match(/https?:\/\/\S+\/verify\/([A-Za-z0-9_-]+)/);
      expect(verifyUrl, "verification link printed on the payslip").toBeTruthy();
      const visitor = await openSession(browser, testInfo, key, "visitor", { label: "verify-visitor" });
      try {
        await visitor.page.goto(`/verify/${verifyUrl![1]}`);
        await expect(visitor.page.getByTestId("verify-result")).toBeVisible({ timeout: 30_000 });
        await expect(visitor.page.getByText("Genuine document")).toBeVisible();
        const shown = await visitor.page.getByTestId("verify-result").innerText();
        expect(shown).toContain(pdf.metadata.author);
        expect(shown).not.toMatch(/\d[\d,]*\.\d{2}/); // never amounts (EC-DOC-18)
        await shot(visitor.page, testInfo, `wl-${key}-verify-page`);
      } finally {
        await visitor.close();
      }
      // Re-download through a new signed link: the issued document is byte-identical (immutable, not re-rendered).
      const link = await api<{ url: string }>(p, "GET", `/me/payroll/payslips/${slip.id}/download`);
      expect(link.status).toBe(200);
      const again = await p.request.get(link.data.url);
      expect(again.status()).toBe(200);
      const sha = crypto.createHash("sha256").update(await again.body()).digest("hex");
      expect(sha).toBe(pdf.sha256);
      expect(again.headers()["x-document-sha256"]).toBe(pdf.sha256);
      expect(again.headers()["x-rerendered"]).toBe("false");
      results.push({ company: key, payslip: slip.id, creator: pdf.metadata.creator, author: pdf.metadata.author, fill_colours: pdf.fill_colours, sha256: pdf.sha256,
        credit: (pdf.text.match(/Powered by [^\n]+/) ?? [null])[0], entity_footer: key === "alpha" ? pdf.text.includes(entityBrand.legal_footer) : null });
      fs.rmSync(file, { force: true }); // keep the rendered page image, not the personal PDF
      expect(emp.pageErrors).toEqual([]);
    } finally {
      await emp.close();
    }
  }
  writeEvidence("wl-payslip-pdf-brands.json", results);
});

test("e-mails and in-app notifications are branded per company and carry no amounts", async ({ browser }, testInfo) => {
  const summary: Record<string, unknown> = {};
  for (const key of KEYS) {
    const C = company(key) as any;
    const mails = outbox(C.company_id);
    expect(mails.length, `${key} payroll e-mails in the outbox`).toBeGreaterThan(0);
    const templates = new Set(mails.map((m) => m.template));
    expect(templates.has("payroll.payslip_published")).toBe(true);
    expect(templates.has("payroll.approval_requested")).toBe(true);
    for (const m of mails) {
      const where = `${key} ${m.template} ${m.file_id}`;
      expect(m.from_name, `${where}: sender`).toBe(COMPANY_NAME[key]);
      // Every e-mail is headed and signed in the company's own brand (display name; the product name where the template names the product).
      expect(m.text, `${where}: display name`).toContain(COMPANY_NAME[key]);
      for (const name of foreignNames(key)) {
        expect(m.subject + m.text, `${where}: no "${name}"`).not.toContain(name);
      }
      expect(m.html_colours, `${where}: own colour`).toContain(PRIMARY_HEX[key]);
      for (const other of KEYS.filter((k) => k !== key)) expect(m.html_colours, `${where}: no ${other} colour`).not.toContain(PRIMARY_HEX[other]);
      // EC-WL-25: no amounts in e-mails (no setting enables them on this stack).
      expect(m.subject + m.text, `${where}: no amounts`).not.toMatch(/\b\d{1,3}(,\d{2,3})*\.\d{2}\b/);
      if (key === "alpha") expect(m.text, `${where}: credit hidden`).not.toMatch(/Powered by/);
      if (key === "beta") expect(m.text, `${where}: partner credit`).toContain(C.partner.powered_by_label);
      if (key === "gamma") expect(m.text, `${where}: platform credit`).toContain(PLATFORM_CREDIT);
    }
    summary[key] = {
      emails: mails.length,
      templates: [...templates].sort(),
      senders: [...new Set(mails.map((m) => m.from_name))],
      credits: [...new Set(mails.map((m) => (m.text.match(/Powered by [^\n]+/) ?? ["(none)"])[0]))],
    };
  }
  // In-app: the bell lists payroll notifications; opening one lands on the right page in the own brand.
  for (const key of KEYS) {
    for (const role of ["admin", "emp1"]) {
      const s = await login(browser, testInfo, key, role, { label: `${role}-bell` });
      try {
        const p = s.page;
        await p.goto("/dashboard");
        await settle(p);
        const list = (await api(p, "GET", "/notifications")).data as { notifications: { title: string; action_url: string | null; is_read: boolean }[] };
        const wanted = role === "admin" ? /awaiting your approval/i : /payslip/i;
        const target = list.notifications.find((n) => wanted.test(n.title) && n.action_url);
        expect(target, `${key} ${role}: a payroll notification`).toBeTruthy();
        await p.getByRole("button", { name: /^Notifications \(/ }).click();
        const item = p.getByRole("button", { name: new RegExp(target!.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
        await expect(item).toBeVisible();
        await shot(p, testInfo, `wl-${key}-${role}-notifications`);
        const panel = await p.locator("body").innerText();
        for (const name of foreignNames(key)) expect(panel).not.toContain(name);
        await item.click();
        await p.waitForURL((u) => u.pathname === target!.action_url!.split("?")[0], { timeout: 30_000 });
        await settle(p);
        await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(p.getByText("This page doesn't exist")).toHaveCount(0);
        await expect(p.getByTestId("sidebar-product")).toHaveText(BRAND[key]);
        await shot(p, testInfo, `wl-${key}-${role}-notification-target`);
        (summary[key] as any)[`${role}_notification`] = { title: target!.title, landed: new URL(p.url()).pathname };
        expect(s.pageErrors).toEqual([]);
      } finally {
        await s.close();
      }
    }
  }
  writeEvidence("wl-emails-notifications.json", summary);
});

test("EC-WL-08 two tabs publish the brand at once: one wins, the loser is refused and re-reads", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "gamma", "admin", { label: "admin-publish-race" });
  const tab1 = admin.page;
  const tab2 = await admin.context.newPage();
  const original = (await api(tab1, "GET", "/branding")).data;
  const originalTagline: string = original.published?.fields?.tagline ?? "Your team, in the cloud";
  const versionsBefore = ((await api(tab1, "GET", "/branding/versions")).data as unknown[]).length;
  try {
    await tab1.goto("/settings/branding");
    await expect(tab1.getByTestId("brand-status")).toContainText("Up to date");
    await tab1.locator('[data-field="tagline"]').fill("Your team, in the cloud (race test)");
    await expect(tab1.getByTestId("draft-badge")).toContainText("unpublished change");
    // Tab 2 opens the same draft and its publish review.
    await tab2.goto("/settings/branding");
    await expect(tab2.getByTestId("draft-badge")).toContainText("unpublished change");
    await tab2.getByTestId("publish-brand").click();
    await expect(tab2.getByTestId("publish-diff")).toContainText("Tagline");
    // Tab 1 publishes first.
    await tab1.getByTestId("publish-brand").click();
    await tab1.getByTestId("confirm-publish").click();
    await expect(tab1.getByText(/Version \d+ is live/)).toBeVisible();
    // Tab 2 publishes the same (now consumed) draft: refused, nothing published twice.
    await tab2.getByTestId("confirm-publish").click();
    await expect(tab2.getByText(/no draft to publish|published by someone else|no unpublished changes/i).first()).toBeVisible();
    await shot(tab2, testInfo, "wl-gamma-publish-race-loser");
    const list = (await api(tab1, "GET", "/branding/versions")).data as unknown[];
    expect(list.length, "exactly one new version").toBe(versionsBefore + 1);
    // The loser re-reads and sees the winner's value.
    await tab2.reload();
    await expect(tab2.getByTestId("brand-status")).toContainText("Up to date");
    await expect(tab2.locator('[data-field="tagline"]')).toHaveValue("Your team, in the cloud (race test)");
    writeEvidence("wl-ec-wl-08-publish-race.json", { versions_before: versionsBefore, versions_after: list.length, loser_message_shown: true });
  } finally {
    // Restore the seeded tagline (a new version; history is never rewritten).
    await api(tab1, "PUT", "/branding/draft", { changes: { tagline: originalTagline } });
    const restored = await api(tab1, "POST", "/branding/publish", {});
    expect(restored.status, "restore the seeded tagline").toBeLessThan(300);
    await tab2.close();
    await admin.close();
  }
});
