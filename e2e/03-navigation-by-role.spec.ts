import { NIMBUS, api, expect, login, openAs, sidebarLinks, step, test } from "./support/fixtures";

const SELF_SERVICE = ["Dashboard", "Attendance", "Leave", "Holidays", "Payslips", "Assets"];

const PERSONAS: { who: string; email: string; roles: string; menu: string[] }[] = [
  { who: "Divya", email: NIMBUS.divya, roles: "Employee", menu: SELF_SERVICE },
  { who: "Arjun", email: NIMBUS.lead, roles: "Employee + custom Team Lead", menu: [...SELF_SERVICE, "Employees", "Organization", "Reports"] },
  { who: "Sneha", email: NIMBUS.manager, roles: "Manager", menu: [...SELF_SERVICE, "Employees", "Organization", "Reports"] },
  { who: "Karan", email: NIMBUS.payroll, roles: "Payroll Manager", menu: [...SELF_SERVICE, "Employees", "Organization", "Payroll", "Reports"] },
  {
    who: "Vikram", email: NIMBUS.hr, roles: "HR Administrator",
    // Email templates and branches only; for this role the branding page shows just its Email tab.
    menu: [...SELF_SERVICE, "Employees", "Organization", "Face kiosk", "Reports", "Users", "Roles & access", "Audit log", "Branding & domains", "Legal entities & branches"],
  },
  { who: "Neha", email: NIMBUS.auditor, roles: "Auditor + Employee", menu: [...SELF_SERVICE, "Employees", "Organization", "Reports", "Users", "Roles & access", "Audit log"] },
  { who: "Pooja", email: NIMBUS.recruiter, roles: "custom Recruiter", menu: [...SELF_SERVICE, "Employees", "Organization", "Users", "Roles & access"] },
  {
    who: "Ananya", email: NIMBUS.admin, roles: "Company Administrator",
    menu: [
      ...SELF_SERVICE, "Employees", "Organization", "Payroll", "Face kiosk", "Reports", "Users", "Roles & access", "Audit log", "Company settings",
      "Branding & domains", "Legal entities & branches",
    ],
  },
];

test("Every persona's menu is generated from their effective permissions", async ({ page }) => {
  for (const persona of PERSONAS) {
    await step(page, `${persona.who} (${persona.roles}) signs in and sees only their menus`, async () => {
      await page.context().clearCookies();
      await login(page, persona.email);
      expect(await sidebarLinks(page)).toEqual(persona.menu);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(persona.who);
      await page.waitForTimeout(600);
    });
  }
});

test("Hidden pages stay locked when opened directly or called through the API", async ({ page }) => {
  await login(page, NIMBUS.divya);
  for (const path of ["/payroll", "/users", "/roles", "/employees", "/settings", "/audit-logs", "/kiosk"]) {
    await step(page, `Divya types ${path} into the address bar`, async () => {
      await page.goto(path);
      await expect(page.getByText("You don't have access to this page")).toBeVisible();
    });
  }
  await step(page, "Calling the APIs behind those pages directly is refused by the server", async () => {
    for (const path of ["/users", "/payroll", "/audit-logs", "/roles", "/settings"]) {
      expect((await api(page, "GET", path)).status, path).toBe(403);
    }
    const employees = await api<{ total: number }>(page, "GET", "/employees");
    expect(employees.data.total).toBe(1); // only her own record
  });
});

test("Employees on a phone get a responsive, permission-trimmed app", async ({ browser }, testInfo) => {
  const phone = await openAs(browser, testInfo, "Divya on a phone", NIMBUS.divya, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await step(phone.page, "The dashboard collapses into a single column with her day and balances", async () => {
    await expect(phone.page.getByText("My day")).toBeVisible();
    await expect(phone.page.getByText("Casual Leave").first()).toBeVisible();
  });
  await step(phone.page, "The menu opens as a drawer with only self-service items", async () => {
    await phone.page.getByRole("button", { name: "Open menu" }).click();
    await expect(phone.page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(SELF_SERVICE);
    await phone.page.getByRole("link", { name: "Leave" }).last().click();
    await expect(phone.page.getByRole("heading", { name: "Leave" })).toBeVisible();
  });
  await phone.close();
});
