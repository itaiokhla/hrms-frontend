import { HOSTS, db, expect, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * The platform console (platform host only, never white-labelled): tenants with their hosts and
 * plans, the reseller and its locked fields, and the abuse kill switch.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();

test("platform console: partner and tenants, kill switch falls back to the platform brand", async ({ browser, request }, testInfo) => {
  const ops = await openTenant(browser, testInfo, "platform-ops", HOSTS.platform);
  try {
    // A browser that is also signed in to a tenant on the platform host carries its brand hint...
    await signIn(ops.page, S.companies.alpha.admin, S.password);
    await expect(ops.page.getByTestId("sidebar-product")).toHaveText("Alpha People"); // tenant brand, no flash
    const tenantHtml = await ops.page.content();
    expect(tenantHtml).toContain("--primary:175 77% 26%");
    // ...but the console is always in the platform brand.
    await ops.page.goto("/platform/login");
    expect(await ops.page.locator("#brand-tokens").innerHTML()).toBe("");
    await ops.page.locator('input[type="email"]').fill(S.platform.email);
    await ops.page.locator('input[type="password"]').fill(S.platform.password);
    await ops.page.getByRole("button", { name: /sign in/i }).click();
    await ops.page.waitForURL(/\/platform$/);
    for (const company of Object.values(S.companies)) {
      await expect(ops.page.locator(`[data-company="${company.slug}"]`)).toBeVisible();
    }
    await expect(ops.page.locator('[data-company="beta-gulf-trading"]')).toContainText("people.betagulf.localhost");
    await shot(ops.page, testInfo, "07-platform-tenants");
    await ops.page.getByRole("tab", { name: /Partners/ }).click();
    const partner = ops.page.locator('[data-partner="payease"]');
    await expect(partner).toContainText("Beta Gulf Trading");
    await expect(partner).toContainText("Gamma Health Systems");
    await expect(partner).not.toContainText("Alpha Technologies");
    await expect(partner.locator('[data-lock="product_name"]')).toHaveAttribute("aria-pressed", "true");
    await shot(ops.page, testInfo, "07-platform-partner-locks", true);

    // Abuse kill switch on Gamma.
    await ops.page.getByRole("tab", { name: /Tenants/ }).click();
    await ops.page.getByRole("button", { name: "Brand kill switch for Gamma Health Systems" }).click();
    await ops.page.getByPlaceholder("e.g. impersonating a bank").fill("E2E: reported impersonation");
    await ops.page.getByRole("button", { name: "Disable brand" }).last().click();
    await expect(ops.page.locator('[data-company="gamma-health-systems"]')).toContainText("Brand disabled");
    await expect.poll(async () => (await (await request.get(`${HOSTS.gamma}/api/v1/public/brand`)).json()).tagline, { timeout: 45_000 })
      .not.toBe("Care teams, organised");
    const gammaPage = await openTenant(browser, testInfo, "gamma-after-kill-switch", HOSTS.gamma);
    await expect.poll(async () => {
      await gammaPage.page.goto("/login");
      return gammaPage.page.locator("#brand-tokens").innerHTML();
    }, { timeout: 45_000 }).not.toContain("224 76% 48%");
    await shot(gammaPage.page, testInfo, "07-gamma-after-kill-switch");
    const audit = db<{ action: string; description: string }>("platform_audit", { module: "Platform" });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["PARTNER_CREATED", "BRAND_PUBLISHED", "BRAND_KILL_SWITCH"]));
    await testInfo.attach("platform-audit.json", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });

    // Restore.
    await ops.page.getByRole("button", { name: "Brand kill switch for Gamma Health Systems" }).click();
    await ops.page.getByRole("button", { name: "Restore" }).last().click();
    await expect(ops.page.locator('[data-company="gamma-health-systems"]')).not.toContainText("Brand disabled");
    await expect.poll(async () => {
      await gammaPage.page.goto("/login");
      return gammaPage.page.locator("#brand-tokens").innerHTML();
    }, { timeout: 45_000 }).toContain("224 76% 48%");
    await gammaPage.close();
  } finally {
    await ops.close();
  }
});
