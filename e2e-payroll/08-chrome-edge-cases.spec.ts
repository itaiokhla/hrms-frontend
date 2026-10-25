import { execFileSync } from "node:child_process";

import {
  BACKEND, BRAND, api, company, db, evidencePath, expect, login, mainText, noHorizontalOverflow, settle, shot, stepUpApi, test, writeEvidence,
  type Session,
} from "./support";

/**
 * Browser-only edge cases of the gate-ec Chrome list (FOLLOW-UPS F-70) and the legacy-URL question (EC-MIG-13),
 * in installed Google Chrome. Brand changes made here (Beta right-to-left, Gamma long name / logo / mark) are
 * published as new versions and then rolled back with the product's own "restore version" (history is never
 * rewritten). Runs last in the suite: it recalculates Gamma's open draft run.
 */

const PYTHON = `${BACKEND}/venv/Scripts/python.exe`;

function png(text: string, colour: string, width: number, height: number): Buffer {
  const script = [
    "import io,sys,base64",
    "from PIL import Image, ImageDraw, ImageFont",
    `img=Image.new('RGBA',(${width},${height}),(255,255,255,0))`,
    "d=ImageDraw.Draw(img)",
    `c=tuple(int('${colour}'[i:i+2],16) for i in (1,3,5))`,
    `d.rounded_rectangle((4,4,${height}-4,${height}-4),radius=12,fill=c+(255,))`,
    `f=ImageFont.truetype('app/assets/fonts/NotoSans-Bold.ttf',${Math.round(height * 0.4)})`,
    `d.text((${height}+8,${height}//2),'${text}',font=f,fill=c+(255,),anchor='lm')`,
    "out=io.BytesIO(); img.save(out,'PNG'); sys.stdout.write(base64.b64encode(out.getvalue()).decode())",
  ].join("\n");
  return Buffer.from(execFileSync(PYTHON, ["-c", script], { cwd: BACKEND, encoding: "utf8" }), "base64");
}

/** Publish brand field changes through the API (preparation) and return the version that was live before. */
async function publishBrand(page: Session["page"], changes: Record<string, unknown>) {
  const versions = (await api(page, "GET", "/branding/versions")).data as { id: number; version: number; status: string }[];
  const live = versions.find((v) => v.status === "PUBLISHED")!;
  const draft = await api(page, "PUT", "/branding/draft", { changes });
  expect(draft.status, `brand draft ${JSON.stringify(Object.keys(changes))}`).toBe(200);
  const published = await api(page, "POST", "/branding/publish", {});
  expect(published.status, "brand publish").toBe(200);
  return live;
}

async function restoreBrand(page: Session["page"], profileId: number) {
  const r = await api(page, "POST", `/branding/versions/${profileId}/restore`);
  expect(r.status, "restore the earlier brand version").toBe(200);
}

