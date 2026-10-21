import type { Page } from "@playwright/test";

import { type Company, api, expect, host, openTenant, secrets, shot, sidebarLinks, signIn, test, writeEvidence } from "./support";

/**
 * Each seeded role in the real UI: menus, the people it can see, pages it cannot open, payroll and
 * salary visibility. The API is queried from the same browser so the UI and the server agree.
 */
const S = secrets();
const SELF_SERVICE = ["Dashboard", "Attendance", "Leave", "Holidays", "Payslips", "Assets"];

async function visibleIds(page: Page): Promise<number[]> {
  return (await api(page, "GET", "/employees?limit=200")).data.items.map((e: { id: number }) => e.id).sort();
}

async function as(browser: any, testInfo: any, c: Company, key: string) {
  const t = await openTenant(browser, testInfo, `${c.slug}-${key}`, host(c));
  await signIn(t.page, c.people[key].email, S.password);
  return t;
}

const ids = (c: Company, keys: string[]) => keys.map((k) => c.people[k].employee_id).sort();

test("Alpha: department manager, team lead, employee, HR and finance each see their own scope", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const evidence: Record<string, unknown> = {};

  const manager = await as(browser, testInfo, A, "deptmgr");
  expect(await visibleIds(manager.page)).toEqual(ids(A, ["deptmgr", "teamlead", "emp1", "emp2"]));
  expect(await sidebarLinks(manager.page)).not.toContain("Payroll");
  await manager.page.goto("/employees");
  await expect(manager.page.getByText("Rohan Gupta").first()).toBeVisible();
  await expect(manager.page.getByText("Arjun Singh")).toHaveCount(0);
  await shot(manager.page, testInfo, "03-alpha-manager-employees");
  const salaries = (await api(manager.page, "GET", "/employees?limit=200")).data.items
    .filter((e: { id: number }) => e.id !== A.people.deptmgr.employee_id).map((e: { base_salary?: unknown }) => e.base_salary ?? null);
  expect(salaries.every((s: unknown) => s === null)).toBe(true); // reporting line ≠ salary access
  evidence.manager = { sees: await visibleIds(manager.page), menu: await sidebarLinks(manager.page) };
  await manager.close();

  const lead = await as(browser, testInfo, A, "teamlead");
  expect(await visibleIds(lead.page)).toEqual(ids(A, ["teamlead", "emp1", "emp2"]));
  evidence.teamLead = { sees: await visibleIds(lead.page) };
  await lead.close();

  const employee = await as(browser, testInfo, A, "emp1");
  expect(await sidebarLinks(employee.page)).toEqual(SELF_SERVICE);
  expect(await visibleIds(employee.page)).toEqual(ids(A, ["emp1"]));
  for (const path of ["/employees", "/payroll", "/settings", "/users", "/settings/branding", "/settings/organization"]) {
    await employee.page.goto(path);
    await expect(employee.page.getByText("You don't have access to this page"), path).toBeVisible();
  }
  await shot(employee.page, testInfo, "03-alpha-employee-access-denied");
  for (const path of ["/payroll", "/users", "/roles", "/branding", "/legal-entities"]) {
    expect((await api(employee.page, "GET", path)).status, path).toBe(403);
  }
  evidence.employee = { menu: await sidebarLinks(employee.page) };
  await employee.close();

  const hr = await as(browser, testInfo, A, "hr");
  expect((await visibleIds(hr.page)).length).toBe(Object.keys(A.people).length);
  expect(await sidebarLinks(hr.page)).not.toContain("Payroll");
  expect((await api(hr.page, "GET", "/payroll")).status).toBe(403);
  const hrSalaries = (await api(hr.page, "GET", "/employees?limit=200")).data.items
    .filter((e: { id: number }) => e.id !== A.people.hr.employee_id).map((e: { base_salary?: unknown }) => e.base_salary ?? null);
  expect(hrSalaries.every((s: unknown) => s === null)).toBe(true); // HR administration ≠ pay data
  await hr.close();

  const finance = await as(browser, testInfo, A, "finance");
  await finance.page.goto("/payroll/legacy");
  await expect(finance.page.getByText("₹").first()).toBeVisible();
  await shot(finance.page, testInfo, "03-alpha-finance-payroll");
  expect((await api(finance.page, "GET", "/users")).status).toBe(403);
  expect((await api(finance.page, "GET", "/payroll")).data.total).toBe(Object.keys(A.payroll).length);
  await finance.close();
  writeEvidence("03-alpha-scopes.json", evidence);
});

test("Beta: the Operations Manager's role covers the Dubai branch only; payroll is in AED", async ({ browser }, testInfo) => {
  const B = S.companies.beta;
  const ops = await as(browser, testInfo, B, "opsmgr");
  expect(await visibleIds(ops.page)).toEqual(ids(B, ["admin", "hr", "payroll", "opsmgr", "emp1"]));
  await ops.page.goto("/employees");
  await expect(ops.page.getByText("Aisha Siddiqui").first()).toBeVisible();
  await expect(ops.page.getByText("Ravi Menon")).toHaveCount(0); // Abu Dhabi
  expect([403, 404]).toContain((await api(ops.page, "GET", `/employees/${B.people.emp2.employee_id}`)).status);
  await shot(ops.page, testInfo, "03-beta-operations-manager-dubai-only");
  await ops.close();

  const payroll = await as(browser, testInfo, B, "payroll");
  await payroll.page.goto("/payroll");
  await expect(payroll.page.getByText(/AED/).first()).toBeVisible();
  await expect(payroll.page.getByText("₹")).toHaveCount(0);
  await shot(payroll.page, testInfo, "03-beta-payroll-aed");
  expect((await api(payroll.page, "GET", "/roles")).status).toBe(403);
  await payroll.close();
});

test("Gamma: manager tree, team lead's direct reports and employee self-service", async ({ browser }, testInfo) => {
  const G = S.companies.gamma;
  const manager = await as(browser, testInfo, G, "deptmgr");
  expect(await visibleIds(manager.page)).toEqual(ids(G, ["deptmgr", "teamlead", "emp1", "emp2"]));
  await manager.page.goto("/organization");
  await expect(manager.page.getByText("Jessica Davis").first()).toBeVisible();
  await shot(manager.page, testInfo, "03-gamma-manager-organization");
  await manager.close();
  const lead = await as(browser, testInfo, G, "teamlead");
  expect(await visibleIds(lead.page)).toEqual(ids(G, ["teamlead", "emp1", "emp2"]));
  await lead.close();
  const employee = await as(browser, testInfo, G, "emp2");
  expect(await sidebarLinks(employee.page)).toEqual(SELF_SERVICE);
  expect(await visibleIds(employee.page)).toEqual(ids(G, ["emp2"]));
  expect([403, 404]).toContain((await api(employee.page, "GET", `/employees/${G.people.emp1.employee_id}`)).status);
  await employee.close();
});
