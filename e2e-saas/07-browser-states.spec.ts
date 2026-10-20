import { KEYS, api, expect, host, noHorizontalOverflow, openTenant, secrets, shot, signIn, test, writeEvidence } from "./support";

/** Reload, deep links, history, tabs, expiry, revocation, bad networks and small screens. */
const S = secrets();

test("Alpha: deep links, reload, back/forward, and a second tab that follows a sign-out", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const t = await openTenant(browser, testInfo, "alpha-navigation", host(A));
  try {
    await signIn(t.page, A.people.admin.email, S.password);
    await t.page.goto("/employees");
    await expect(t.page.getByText("Sneha Kapoor").first()).toBeVisible();
    await t.page.reload();
    await expect(t.page.getByText("Sneha Kapoor").first()).toBeVisible();
    await t.page.goto("/settings/organization");
    await expect(t.page.getByRole("heading", { name: "Legal entities & branches" })).toBeVisible();
    await t.page.goBack();
    await expect(t.page).toHaveURL(/\/employees$/);
    await t.page.goForward();
    await expect(t.page).toHaveURL(/\/settings\/organization$/);
    const second = await t.context.newPage();
    await second.goto("/leaves");
    await expect(second.getByRole("navigation", { name: "Main" })).toBeVisible();
    await api(t.page, "POST", "/auth/logout");
    await second.goto("/employees");
    await expect(second).toHaveURL(/\/login/);
    await shot(second, testInfo, "07-alpha-second-tab-after-sign-out");
    await second.close();
  } finally {
    await t.close();
  }
});

test("Alpha: a crafted ?next= after sign-in never leaves the company's address", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const results: Record<string, string> = {};
  for (const next of ["/%5Cexample.com", "/%5C%5Cexample.com", "/%09/example.com", "//example.com", "https://example.com", "/leaves"]) {
    const t = await openTenant(browser, testInfo, "alpha-open-redirect", host(A));
    try {
      await t.page.route("**://example.com/**", (route) => route.fulfill({ status: 200, body: "left the site" }));
      await t.page.goto(`/login?next=${next}`);
      await t.page.locator("#email").fill(A.people.emp1.email);
      await t.page.locator("#password").fill(S.password);
      await t.page.getByRole("button", { name: /sign in/i }).click();
      await expect(t.page.getByRole("navigation", { name: "Main" })).toBeVisible();
      results[next] = t.page.url();
      expect(new URL(t.page.url()).host, next).toBe(new URL(host(A)).host);
    } finally {
      await t.close();
    }
  }
  expect(new URL(results["/leaves"]).pathname).toBe("/leaves");
  writeEvidence("07-alpha-next-redirects.json", results);
});

test("Beta: an expired access token refreshes silently; revoked sessions and roles take effect at once", async ({ browser }, testInfo) => {
  const B = S.companies.beta;
  const admin = await openTenant(browser, testInfo, "beta-revoking-admin", host(B));
  const employee = await openTenant(browser, testInfo, "beta-employee-session", host(B));
  const hr = await openTenant(browser, testInfo, "beta-hr-revoked", host(B));
  try {
    await signIn(admin.page, B.people.admin.email, S.password);
    await signIn(employee.page, B.people.emp1.email, S.password);
    await signIn(hr.page, B.people.hr.email, S.password);

    await employee.context.clearCookies({ name: "hrms_access" });
    await employee.page.goto("/leaves");
    await expect(employee.page.getByRole("navigation", { name: "Main" })).toBeVisible(); // refreshed silently
    expect((await api(admin.page, "POST", `/users/${B.people.emp1.user_id}/revoke-sessions`)).status).toBe(200);
    await employee.page.goto("/attendance");
    await expect(employee.page).toHaveURL(/\/login/);
    await shot(employee.page, testInfo, "07-beta-session-revoked");

    await hr.page.goto("/users");
    await expect(hr.page.getByRole("heading", { name: "Users" }).first()).toBeVisible();
    const roles = (await api(admin.page, "GET", "/roles")).data as { id: number; system_key: string | null }[];
    const role = (k: string) => roles.find((r) => r.system_key === k)!.id;
    expect((await api(admin.page, "PUT", `/users/${B.people.hr.user_id}/roles`, { role_ids: [role("employee")] })).status).toBe(200);
    await hr.page.goto("/users");
    await expect(hr.page.getByText("You don't have access to this page")).toBeVisible();
    expect((await api(hr.page, "GET", "/users")).status).toBe(403);
    await shot(hr.page, testInfo, "07-beta-hr-role-revoked");
    expect((await api(admin.page, "PUT", `/users/${B.people.hr.user_id}/roles`, { role_ids: [role("hr_admin")] })).status).toBe(200);
    await hr.page.goto("/users");
    await expect(hr.page.getByRole("heading", { name: "Users" }).first()).toBeVisible();
  } finally {
    await admin.close();
    await employee.close();
    await hr.close();
  }
});