test("EC-MIG-13 and EC-MIG-11: old payroll URLs land on live pages (legacy screens kept, decisions I-03/I-11)", async ({ browser }, testInfo) => {
  const results: Record<string, string> = {};
  const admin = await login(browser, testInfo, "beta", "admin", { label: "admin-legacy-urls" });
  try {
    const p = admin.page;
    // /salary-structure -> /payroll?tab=structures (308) -> /payroll/legacy?tab=structures (307): two hops, no loop,
    // and the legacy salary-structure tab is the one selected (legacy structures live only there; I-11).
    await p.goto("/salary-structure");
    await settle(p);
    expect(new URL(p.url()).pathname + new URL(p.url()).search).toBe("/payroll/legacy?tab=structures");
    await expect(p.getByRole("tab", { name: "Salary structures" })).toHaveAttribute("aria-selected", "true");
    results["/salary-structure"] = "/payroll/legacy?tab=structures";
    await shot(p, testInfo, "mig13-salary-structure-legacy");
    await p.goto("/payroll?tab=runs");
    await settle(p);
    expect(new URL(p.url()).pathname).toBe("/payroll/legacy");
    await expect(p.getByRole("tab", { name: "Payroll runs" })).toHaveAttribute("aria-selected", "true");
    results["/payroll?tab=runs"] = "/payroll/legacy?tab=runs";
    // The v2 workspace stays at /payroll (no tab parameter) and v2 structures at /payroll/structures.
    await p.goto("/payroll");
    await settle(p);
    expect(new URL(p.url()).pathname).toBe("/payroll");
    await p.goto("/payroll/structures");
    await expect(p.getByRole("heading", { level: 1 })).toContainText(/structures/i);
  } finally {
    await admin.close();
  }
  const emp = await login(browser, testInfo, "beta", "emp1", { label: "emp1-legacy-urls" });
  try {
    const p = emp.page;
    for (const url of ["/payslips", "/employee/salary"]) {
      await p.goto(url);
      await settle(p);
      expect(new URL(p.url()).pathname, `${url} lands on the legacy payslip list`).toBe("/payslips");
      await expect(p.getByRole("heading", { level: 1 })).toHaveText("Payslips");
      await expect(p.getByText("This page doesn't exist")).toHaveCount(0);
      results[url] = "/payslips (legacy payslip records)";
    }
    await shot(p, testInfo, "mig13-payslips-legacy");
    await p.goto("/me/payslips");
    await settle(p);
    expect(await mainText(p)).toMatch(/payslip/i);
    results["/me/payslips"] = "v2 payslips (renders)";
    expect(emp.pageErrors).toEqual([]);
  } finally {
    await emp.close();
  }
  writeEvidence("ec-mig-13-legacy-urls.json", results);
});

test("EC-UX-02 access denied without the actions, and the not-found view for another company's run", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "alpha", "emp1", { label: "emp1-denied" });
  try {
    await emp.page.goto("/payroll/runs");
    await expect(emp.page.getByText("You don't have access to this page")).toBeVisible({ timeout: 30_000 });
    await expect(emp.page.getByRole("button", { name: /new pay run/i })).toHaveCount(0);
    await expect(emp.page.getByRole("button", { name: /approve|finalize|lock & calculate/i })).toHaveCount(0);
    await shot(emp.page, testInfo, "ec-ux-02-employee-denied-runs");
  } finally {
    await emp.close();
  }
  const admin = await login(browser, testInfo, "alpha", "admin", { label: "admin-foreign-run" });
  try {
    const foreign = company("gamma").runs.finalized.id;
    const res = admin.page.waitForResponse((r) => r.url().endsWith(`/api/v1/payroll/runs/${foreign}`));
    await admin.page.goto(`/payroll/runs/${foreign}`);
    expect((await res).status(), "API answers 404 for another company's run").toBe(404);
    await expect(admin.page.getByText("Pay run not found")).toBeVisible();
    const html = await admin.page.content();
    expect(html).not.toContain("Gamma");
    await shot(admin.page, testInfo, "ec-ux-02-foreign-run-not-found");
  } finally {
    await admin.close();
  }
});

