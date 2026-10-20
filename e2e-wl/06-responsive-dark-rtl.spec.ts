import { HOSTS, cssVar, expect, openTenant, secrets, shot, signIn, test } from "./support";

/** Mobile, dark mode, right-to-left and keyboard use of the branded workspaces. */
test.describe.configure({ mode: "serial" });

const S = secrets();

test("Beta on a phone in dark mode: right-to-left layout, drawer from the right", async ({ browser }, testInfo) => {
  const phone = await openTenant(browser, testInfo, "beta-phone-dark", HOSTS.beta, {
    viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true,
  });
  try {
    await phone.page.goto("/login");
    await expect(phone.page.locator("html")).toHaveAttribute("dir", "rtl");
    await shot(phone.page, testInfo, "06-beta-phone-login-rtl-dark");
    await phone.page.locator("#email").fill(S.companies.beta.people.employee.email);
    await phone.page.locator("#password").fill(S.password);
    await phone.page.getByRole("button", { name: /sign in/i }).click();
    await phone.page.waitForURL(/\/dashboard/);
    await expect(phone.page.locator("html")).toHaveClass(/dark/);
    const darkPrimary = await cssVar(phone.page, "--primary");
    expect(darkPrimary.split(" ")[2]).toMatch(/^(6[8-9]|[7-9]\d)%$/); // dark-theme shade, light enough on dark surfaces
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(phone.page, testInfo, "06-beta-phone-dashboard-rtl-dark");
    await phone.page.getByRole("button", { name: "Open menu" }).click();
    const drawer = phone.page.locator("aside").filter({ has: phone.page.getByRole("navigation", { name: "Main" }) }).last();
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.x + box!.width).toBeGreaterThan(380); // anchored to the right edge in RTL
    await shot(phone.page, testInfo, "06-beta-phone-menu-rtl");
  } finally {
    await phone.close();
  }
});

test("Gamma in dark mode and Alpha on a phone; keyboard reaches the sign-in form", async ({ browser }, testInfo) => {
  const gamma = await openTenant(browser, testInfo, "gamma-dark", HOSTS.gamma, { colorScheme: "dark" });
  const alpha = await openTenant(browser, testInfo, "alpha-phone", HOSTS.alpha, { viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    await signIn(gamma.page, S.companies.gamma.people.hr.email, S.password);
    await expect(gamma.page.locator("html")).toHaveClass(/dark/);
    expect(await cssVar(gamma.page, "--primary")).not.toBe("224 76% 48%"); // the dark-theme token is used
    await shot(gamma.page, testInfo, "06-gamma-dark-dashboard");

    await alpha.page.goto("/login");
    await shot(alpha.page, testInfo, "06-alpha-phone-login");
    await alpha.page.locator("body").click();
    await alpha.page.keyboard.press("Tab");
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      reached = await alpha.page.evaluate(() => document.activeElement?.id === "email");
      if (!reached) await alpha.page.keyboard.press("Tab");
    }
    expect(reached).toBe(true);
    await alpha.page.keyboard.type(S.companies.alpha.people.employee.email);
    await alpha.page.keyboard.press("Tab");
    await alpha.page.keyboard.type(S.password);
    await alpha.page.keyboard.press("Enter");
    await alpha.page.waitForURL(/\/dashboard/);
    const ring = await alpha.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ring").trim());
    expect(ring).toBe("175 77% 26%");
    await shot(alpha.page, testInfo, "06-alpha-phone-dashboard");
  } finally {
    await gamma.close();
    await alpha.close();
  }
});