test("Gamma: a failed network call and a malformed response leave the app usable", async ({ browser }, testInfo) => {
  const G = S.companies.gamma;
  const t = await openTenant(browser, testInfo, "gamma-bad-network", host(G));
  try {
    await signIn(t.page, G.people.hr.email, S.password);
    await t.page.route("**/api/v1/employees?**", (route) => route.abort("internetdisconnected"));
    await t.page.goto("/employees");
    await expect(t.page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(t.page.getByText("David Wilson")).toHaveCount(0);
    await shot(t.page, testInfo, "07-gamma-employees-offline");
    await t.page.unroute("**/api/v1/employees?**");
    await t.page.reload();
    await expect(t.page.getByText("David Wilson").first()).toBeVisible();

    await t.page.route("**/api/v1/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "<html>not json" }));
    await t.page.goto("/dashboard");
    await expect(t.page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await shot(t.page, testInfo, "07-gamma-malformed-dashboard");
    await t.page.unroute("**/api/v1/dashboard**");
    await t.page.reload();
    await expect(t.page.getByRole("navigation", { name: "Main" })).toBeVisible();
    writeEvidence("07-gamma-bad-network-console.json", { errors: t.errors, console: t.console.filter((m) => m.type === "error") });
  } finally {
    await t.close();
  }
});

for (const key of KEYS) {
  test(`${key}: phone and tablet layouts without sideways scrolling`, async ({ browser }, testInfo) => {
    const c = S.companies[key];
    const report: Record<string, unknown> = {};
    for (const [label, viewport, isMobile] of [["phone", { width: 390, height: 844 }, true], ["tablet", { width: 820, height: 1180 }, true]] as const) {
      const t = await openTenant(browser, testInfo, `${key}-${label}`, host(c), { viewport, isMobile });
      try {
        await signIn(t.page, c.people.emp1.email, S.password).catch(async () => {
          // On a phone the navigation sits in a drawer, so wait for the dashboard instead.
          await expect(t.page).toHaveURL(/\/dashboard/);
        });
        await expect(t.page).toHaveURL(/\/dashboard/);
        for (const path of ["/dashboard", "/leaves", "/payslips"]) {
          await t.page.goto(path);
          await t.page.waitForLoadState("networkidle");
          report[`${label} ${path}`] = await noHorizontalOverflow(t.page);
          expect(report[`${label} ${path}`], `${key} ${label} ${path}`).toBe(true);
        }
        await t.page.goto("/dashboard");
        if (label === "phone") {
          await t.page.getByRole("button", { name: "Open menu" }).click();
          await expect(t.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Leave" })).toBeVisible();
        }
        await shot(t.page, testInfo, `07-${key}-${label}`);
        expect(t.errors).toEqual([]);
      } finally {
        await t.close();
      }
    }
    writeEvidence(`07-${key}-responsive.json`, report);
  });
}