test("EC-UX-14 run list, run review and payslips: loading, failure with Retry, access denied and stale states", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "beta", "admin", { label: "admin-states" });
  const p = admin.page;
  const runId = company("beta").runs.finalized.id;
  const pages: [string, string, RegExp][] = [
    ["run list", "/payroll/runs", /\/api\/v1\/payroll\/runs(\?|$)/],
    ["run review", `/payroll/runs/${runId}`, new RegExp(`/api/v1/payroll/runs/${runId}(\\?|$)`)],
    ["payslips", "/payroll/payslips", /\/api\/v1\/payroll\/payslips(\?|$)/],
  ];
  const seen: Record<string, Record<string, boolean>> = {};
  try {
    for (const [name, url, pattern] of pages) {
      const states: Record<string, boolean> = {};
      // Loading: hold the response for 3 s; a skeleton (aria-busy) shows meanwhile.
      await p.route(pattern, async (r) => {
        await new Promise((ok) => setTimeout(ok, 3000));
        await r.continue();
      });
      await p.goto(url);
      await expect(p.locator('[aria-busy="true"], .animate-shimmer').first()).toBeVisible({ timeout: 2500 });
      states.loading = true;
      await settle(p);
      await p.unroute(pattern);
      // Failure: 500 -> error state with Try again; the retry after the failure clears loads the page.
      await p.route(pattern, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Injected failure (test)" }) }));
      await p.goto(url);
      await expect(p.getByText("Couldn't load this")).toBeVisible({ timeout: 30_000 });
      await shot(p, testInfo, `ec-ux-14-${name.replace(/\W+/g, "-")}-failure`);
      await p.unroute(pattern);
      await p.getByRole("button", { name: "Try again" }).click();
      await expect(p.getByText("Couldn't load this")).toHaveCount(0, { timeout: 30_000 });
      states.failure_retry = true;
      // Access denied by the API (role revoked meanwhile): the message is shown, no data.
      await p.route(pattern, (r) => r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "You don't have permission to view this (test).", code: "FORBIDDEN" }) }));
      await p.goto(url);
      // A single run outside the caller's scope is shown as "not found" (no disclosure that it exists, EC-SEC-02).
      await expect(p.getByText(/You don't have permission to view this \(test\)|You don't have access|Pay run not found/).first()).toBeVisible({ timeout: 30_000 });
      await shot(p, testInfo, `ec-ux-14-${name.replace(/\W+/g, "-")}-denied`);
      await p.unroute(pattern);
      states.access_denied = true;
      seen[name] = states;
    }
    // Stale banner on the run review (the run record says stale; the stale details come from the real API).
    const runPattern = new RegExp(`/api/v1/payroll/runs/${runId}(\\?|$)`);
    await p.route(runPattern, async (r) => {
      if (r.request().method() !== "GET") return r.continue();
      const real = await r.fetch();
      const body = await real.json();
      await r.fulfill({ response: real, json: { ...body, stale: true } });
    });
    await p.goto(`/payroll/runs/${runId}`);
    await expect(p.getByText(/Inputs changed (for \d+ employees? )?since lock/)).toBeVisible({ timeout: 30_000 });
    await shot(p, testInfo, "ec-ux-14-run-review-stale");
    await p.unroute(runPattern);
    seen["run review"].stale_banner = true;
    writeEvidence("ec-ux-14-states.json", seen);
    expect(admin.pageErrors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test("EC-UX-11 Hide amounts masks every amount incl. KPI cards, focus reveals one, survives navigation", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "gamma", "admin", { label: "admin-hide" });
  const p = admin.page;
  try {
    await p.goto(`/payroll/runs/${company("gamma").runs.finalized.id}`);
    await settle(p);
    const toggle = p.getByRole("button", { name: "Hide amounts" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const masked = p.locator("[data-masked]");
    await expect(masked.first()).toBeVisible();
    const count = await masked.count();
    expect(count).toBeGreaterThan(2);
    // Every amount is masked: no visible "USD 1,234.56" text remains outside masked elements.
    const visible = await p.evaluate(() => {
      const clone = document.querySelector("main")!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[data-masked], .sr-only").forEach((n) => n.remove());
      return clone.textContent ?? "";
    });
    expect(visible).not.toMatch(/(USD|\$)\s?\d[\d,]*\.\d{2}/);
    await shot(p, testInfo, "ec-ux-11-hidden");
    // Keyboard focus reveals exactly that one value.
    await masked.first().focus();
    await expect(p.locator("[data-masked]")).toHaveCount(count - 1);
    await p.keyboard.press("Tab");
    // KPI cards on the overview obey it too, and the setting survives navigation.
    await p.goto("/payroll");
    await settle(p);
    await expect(p.getByRole("button", { name: "Hide amounts" }).first()).toHaveAttribute("aria-pressed", "true");
    const kpiMoney = await p.evaluate(() => {
      const clone = document.querySelector("main")!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[data-masked], .sr-only").forEach((n) => n.remove());
      return clone.textContent ?? "";
    });
    expect(kpiMoney).not.toMatch(/(USD|\$)\s?\d[\d,]*\.\d{2}/);
    await shot(p, testInfo, "ec-ux-11-overview-hidden");
    await p.getByRole("button", { name: "Hide amounts" }).first().click();
    await expect(p.locator("[data-masked]")).toHaveCount(0);
    writeEvidence("ec-ux-11-hide-amounts.json", { masked_on_run_review: count, survives_navigation: true });
  } finally {
    await admin.close();
  }
});

test("EC-UX-04 two tabs save the same setting: 409 shown with both values and Reload, never overwritten", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "gamma", "admin", { label: "admin-two-tabs" });
  const tab1 = admin.page;
  const tab2 = await admin.context.newPage();
  const KEY = "payroll.rounding.net_pay_increment";
  const url = "/settings/payroll/currency";
  // A future-dated company value (2027) so no existing run is affected.
  const save = async (page: Session["page"], value: string) => {
    const field = page.locator(`[data-setting="${KEY}"]`);
    await field.locator("input").first().fill(value);
    await page.getByLabel("Effective from").fill("2027-01-01");
    await page.getByLabel(/^Reason/).fill(`E2E EC-UX-04 two-tab test (${value})`);
    await page.getByRole("button", { name: /^save$/i }).click();
  };
  try {
    await tab1.goto(url);
    await settle(tab1);
    await save(tab1, "5");
    await expect.poll(() => db("setting", { company_id: company("gamma").company_id, key: KEY }).filter((r) => r.scope_type === "TENANT" && String(r.effective_from).startsWith("2027")).length, { timeout: 20_000 }).toBeGreaterThan(0);
    // Both tabs now hold the same version; tab 1 saves first, tab 2 second.
    await tab2.goto(url);
    await settle(tab2);
    await tab1.reload();
    await settle(tab1);
    await save(tab1, "10");
    await expect.poll(() => db("setting", { company_id: company("gamma").company_id, key: KEY }).some((r) => String(r.value).includes("10")), { timeout: 20_000 }).toBe(true);
    await save(tab2, "25");
    const banner = tab2.getByRole("alert").filter({ hasText: "Someone else changed this" });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await shot(tab2, testInfo, "ec-ux-04-conflict");
    const rows = db("setting", { company_id: company("gamma").company_id, key: KEY });
    expect(rows.some((r) => String(r.value).includes("25")), "tab 2 never overwrote silently").toBe(false);
    await banner.getByRole("button", { name: /reload latest values/i }).click();
    await expect(tab2.locator(`[data-setting="${KEY}"] input`).first()).toHaveValue(/^10(\.0+)?$/);
    writeEvidence("ec-ux-04-two-tabs.json", { conflict_banner: true, stored_values: rows.map((r) => ({ value: r.value, from: r.effective_from, scope: r.scope_type })) });
  } finally {
    await tab2.close();
    await admin.close();
  }
});

