import { PLATFORM, api, expect, host, openTenant, secrets, shot, test, writeEvidence } from "./support";

/**
 * The platform operator and the two partners' administrators: separate consoles, separate
 * identities, aggregate counts only, and a partner brand that reaches only that partner's tenants.
 */
const S = secrets();

test("the platform operator manages tenants and partners but never sees HR data", async ({ browser }, testInfo) => {
  const ops = await openTenant(browser, testInfo, "platform-operator", PLATFORM);
  try {
    await ops.page.goto("/platform/login");
    await ops.page.getByLabel("Email").fill(S.platform.email);
    await ops.page.getByLabel("Password").fill(S.platform.password);
    await ops.page.getByRole("button", { name: "Sign in" }).click();
    await ops.page.waitForURL(/\/platform$/);
    for (const c of Object.values(S.companies)) await expect(ops.page.getByRole("row", { name: new RegExp(c.name) })).toBeVisible();
    await expect(ops.page.getByRole("row", { name: /Beta Logistics/ }).getByLabel("Partner of Beta Logistics")).toHaveValue(String(S.partners.north.id));
    await shot(ops.page, testInfo, "08-platform-tenants");
    const denied: Record<string, number> = {};
    for (const path of ["/employees", "/payroll", "/leaves", "/users", "/audit-logs", "/partner/companies"]) {
      denied[path] = (await api(ops.page, "GET", path)).status;
      expect(denied[path], path).toBe(401);
    }
    writeEvidence("08-platform-denied.json", denied);
  } finally {
    await ops.close();
  }
});

test("partner administrators see only their own clients and brand; their brand reaches only their tenants", async ({ browser, request }, testInfo) => {
  const north = await openTenant(browser, testInfo, "northwind-admin", PLATFORM);
  const south = await openTenant(browser, testInfo, "southern-cross-admin", PLATFORM);
  try {
    for (const [t, email] of [[north, S.partners.north.admin_email], [south, S.partners.south.admin_email]] as const) {
      await t.page.goto("/partner/login");
      await t.page.getByLabel("Email").fill(email);
      await t.page.getByLabel("Password").fill(S.password);
      await t.page.getByRole("button", { name: "Sign in" }).click();
      await t.page.waitForURL(/\/partner$/);
    }
    await expect(north.page.getByTestId("partner-name")).toHaveText("Northwind Partners");
    await expect(north.page.getByRole("row", { name: /Beta Logistics/ })).toBeVisible();
    await expect(north.page.getByRole("row", { name: /Gamma Solutions/ })).toBeVisible();
    await expect(north.page.getByRole("row", { name: /Alpha Technologies/ })).toHaveCount(0);
    await shot(north.page, testInfo, "08-northwind-clients");
    await expect(south.page.getByText("No client companies yet")).toBeVisible();
    await shot(south.page, testInfo, "08-southern-cross-empty");

    const denied: Record<string, number> = {};
    for (const path of ["/employees", "/payroll", "/auth/me", "/platform/companies", "/platform/partners"]) {
      denied[path] = (await api(north.page, "GET", path)).status;
      expect(denied[path], path).toBe(401);
    }
    await north.page.goto("/platform");
    await expect(north.page).toHaveURL(/\/platform\/login/);

    // Northwind changes its support link: Beta (no own link) inherits it; Alpha (direct customer) does not.
    await north.page.goto("/partner");
    await north.page.getByRole("tab", { name: /Partner brand/ }).click();
    await north.page.getByTestId("partner-brand-support_url").fill("https://help.northwind-partners.example/v2");
    await north.page.getByRole("button", { name: "Publish" }).click();
    await expect(north.page.getByText("Partner brand published")).toBeVisible();
    await shot(north.page, testInfo, "08-northwind-brand-published");
    const brand = async (origin: string) => (await (await request.get(`${origin}/api/v1/public/brand`)).json());
    await expect.poll(async () => (await brand(host(S.companies.beta))).support_url, { timeout: 30_000 })
      .toBe("https://help.northwind-partners.example/v2");
    expect((await brand(host(S.companies.alpha))).support_url).not.toBe("https://help.northwind-partners.example/v2");
    expect((await brand(host(S.companies.beta))).product_name).toBe("Beta Workforce"); // not locked: the tenant's own name stays
    writeEvidence("08-partner-denied.json", denied);
  } finally {
    await north.close();
    await south.close();
  }
});

test("the partner console does not exist on tenant addresses", async ({ browser }, testInfo) => {
  const t = await openTenant(browser, testInfo, "partner-on-tenant-host", host(S.companies.beta));
  try {
    const page = await t.page.goto("/partner/login");
    expect(page?.status()).toBe(404);
    const login = await t.page.request.post(`${host(S.companies.beta)}/api/v1/partner/auth/login`, {
      data: { email: S.partners.north.admin_email, password: S.password },
    });
    expect(login.status()).toBe(404);
  } finally {
    await t.close();
  }
});
