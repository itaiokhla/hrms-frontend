import { HOSTS, api, cssVar, db, expect, hostsOf, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * Three companies, three isolated Chrome profiles: each host paints its own brand in the very
 * first HTML response, talks only to its own host, and cannot reach another tenant's data.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();

test("first paint: every host's HTML already carries its own brand (no flash, no other tenant)", async ({ request }, testInfo) => {
  const expectations = [
    { host: HOSTS.alpha, title: "Alpha People", lang: "en-IN", dir: "ltr", token: "--primary:175 77% 26%", absent: ["Beta Gulf", "Gamma Health", "PayEase"] },
    { host: HOSTS.beta, title: "PayEase HR", lang: "ar-AE", dir: "rtl", token: "--primary:", absent: ["Alpha People", "Gamma Health", "Alpha Technologies"] },
    { host: HOSTS.gamma, title: "PayEase HR", lang: "en-US", dir: "ltr", token: "--primary:224 76% 48%", absent: ["Alpha People", "Beta Gulf", "Alpha Technologies"] },
    { host: HOSTS.platform, title: "Intertech HRMS", lang: "en", dir: "ltr", token: "", absent: ["Alpha People", "Beta Gulf", "Gamma Health", "PayEase"] },
  ];
  const report: Record<string, unknown>[] = [];
  for (const e of expectations) {
    const response = await request.get(`${e.host}/login`, { maxRedirects: 0 });
    expect(response.status(), e.host).toBe(200);
    const html = await response.text();
    const style = html.match(/<style id="brand-tokens">([^<]*)<\/style>/)?.[1] ?? null;
    const htmlTag = html.match(/<html[^>]*>/)?.[0] ?? "";
    expect(htmlTag).toContain(`lang="${e.lang}"`);
    expect(htmlTag).toContain(`dir="${e.dir}"`);
    expect(html).toContain(`<title>${e.title}</title>`);
    if (e.token) expect(style ?? "").toContain(e.token);
    else expect(style ?? "").toBe("");
    for (const other of e.absent) expect(html, `${e.host} must not mention ${other}`).not.toContain(other);
    const icon = html.match(/<link rel="icon" href="([^"]+)"/)?.[1] ?? null;
    if (e.host !== HOSTS.platform) expect(icon).toMatch(/^\/api\/v1\/public\/brand-assets\/[0-9a-f]{64}\.png$/);
    const manifest = await (await request.get(`${e.host}/manifest.webmanifest`)).json();
    expect(manifest.name).toBe(e.title);
    // Pages are never stored by shared caches; the cacheable brand payload varies by host (EC-WL-20).
    expect(response.headers()["cache-control"]).toMatch(/private.*no-store/);
    const brandApi = await request.get(`${e.host}/api/v1/public/brand`);
    expect(brandApi.headers()["vary"]).toContain("Host");
    expect(brandApi.headers()["vary"]).toContain("X-HRMS-Host");
    report.push({ host: e.host, html_tag: htmlTag.replace(/ class="[^"]*"/, ""), title: e.title, brand_tokens: style, icon, manifest });
  }
  const unknown = await (await request.get(`${HOSTS.unknown}/login`)).text();
  expect(unknown).toContain("This address is not configured");
  for (const name of ["Alpha People", "Beta Gulf", "Gamma Health"]) expect(unknown).not.toContain(name);
  report.push({ host: HOSTS.unknown, result: "neutral 'This address is not configured' page" });
  await testInfo.attach("first-paint.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
});

test("three isolated Chrome profiles sign in on their own hosts and stay on them", async ({ browser }, testInfo) => {
  const alpha = await openTenant(browser, testInfo, "alpha-admin", HOSTS.alpha);
  const beta = await openTenant(browser, testInfo, "beta-admin", HOSTS.beta);
  const gamma = await openTenant(browser, testInfo, "gamma-admin", HOSTS.gamma);
  try {
    // Login pages in each brand.
    await alpha.page.goto("/login");
    await expect(alpha.page.getByTestId("brand-product-name")).toHaveText("Alpha People");
    await expect(alpha.page.getByTestId("brand-tagline")).toHaveText("Work, simplified at Alpha");
    await expect(alpha.page.getByTestId("powered-by")).toHaveCount(0); // removed (Enterprise)
    await expect(alpha.page.getByRole("link", { name: "Create your company workspace" })).toHaveCount(0);
    expect(await cssVar(alpha.page, "--primary")).toBe("175 77% 26%");
    await shot(alpha.page, testInfo, "01-alpha-login");

    await beta.page.goto("/login");
    await expect(beta.page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(beta.page.getByTestId("brand-product-name")).toHaveText("PayEase HR"); // locked by the partner
    await expect(beta.page.getByTestId("powered-by")).toHaveCount(0); // hidden and locked by the partner
    await shot(beta.page, testInfo, "01-beta-login-rtl");

    await gamma.page.goto("/login");
    await expect(gamma.page.getByTestId("brand-tagline")).toHaveText("Care teams, organised");
    expect(await cssVar(gamma.page, "--primary")).toBe("224 76% 48%");
    await shot(gamma.page, testInfo, "01-gamma-login");

    // Wrong-tenant sign-in on Alpha's host: generic error, Beta's account untouched.
    await alpha.page.locator("#email").fill(S.companies.beta.admin);
    await alpha.page.locator("#password").fill(S.password);
    await alpha.page.getByRole("button", { name: /sign in/i }).click();
    await expect(alpha.page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
    const betaState = db<{ failed_login_count: number; locked_until: string | null }>("login_state", { email: S.companies.beta.admin })[0];
    expect(betaState.failed_login_count).toBe(0);
    expect(betaState.locked_until).toBeNull();

    await signIn(alpha.page, S.companies.alpha.admin, S.password);
    await signIn(beta.page, S.companies.beta.admin, S.password);
    await signIn(gamma.page, S.companies.gamma.admin, S.password);
    await expect(alpha.page.getByTestId("sidebar-product")).toHaveText("Alpha People");
    await expect(beta.page.getByTestId("sidebar-product")).toHaveText("PayEase HR");
    await expect(gamma.page.getByTestId("sidebar-product")).toHaveText("PayEase HR");
    await expect(alpha.page).toHaveTitle(/Alpha People/);
    await shot(alpha.page, testInfo, "01-alpha-dashboard");
    await shot(beta.page, testInfo, "01-beta-dashboard-rtl");
    await shot(gamma.page, testInfo, "01-gamma-dashboard-light-sidebar");

    // Sessions are per host and per profile.
    expect((await alpha.context.cookies(HOSTS.beta)).map((c) => c.name)).toEqual([]);
    expect((await alpha.context.cookies(HOSTS.alpha)).map((c) => c.name)).toEqual(expect.arrayContaining(["hrms_access", "hrms_csrf"]));
    for (const cookie of await alpha.context.cookies()) {
      expect(cookie.domain, "host-only cookies").toBe("alpha-technologies.hrms.localhost");
      if (cookie.name !== "hrms_csrf") expect(cookie.httpOnly, cookie.name).toBe(true);
    }
    const betaFromAlpha = await alpha.page.request.get(`${HOSTS.beta}/api/v1/auth/me`);
    expect(betaFromAlpha.status()).toBe(401);
    const sessions = db<{ host: string }>("sessions_by_host", { email: S.companies.alpha.admin });
    expect(sessions.at(-1)?.host).toBe("alpha-technologies.hrms.localhost");

    // Direct cross-company API attempts from Alpha's signed-in browser.
    const betaEmployee = S.companies.beta.people.employee.employee_id;
    const betaPayroll = S.companies.beta.payroll_ids.employee;
    expect((await api(alpha.page, "GET", `/employees/${betaEmployee}`)).status).toBe(404);
    expect((await api(alpha.page, "GET", `/payroll/${betaPayroll}/slip`)).status).toBe(404);
    expect((await api(alpha.page, "GET", `/employees/${betaEmployee}/assignments`)).status).toBe(404);
    expect((await api(alpha.page, "GET", `/legal-entities`)).data.map((e: { legal_name: string }) => e.legal_name))
      .toEqual(["Alpha Technologies India Private Limited"]);
    const betaBranding = (await api(beta.page, "GET", "/branding")).data;
    const betaLogo = betaBranding.published.fields.logo_light.url as string;
    expect((await alpha.page.request.get(`${HOSTS.alpha}${betaLogo}`)).status()).toBe(404);
    expect((await beta.page.request.get(`${HOSTS.beta}${betaLogo}`)).status()).toBe(200);
    const forged = await api(alpha.page, "PUT", "/branding/draft", { changes: { tagline: "x" }, company_id: S.companies.beta.company_id });
    expect(forged.status).toBe(422); // unknown fields such as company_id are refused outright

    // Each profile only ever talked to its own host (no other tenant, no third-party fonts).
    for (const t of [alpha, beta, gamma]) expect(hostsOf(t), t.name).toEqual([new URL(t.origin).host]);
    for (const t of [alpha, beta, gamma]) {
      expect(t.errors, `${t.name} page errors`).toEqual([]);
      expect(t.failed.filter((f) => !/ERR_ABORTED/.test(f.error)), `${t.name} failed requests`).toEqual([]);
    }
  } finally {
    await alpha.close();
    await beta.close();
    await gamma.close();
  }
});

test("unknown hosts, the platform console and signup are refused on tenant hosts", async ({ browser }, testInfo) => {
  const tenant = await openTenant(browser, testInfo, "host-rules", HOSTS.alpha);
  try {
    const consoleOnTenant = await tenant.page.goto("/platform/login");
    expect(consoleOnTenant?.status()).toBe(404);
    await tenant.page.goto("/signup");
    await expect(tenant.page).toHaveURL(/\/login$/);
    expect((await tenant.page.request.post(`${HOSTS.alpha}/api/v1/platform/auth/login`, {
      data: { email: S.platform.email, password: S.platform.password },
    })).status()).toBe(404);
    await tenant.page.goto(`${HOSTS.unknown}/login`);
    await expect(tenant.page.getByRole("heading", { name: "This address is not configured" })).toBeVisible();
    await shot(tenant.page, testInfo, "01-unknown-host");
    const unknownLogin = await tenant.page.request.post(`${HOSTS.unknown}/api/v1/auth/login`, {
      data: { email: S.companies.alpha.admin, password: S.password },
    });
    expect(unknownLogin.status()).toBe(401);
    await tenant.page.goto(`${HOSTS.platform}/login`);
    await expect(tenant.page.getByTestId("brand-product-name")).toHaveText("Intertech HRMS");
    await expect(tenant.page.getByRole("link", { name: "Create your company workspace" })).toBeVisible();
    await shot(tenant.page, testInfo, "01-platform-login");
  } finally {
    await tenant.close();
  }
});