test("EC-UX-10 at 375x812: run list, run review, My payslips and My bank account; lists as cards, no sideways scroll", async ({ browser }, testInfo) => {
  const vp = { width: 375, height: 812 };
  const results: Record<string, unknown> = {};
  const admin = await login(browser, testInfo, "alpha", "admin", { viewport: vp, isMobile: true, label: "admin-375" });
  try {
    const p = admin.page;
    for (const url of ["/payroll/runs", `/payroll/runs/${company("alpha").runs.finalized.id}`, `/payroll/runs/${company("alpha").runs.finalized.id}?tab=employees`, "/payroll/payslips"]) {
      await p.goto(url);
      await settle(p);
      const info = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        wideTables: Array.from(document.querySelectorAll("main table")).filter((t) => (t as HTMLElement).offsetParent !== null && (t as HTMLElement).getBoundingClientRect().width > window.innerWidth).length,
      }));
      results[url] = info;
      expect(info.overflow, `${url}: no sideways page scroll`).toBeLessThanOrEqual(1);
      expect(info.wideTables, `${url}: no table wider than the screen (lists render as cards)`).toBe(0);
      await shot(p, testInfo, `ec-ux-10-${url.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`, { fullPage: true });
    }
    // Navigation works through the phone menu.
    await p.getByRole("button", { name: "Open menu" }).click();
    await expect(p.getByRole("navigation", { name: "Main" })).toBeVisible();
    await p.getByRole("button", { name: "Close menu" }).click();
  } finally {
    await admin.close();
  }
  const emp = await login(browser, testInfo, "alpha", "emp1", { viewport: vp, isMobile: true, label: "emp1-375" });
  try {
    const p = emp.page;
    const slips = (await api(p, "GET", "/me/payroll/payslips")).data.items as { id: number }[];
    for (const url of ["/me/payslips", `/me/payslips/${slips[0].id}`, "/me/bank-accounts"]) {
      await p.goto(url);
      await settle(p);
      expect(await noHorizontalOverflow(p), `${url}: no sideways page scroll`).toBe(true);
      results[url] = { overflow: 0 };
      await shot(p, testInfo, `ec-ux-10-emp-${url.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`, { fullPage: true });
    }
    expect(emp.pageErrors).toEqual([]);
  } finally {
    await emp.close();
  }
  writeEvidence("ec-ux-10-375.json", results);
});

