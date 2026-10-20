import { HOSTS, api, expect, openTenant, secrets, shot, signIn, test } from "./support";
import { sidebarLinks } from "../e2e/support/fixtures";

/**
 * Role-based settings visibility and data scopes inside each company: employees, HR, payroll
 * and finance, managers and an entity/branch-scoped branch manager. Menus are hidden in the UI
 * and every rule is enforced again by the API.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();
const A = S.companies.alpha;
const B = S.companies.beta;
const G = S.companies.gamma;

test("Alpha: employee, HR and manager each see only what their role allows", async ({ browser }, testInfo) => {
  const employee = await openTenant(browser, testInfo, "alpha-employee", HOSTS.alpha);
  const hr = await openTenant(browser, testInfo, "alpha-hr", HOSTS.alpha);
  const manager = await openTenant(browser, testInfo, "alpha-manager", HOSTS.alpha);
  try {
    await signIn(employee.page, A.people.employee.email, S.password);
    const employeeLinks = await sidebarLinks(employee.page);
    expect(employeeLinks).not.toContain("Branding & domains");
    expect(employeeLinks).not.toContain("Payroll");
    expect(employeeLinks).toContain("Payslips");
    await employee.page.goto("/settings/branding");
    await expect(employee.page.getByText(/don't have access|permission/i).first()).toBeVisible();
    expect((await api(employee.page, "GET", "/branding")).status).toBe(403);
    expect((await api(employee.page, "PUT", "/branding/draft", { changes: { tagline: "hijack" } })).status).toBe(403);
    expect((await api(employee.page, "GET", "/domains")).status).toBe(403);
    expect((await api(employee.page, "GET", "/branding/current")).status).toBe(200); // own live brand only
    await shot(employee.page, testInfo, "03-alpha-employee-no-branding");

    await signIn(hr.page, A.people.hr.email, S.password);
    const hrLinks = await sidebarLinks(hr.page);
    expect(hrLinks).toContain("Branding & domains"); // email wording (email_template:manage)
    expect(hrLinks).toContain("Legal entities & branches"); // org:read
    expect(hrLinks).not.toContain("Payroll");
    await hr.page.goto("/settings/branding");
    await expect(hr.page.getByRole("tab", { name: "Email" })).toBeVisible();
    await expect(hr.page.getByRole("tab", { name: "Identity" })).toHaveCount(0);
    await expect(hr.page.getByRole("tab", { name: "Domains" })).toHaveCount(0);
    await expect(hr.page.getByTestId("email-preview")).toBeVisible();
    expect((await api(hr.page, "GET", "/branding")).status).toBe(403);
    expect((await api(hr.page, "GET", "/payroll")).status).toBe(403);
    await shot(hr.page, testInfo, "03-alpha-hr-email-only");
    await hr.page.goto("/settings/organization");
    await expect(hr.page.getByRole("heading", { name: "Legal entities & branches" })).toBeVisible();
    await expect(hr.page.getByTestId("add-entity")).toHaveCount(0); // org:manage_entities is admin only
    await shot(hr.page, testInfo, "03-alpha-hr-organization");

    await signIn(manager.page, A.people.manager.email, S.password);
    expect(await sidebarLinks(manager.page)).not.toContain("Payroll");
    const reports = (await api(manager.page, "GET", "/employees?limit=100")).data.items.map((e: { id: number }) => e.id);
    expect(reports).toEqual(expect.arrayContaining([A.people.employee.employee_id, A.people.anita.employee_id]));
    expect(reports).not.toContain(A.people.hr.employee_id);
    expect((await api(manager.page, "GET", `/payroll/${A.payroll_ids.employee}/slip`)).status).toBe(404); // manager ≠ payroll reader
  } finally {
    await employee.close();
    await hr.close();
    await manager.close();
  }
});

test("Beta: a branch manager's role covers only the Dubai Marina branch", async ({ browser }, testInfo) => {
  const branchManager = await openTenant(browser, testInfo, "beta-branch-manager", HOSTS.beta);
  try {
    await signIn(branchManager.page, B.people.branchmgr.email, S.password);
    await branchManager.page.goto("/employees");
    await expect(branchManager.page.getByText("الزهراء").first()).toBeVisible();
    await expect(branchManager.page.getByText("Rashid Khan")).toHaveCount(0); // Abu Dhabi branch
    const visible = (await api(branchManager.page, "GET", "/employees?limit=100")).data.items as { id: number; location: string }[];
    expect(new Set(visible.map((e) => e.location))).toEqual(new Set(["Dubai Marina"]));
    expect((await api(branchManager.page, "GET", `/employees/${B.people.rashid.employee_id}`)).status).toBe(404);
    expect((await api(branchManager.page, "GET", `/employees/${A.people.employee.employee_id}`)).status).toBe(404); // other tenant
    expect((await api(branchManager.page, "GET", "/payroll")).status).toBe(403);
    await shot(branchManager.page, testInfo, "03-beta-branch-manager-employees-rtl");
  } finally {
    await branchManager.close();
  }
});

test("Gamma: HR and finance are separate; finance sees USD payroll, HR does not", async ({ browser }, testInfo) => {
  const hr = await openTenant(browser, testInfo, "gamma-hr", HOSTS.gamma);
  const finance = await openTenant(browser, testInfo, "gamma-finance", HOSTS.gamma);
  const manager = await openTenant(browser, testInfo, "gamma-manager", HOSTS.gamma);
  try {
    await signIn(hr.page, G.people.hr.email, S.password);
    expect(await sidebarLinks(hr.page)).not.toContain("Payroll");
    expect((await api(hr.page, "GET", "/payroll")).status).toBe(403);
    expect((await api(hr.page, "GET", `/payroll/${G.payroll_ids.employee}/slip`)).status).toBe(404);
    expect((await api(hr.page, "GET", "/employees?limit=100")).data.total).toBeGreaterThanOrEqual(7);

    await signIn(finance.page, G.people.finance.email, S.password);
    expect(await sidebarLinks(finance.page)).toContain("Payroll");
    await finance.page.goto("/payroll");
    const month = new Date(S.payroll_month);
    await finance.page.locator("select").first().selectOption(String(month.getUTCMonth() + 1)).catch(() => undefined);
    const list = (await api(finance.page, "GET", `/payroll?year=${month.getUTCFullYear()}&month=${month.getUTCMonth() + 1}`)).data;
    expect(list.items.length).toBe(2);
    expect(new Set(list.items.map((p: { currency: string }) => p.currency))).toEqual(new Set(["USD"]));
    expect((await api(finance.page, "PUT", `/employees/${G.people.gina.employee_id}`, { position: "x" })).status).toBe(403);
    expect((await api(finance.page, "GET", "/branding")).status).toBe(403);
    await shot(finance.page, testInfo, "03-gamma-finance-payroll");

    await signIn(manager.page, G.people.manager.email, S.password);
    const team = (await api(manager.page, "GET", "/employees?limit=100")).data.items.map((e: { id: number }) => e.id);
    expect(team).toContain(G.people.employee.employee_id);
    expect(team).not.toContain(G.people.gina.employee_id);
  } finally {
    await hr.close();
    await finance.close();
    await manager.close();
  }
});
