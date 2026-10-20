import { KEYS, api, expect, host, hostOf, hostsOf, openTenant, secrets, shot, signIn, test, writeEvidence } from "./support";

/**
 * Alpha, Beta and Gamma each on their own address: the first HTML byte already carries the
 * right brand, unconfigured addresses stay neutral, and signed-in browsers never cross hosts.
 */
const S = secrets();

test("each address paints its own brand; unknown, pending and removed addresses stay neutral", async ({ request }) => {
  const report: Record<string, unknown>[] = [];
  for (const key of KEYS) {
    const c = S.companies[key];
    const res = await request.get(`${host(c)}/login`, { maxRedirects: 0 });
    expect(res.status(), c.name).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<title>${c.brand.product_name}</title>`);
    for (const other of KEYS.filter((k) => k !== key)) {
      expect(html, `${c.name} must not mention ${S.companies[other].name}`).not.toContain(S.companies[other].name);
      expect(html).not.toContain(String(S.companies[other].brand.product_name));
    }
    expect(res.headers()["cache-control"]).toMatch(/private.*no-store/);
    const brand = await (await request.get(`${host(c)}/api/v1/public/brand`)).json();
    expect(brand.host_kind).toBe("TENANT");
    expect(brand.product_name).toBe(c.brand.product_name);
    expect(brand.theme_color.toUpperCase()).toBe(String(c.brand.primary_color).toUpperCase());
    // Northwind locks its "Powered by" line on for its tenants; Alpha (direct, Enterprise) hides it.
    expect(brand.show_powered_by).toBe(c.partner === "north");
    report.push({ host: host(c), title: c.brand.product_name, theme: brand.theme_color, powered_by: brand.show_powered_by,
                  locale: brand.default_locale, version: brand.version });
  }
  const custom = await (await request.get(`${hostOf(S.domains.active)}/api/v1/public/brand`)).json();
  expect(custom.product_name).toBe("Gamma HR Cloud");
  report.push({ host: hostOf(S.domains.active), title: custom.product_name, note: "verified custom domain" });
  for (const name of [S.domains.pending, S.domains.removed, "nobody.hrms.localhost"]) {
    const html = await (await request.get(`${hostOf(name)}/login`)).text();
    expect(html, name).toContain("This address is not configured");
    for (const key of KEYS) expect(html).not.toContain(String(S.companies[key].brand.product_name));
    report.push({ host: hostOf(name), result: "neutral 'This address is not configured' page" });
  }
  const platform = await (await request.get(`http://localhost:${new URL(host(S.companies.alpha)).port}/login`)).text();
  expect(platform).toContain("<title>Intertech HRMS</title>");
  writeEvidence("01-first-paint.json", report);
});

test("three administrators sign in on their own addresses; cookies and requests never cross tenants", async ({ browser }, testInfo) => {
  const tenants = await Promise.all(KEYS.map((key) => openTenant(browser, testInfo, `${key}-admin`, host(S.companies[key]))));
  try {
    for (const [i, key] of KEYS.entries()) {
      const c = S.companies[key];
      const t = tenants[i];
      await t.page.goto("/login");
      await expect(t.page.getByTestId("brand-product-name")).toHaveText(String(c.brand.product_name));
      await expect(t.page.getByTestId("brand-tagline")).toHaveText(String(c.brand.tagline));
      await shot(t.page, testInfo, `01-${key}-login`);
    }
    for (const [i, key] of KEYS.entries()) {
      const c = S.companies[key];
      const t = tenants[i];
      await signIn(t.page, c.people.admin.email, S.password);
      await expect(t.page.getByTestId("sidebar-product")).toHaveText(String(c.brand.product_name));
      await expect(t.page).toHaveTitle(new RegExp(String(c.brand.product_name)));
      await expect(t.page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", new RegExp(String(c.brand.primary_color), "i"));
      const me = (await api(t.page, "GET", "/auth/me")).data;
      expect(me.company.name).toBe(c.name);
      await shot(t.page, testInfo, `01-${key}-dashboard`);
    }
    for (const [i, key] of KEYS.entries()) {
      const t = tenants[i];
      const own = new URL(host(S.companies[key])).hostname;
      for (const cookie of await t.context.cookies()) {
        expect(cookie.domain, `${key} cookie ${cookie.name}`).toBe(own); // host-only
        if (cookie.name !== "hrms_csrf") expect(cookie.httpOnly, cookie.name).toBe(true);
      }
      for (const other of KEYS.filter((k) => k !== key)) {
        expect((await t.context.cookies(host(S.companies[other]))).length).toBe(0);
        expect((await t.page.request.get(`${host(S.companies[other])}/api/v1/auth/me`)).status()).toBe(401);
      }
    }
    for (const t of tenants) {
      expect(hostsOf(t), t.name).toEqual([new URL(t.origin).host]);
      expect(t.errors, `${t.name} page errors`).toEqual([]);
    }
  } finally {
    for (const t of tenants) await t.close();
  }
});

test("Gamma's verified custom domain signs in Gamma only; a wrong-company account gets the generic error", async ({ browser }, testInfo) => {
  const G = S.companies.gamma;
  const t = await openTenant(browser, testInfo, "gamma-custom-domain", hostOf(S.domains.active));
  try {
    await t.page.goto("/login");
    await expect(t.page.getByTestId("brand-product-name")).toHaveText("Gamma HR Cloud");
    await t.page.locator("#email").fill(S.companies.alpha.people.admin.email);
    await t.page.locator("#password").fill(S.password);
    await t.page.getByRole("button", { name: /sign in/i }).click();
    await expect(t.page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
    await shot(t.page, testInfo, "01-gamma-custom-domain-wrong-company");
    await signIn(t.page, G.people.emp1.email, S.password);
    await expect(t.page.getByTestId("sidebar-product")).toHaveText("Gamma HR Cloud");
    await shot(t.page, testInfo, "01-gamma-custom-domain-dashboard");
  } finally {
    await t.close();
  }
});