test("EC-UX-09 right-to-left tenant: mirrored layout, amounts and currency codes stay left-to-right", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "beta", "admin", { label: "admin-rtl" });
  let previous: { id: number } | null = null;
  try {
    const p = admin.page;
    previous = await publishBrand(p, { default_locale: "ar-AE" });
    await p.goto(`/payroll/runs/${company("beta").runs.finalized.id}`);
    await settle(p);
    await expect(p.locator("html")).toHaveAttribute("dir", "rtl");
    const layout = await p.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]')!.getBoundingClientRect();
      // MoneyText renders every amount as <span class="tabular-nums"><bdi dir="ltr">…</bdi></span>; under the ar-AE locale
      // the currency may print as the Arabic symbol (د.إ.) instead of "AED" — either way it stays inside the LTR run.
      const money = Array.from(document.querySelectorAll("main span.tabular-nums bdi[dir=ltr]"))
        .filter((b) => /[\d٠-٩]/.test(b.textContent ?? "") && /AED|د\.إ/.test(b.textContent ?? ""));
      return { navLeft: nav.left, width: window.innerWidth, moneyCount: money.length, sample: money[0]?.textContent ?? "", sampleDir: money[0] ? getComputedStyle(money[0]).direction : "" };
    });
    expect(layout.navLeft, "sidebar on the right").toBeGreaterThan(layout.width / 2);
    expect(layout.moneyCount, "amounts isolated as LTR").toBeGreaterThan(0);
    expect(layout.sampleDir).toBe("ltr");
    expect(layout.sample, "currency and figures in one LTR run").toMatch(/^(?=.*(AED|د\.إ))(?=.*[\d٠-٩]).*$/u);
    await expect(p.getByTestId("sidebar-product")).toHaveText(BRAND.beta);
    await shot(p, testInfo, "ec-ux-09-beta-rtl-run-review");
    writeEvidence("ec-ux-09-rtl.json", layout);
  } finally {
    if (previous) await restoreBrand(admin.page, previous.id);
    await admin.page.goto("/payroll");
    await expect(admin.page.locator("html")).toHaveAttribute("dir", "ltr");
    await admin.close();
  }
});

test("EC-WL-13, EC-WL-02, EC-WL-28 long multilingual name truncates with tooltip; light logo on a white chip in dark mode; new mark gives a new favicon", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "gamma", "admin", { label: "admin-brand-edge" });
  let previous: { id: number } | null = null;
  const evidence: Record<string, unknown> = {};
  try {
    const p = admin.page;
    const before = (await api(p, "GET", "/branding/current")).data;
    // EC-WL-13: 120-character display name with emoji and Arabic (no logo, so the name shows in the sidebar).
    const longName = `Gamma Solutions Worldwide Holdings 🌍 شركة جاما للحلول المتكاملة International Payroll Services Division Test`.padEnd(120, "x").slice(0, 120);
    previous = await publishBrand(p, { display_name: longName });
    await p.goto("/payroll");
    await settle(p);
    const nameBox = p.getByTestId("sidebar-brand");
    await expect(nameBox).toHaveAttribute("title", longName);
    const trunc = await nameBox.locator("p").first().evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth, overflow: getComputedStyle(el).textOverflow, text: el.textContent }));
    expect(trunc.text).toBe(longName);
    expect(trunc.clipped, "long name is clipped").toBe(true);
    expect(trunc.overflow).toBe("ellipsis");
    expect(await noHorizontalOverflow(p)).toBe(true);
    await shot(p, testInfo, "ec-wl-13-long-name");
    evidence.ec_wl_13 = { length: longName.length, clipped: trunc.clipped, tooltip: true };

    // EC-WL-02: only a light logo; Gamma's sidebar is dark -> the light logo sits on a white rounded chip.
    const form = await p.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append("kind", "logo_light");
      fd.append("file", new Blob([bytes], { type: "image/png" }), "gamma-light.png");
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1] ?? "";
      const r = await fetch("/api/v1/branding/assets", { method: "POST", body: fd, credentials: "include", headers: { "X-CSRF-Token": decodeURIComponent(csrf) } });
      return { status: r.status, body: await r.json() };
    }, png("Gamma", "#1E3A8A", 640, 160).toString("base64"));
    expect(form.status, "light logo upload").toBe(200);
    const mark = await p.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append("kind", "mark");
      fd.append("file", new Blob([bytes], { type: "image/png" }), "gamma-mark.png");
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1] ?? "";
      const r = await fetch("/api/v1/branding/assets", { method: "POST", body: fd, credentials: "include", headers: { "X-CSRF-Token": decodeURIComponent(csrf) } });
      return { status: r.status, body: await r.json() };
    }, png("G", "#EA580C", 512, 512).toString("base64"));
    expect(mark.status, "mark upload").toBe(200);
    expect((await api(p, "PUT", "/branding/draft", { changes: { logo_light: form.body.id, mark: mark.body.id } })).status).toBe(200);
    expect((await api(p, "POST", "/branding/publish", {})).status).toBe(200);
    const dark = await browser.newContext({ colorScheme: "dark", storageState: await admin.context.storageState(), viewport: { width: 1400, height: 880 } });
    try {
      const d = await dark.newPage();
      await d.goto("/payroll");
      await settle(d);
      await expect(d.locator("html")).toHaveClass(/dark/);
      const logo = d.getByTestId("sidebar-brand").locator("img").first();
      await expect(logo).toBeVisible();
      const chip = await logo.evaluate((img) => {
        const box = img.parentElement!;
        const cs = getComputedStyle(box);
        return { loaded: (img as HTMLImageElement).naturalWidth > 0, background: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) };
      });
      expect(chip.loaded, "no broken image").toBe(true);
      expect(chip.background).toBe("rgb(255, 255, 255)");
      expect(chip.radius).toBeGreaterThan(0);
      await d.screenshot({ path: evidencePath("ec-wl-02-light-logo-chip-dark.png") });
      // EC-WL-28: the new mark produced new favicon URLs (content hashes), served on the next page load.
      const icons = await d.locator("link[rel~=icon]").evaluateAll((ls) => ls.map((l) => l.getAttribute("href")));
      const oldIcons = Object.values(before.icons as Record<string, string | null>).filter(Boolean);
      expect(icons.length).toBeGreaterThan(0);
      for (const href of icons) expect(oldIcons, `favicon ${href} is new`).not.toContain(href);
      const fav = await d.request.get(icons[0]!);
      expect(fav.status()).toBe(200);
      evidence.ec_wl_02 = chip;
      evidence.ec_wl_28 = { old: before.icons["favicon-32"], new: icons };
    } finally {
      await dark.close();
    }
    writeEvidence("ec-wl-02-13-28.json", evidence);
  } finally {
    if (previous) await restoreBrand(admin.page, previous.id);
    const after = (await api(admin.page, "GET", "/branding/current")).data;
    expect(after.display_name, "Gamma brand restored").toBe("Gamma Solutions");
    expect(after.logos.light, "light logo removed again").toBeNull();
    await admin.close();
  }
});

test("EC-UX-01 role revoked while the page is open: actions disappear on return, a stale click is refused", async ({ browser }, testInfo) => {
  const B = company("beta") as any;
  const userId = B.ids.users.processor as number;
  const admin = await login(browser, testInfo, "beta", "admin", { label: "admin-revoke" });
  const proc = await login(browser, testInfo, "beta", "processor", { label: "processor-revoked" });
  const original = (await api(admin.page, "GET", `/users/${userId}`)).data.roles as { id: number; code?: string; name: string }[];
  try {
    await proc.page.goto(`/payroll/runs/${B.runs.draft.id}`);
    await settle(proc.page);
    await expect(proc.page.getByRole("heading", { level: 1 })).toBeVisible();
    const keep = original.filter((r) => !/payroll/i.test(`${r.code ?? ""} ${r.name}`)).map((r) => r.id);
    let revoke = await api(admin.page, "PUT", `/users/${userId}/roles`, { role_ids: keep });
    if (revoke.status === 403 || revoke.status === 428) {
      await stepUpApi(admin.page, "beta", "admin");
      revoke = await api(admin.page, "PUT", `/users/${userId}/roles`, { role_ids: keep });
    }
    expect(revoke.status, "role removed").toBe(200);
    // A click prepared before the change is refused by the API (403), nothing changes.
    const statusBefore = db("run", { id: B.runs.draft.id })[0].status;
    const attempt = await api(proc.page, "POST", `/payroll/runs/${B.runs.draft.id}/precheck`, { row_version: 1 });
    expect([401, 403, 404]).toContain(attempt.status);
    expect(db("run", { id: B.runs.draft.id })[0].status).toBe(statusBefore);
    // Returning to the tab (visibilitychange) reloads the permissions: the page becomes AccessDenied.
    await proc.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(proc.page.getByText(/You don't have access to this page|Pay run not found/).first()).toBeVisible({ timeout: 30_000 });
    await expect(proc.page.getByRole("button", { name: /pre-checks|lock & calculate/i })).toHaveCount(0);
    await shot(proc.page, testInfo, "ec-ux-01-role-revoked");
    writeEvidence("ec-ux-01-role-revoked.json", { stale_click_status: attempt.status, run_status_unchanged: true });
  } finally {
    let restore = await api(admin.page, "PUT", `/users/${userId}/roles`, { role_ids: original.map((r) => r.id) });
    if (restore.status === 403 || restore.status === 428) {
      await stepUpApi(admin.page, "beta", "admin");
      restore = await api(admin.page, "PUT", `/users/${userId}/roles`, { role_ids: original.map((r) => r.id) });
    }
    expect(restore.status, "roles restored").toBe(200);
    await proc.close();
    await admin.close();
  }
});

test("incentive measure in Chrome: offered in the wage-input modal, validated, and refused while the plan switch is OFF", async ({ browser }, testInfo) => {
  const B = company("beta") as any;
  const hr = await login(browser, testInfo, "beta", "processor", { label: "processor-incentive" });
  const p = hr.page;
  try {
    const list = async () => {
      const r = await api(p, "GET", "/payroll/wage-inputs?limit=200");
      expect(r.status, "wage-input list").toBe(200);
      const total = r.data.total ?? (r.data.items ?? r.data).length;
      expect(typeof total).toBe("number");
      return total as number;
    };
    const countBefore = await list();
    await p.goto("/payroll/inputs");
    await settle(p);
    await p.getByRole("button", { name: "Add wage input" }).click();
    const dialog = p.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Incentive measure" }).click();
    await expect(dialog.getByRole("radio", { name: "Incentive measure" })).toHaveAttribute("aria-checked", "true");
    const measure = dialog.getByLabel(/Achievement measure/);
    await expect(measure).toBeVisible();
    await shot(p, testInfo, "incentive-measure-mode");
    await dialog.getByRole("button", { name: /^cancel$/i }).click().catch(() => p.keyboard.press("Escape"));
    // The switch is OFF on this stack (seeded STARTER_V1 default): the same request the modal sends is refused,
    // with a message a person can act on, and nothing is created (the ON path is the 13-step backend cycle).
    const period = (B.runs.draft.period ?? B.runs.finalized.period) as [string, string];
    const refused = await api(p, "POST", "/payroll/wage-inputs", {
      employee_id: B.people.emp1.employee_id, component_code: "INCENTIVE", period_start: period[0], period_end: period[1],
      submit: true, measure: "118.5", reason: "E2E incentive measure while the switch is OFF (test)",
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.data)).toMatch(/INCENTIVES_DISABLED|switched off/);
    expect(await list(), "nothing created").toBe(countBefore);
    writeEvidence("incentive-measure-ui.json", { mode_offered: true, off_refusal: refused.data, created: 0 });
    expect(hr.pageErrors).toEqual([]);
  } finally {
    await hr.close();
  }
});
