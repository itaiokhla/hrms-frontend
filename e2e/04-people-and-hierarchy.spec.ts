import type { Page } from "@playwright/test";

import { NIMBUS, SAFFRON, api, expect, inDays, login, openAs, openEmployee, step, test, toast } from "./support/fixtures";

async function directory(page: Page): Promise<string[]> {
  await page.goto("/employees");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const names = await page.locator("tbody tr td:first-child p.font-medium").allInnerTexts();
  return names.map((n) => n.trim()).sort();
}

async function employeeId(page: Page, name: string): Promise<number> {
  const result = await api<{ items: { id: number; full_name: string }[] }>(page, "GET", `/employees?q=${encodeURIComponent(name)}`);
  const match = result.data.items.find((e) => e.full_name === name);
  if (!match) throw new Error(`${name} not visible`);
  return match.id;
}

async function changeManager(page: Page, employee: string, manager: string) {
  await openEmployee(page, employee);
  const drawer = page.getByRole("dialog", { name: employee });
  await drawer.getByRole("button", { name: "Change manager" }).click();
  await drawer.locator("button[aria-haspopup=listbox]").click();
  await drawer.getByPlaceholder("Type a name, code or email").fill(manager);
  await drawer.getByRole("option", { name: new RegExp(manager) }).click();
  await drawer.getByRole("button", { name: "Save" }).click();
}

test("Each manager sees exactly their reporting tree, at every level", async ({ page }) => {
  const cases: [string, string, string[]][] = [
    ["Arjun (Team Lead: direct reports)", NIMBUS.lead, ["Arjun Das", "Divya Menon", "Farhan Ali", "Sameer Khan"]],
    ["Sneha (Manager: whole tree)", NIMBUS.manager, ["Arjun Das", "Divya Menon", "Farhan Ali", "Meera Pillai", "Sameer Khan", "Sneha Iyer"]],
    ["Rohan (VP: two levels down)", NIMBUS.vp, ["Arjun Das", "Divya Menon", "Farhan Ali", "Meera Pillai", "Nikhil Jain", "Rohan Gupta", "Sameer Khan", "Sneha Iyer"]],
    ["Tara (Sales + project manager of Meera)", NIMBUS.sales, ["Isha Bose", "Meera Pillai", "Rahul Verma", "Tara Kapoor"]],
  ];
  for (const [label, email, expected] of cases) {
    await step(page, `${label} opens the employee directory`, async () => {
      await page.context().clearCookies();
      await login(page, email);
      expect(await directory(page)).toEqual(expected);
    });
  }
  await step(page, "Tara cannot open someone outside her tree, even by id", async () => {
    const ananyaView = await openAs(page.context().browser()!, test.info(), "Ananya (lookup)", NIMBUS.admin);
    const divyaId = await employeeId(ananyaView.page, "Divya Menon");
    await ananyaView.close();
    expect((await api(page, "GET", `/employees/${divyaId}`)).status).toBe(404);
  });
});

test("Personal and salary details appear only where access covers them", async ({ page }) => {
  await step(page, "Sneha (manager) sees Divya's job details but no personal or salary data", async () => {
    await login(page, NIMBUS.manager);
    await openEmployee(page, "Divya Menon");
    const drawer = page.getByRole("dialog", { name: "Divya Menon" });
    await expect(drawer.getByText("Reporting line")).toBeVisible();
    await expect(drawer.getByText("Personal details")).toHaveCount(0);
    await expect(drawer.getByText("Base salary")).toHaveCount(0);
  });
  await step(page, "Vikram (HR) sees personal details but still no salary", async () => {
    await page.context().clearCookies();
    await login(page, NIMBUS.hr);
    await openEmployee(page, "Divya Menon");
    const drawer = page.getByRole("dialog", { name: "Divya Menon" });
    await expect(drawer.getByText("Personal details")).toBeVisible();
    await expect(drawer.getByText("Base salary")).toHaveCount(0);
  });
  await step(page, "Ananya (administrator) sees salary too", async () => {
    await page.context().clearCookies();
    await login(page, NIMBUS.admin);
    await openEmployee(page, "Divya Menon");
    await expect(page.getByRole("dialog", { name: "Divya Menon" }).getByText("Base salary")).toBeVisible();
    // Base salary is the basic component of her structure in effect: 50% of ₹85,000 a month.
    await expect(page.getByRole("dialog", { name: "Divya Menon" }).getByText("₹42,500")).toBeVisible();
  });
});

test("Two companies can have people with the same name without ever seeing each other", async ({ page }) => {
  await step(page, "Saffron's admin searches for Pooja Sharma and finds only their own", async () => {
    await login(page, SAFFRON.admin);
    await page.goto("/employees");
    await page.getByPlaceholder("Search name, email, code or role").fill("Pooja Sharma");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("pooja.sharma@saffronfoods.in");
    await expect(page.getByText("nimbustech.io")).toHaveCount(0);
  });
});

test("Org chart, manager changes, cycle protection and delegation", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.admin);

  await step(page, "The org chart expands five levels: CEO → VP → Manager → Lead → Engineers", async () => {
    await page.goto("/organization");
    await expect(page.getByRole("button", { name: /^Ananya Rao.*5 reports/ })).toBeVisible();
    await page.getByRole("button", { name: "Expand Rohan Gupta's team" }).click();
    await page.getByRole("button", { name: "Expand Sneha Iyer's team" }).click();
    await page.getByRole("button", { name: "Expand Arjun Das's team" }).click();
    for (const name of ["Divya Menon", "Farhan Ali", "Sameer Khan"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
  });

  const sneha = await openAs(browser, testInfo, "Sneha (manager)", NIMBUS.manager);
  await step(sneha.page, "Sneha's own org chart starts at her: she cannot see above or beside", async () => {
    await sneha.page.goto("/organization");
    await expect(sneha.page.getByRole("button", { name: /^Sneha Iyer/ })).toBeVisible();
    await expect(sneha.page.getByRole("button", { name: /^Ananya Rao/ })).toHaveCount(0);
    await expect(sneha.page.getByRole("button", { name: /^Tara Kapoor/ })).toHaveCount(0);
  });

  const arjun = await openAs(browser, testInfo, "Arjun (team lead)", NIMBUS.lead);
  await step(arjun.page, "Farhan's pending leave is waiting on Arjun, his manager", async () => {
    await arjun.page.goto("/leaves?tab=approvals");
    await expect(arjun.page.getByText("Farhan Ali")).toBeVisible();
  });

  await step(page, "Ananya moves Farhan from Arjun to Sneha", async () => {
    await changeManager(page, "Farhan Ali", "Sneha Iyer");
    await toast(page, "Reporting line updated");
  });

  await step([arjun.page, sneha.page], "The pending approval follows the new reporting line", async () => {
    await arjun.page.reload();
    await expect(arjun.page.getByText("Divya Menon")).toBeVisible(); // inbox loaded: Divya's request is still his
    await expect(arjun.page.getByText("Farhan Ali")).toHaveCount(0);
    await sneha.page.goto("/leaves?tab=approvals");
    await expect(sneha.page.getByText("Farhan Ali")).toBeVisible();
    // Arjun has also lost access to Farhan's record.
    const farhanId = await employeeId(sneha.page, "Farhan Ali");
    expect((await api(arjun.page, "GET", `/employees/${farhanId}`)).status).toBe(404);
  });

  await step(page, "Making Rohan report to Divya (his own report's report) is blocked", async () => {
    await page.keyboard.press("Escape");
    await changeManager(page, "Rohan Gupta", "Divya Menon");
    await toast(page, "This change would create a circular reporting line.");
  });

  await step(page, "Making someone their own manager is blocked by the server", async () => {
    const rohanId = await employeeId(page, "Rohan Gupta");
    const result = await api<{ code: string }>(page, "PUT", `/org/employees/${rohanId}/manager`, { manager_id: rohanId });
    expect(result.status).toBe(400);
    expect(result.data.code).toBe("SELF_REPORTING");
  });

  await step(page, "Secondary lines keep Meera's project manager separate from the tree", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/organization");
    await page.getByRole("tab", { name: "Secondary lines" }).click();
    const row = page.getByRole("row", { name: /Meera Pillai/ });
    await expect(row).toContainText("Tara Kapoor");
    await expect(row).toContainText("Project");
  });

  await step(arjun.page, "Arjun delegates his approvals to his manager Sneha for three days", async () => {
    await arjun.page.goto("/organization");
    await arjun.page.getByRole("tab", { name: "Delegations" }).click();
    await arjun.page.getByRole("button", { name: "Delegate approvals" }).click();
    const dialog = arjun.page.getByRole("dialog", { name: "Delegate leave approvals" });
    await dialog.getByLabel("Delegate to").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Sneha");
    await dialog.getByRole("option", { name: /Sneha Iyer/ }).click();
    await dialog.getByLabel("Starts").fill(inDays(0));
    await dialog.getByLabel("Ends").fill(inDays(2));
    await dialog.getByLabel("Reason").fill("Off-site training");
    await dialog.getByRole("button", { name: "Delegate", exact: true }).click(); // not the "Delegate to" picker
    await toast(arjun.page, "Approvals delegated");
    await expect(arjun.page.getByRole("row", { name: /Sneha Iyer/ })).toContainText("Active");
  });

  await step(sneha.page, "Sneha now sees Divya's request too, marked as acting for Arjun", async () => {
    await sneha.page.reload();
    await expect(sneha.page.getByText("Divya Menon")).toBeVisible();
    await expect(sneha.page.getByText("You're acting as a delegate for the assigned approver.")).toBeVisible();
  });

  await step(page, "Ending Arjun's employment is refused while people still report to him", async () => {
    await openEmployee(page, "Arjun Das");
    await page.getByRole("dialog", { name: "Arjun Das" }).getByRole("button", { name: "End employment" }).click();
    await page.getByRole("dialog", { name: /End employment for Arjun Das/ }).getByRole("button", { name: "End employment" }).click();
    await toast(page, /Reassign this employee's \d direct report/);
  });

  await step(page, "The intern Sameer leaves: record kept, marked inactive", async () => {
    await page.keyboard.press("Escape");
    await openEmployee(page, "Sameer Khan");
    await page.getByRole("dialog", { name: "Sameer Khan" }).getByRole("button", { name: "End employment" }).click();
    await page.getByRole("dialog", { name: /End employment for Sameer Khan/ }).getByRole("button", { name: "End employment" }).click();
    await toast(page, "Employment ended");
    await page.keyboard.press("Escape");
    await page.goto("/employees");
    await page.getByLabel("Include inactive").check();
    await expect(page.getByRole("row", { name: /Sameer Khan/ })).toContainText("Inactive");
  });

  await sneha.close();
  await arjun.close();
});

test("A recruiter can onboard people but cannot hand out more power than they hold", async ({ page }) => {
  await login(page, NIMBUS.recruiter);
  await step(page, "Pooja adds a new hire; salary fields are not even offered", async () => {
    await page.goto("/employees");
    await page.getByRole("button", { name: "Add employee" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add employee" });
    await expect(dialog.getByText("Compensation")).toHaveCount(0);
    await dialog.locator("#emp-first_name").fill("Kabir");
    await dialog.locator("#emp-last_name").fill("Singh");
    await dialog.locator("#emp-email").fill("kabir.singh@nimbustech.io");
    await dialog.locator("#emp-employee_code").fill("NIM-090");
    await dialog.locator("#emp-position").fill("Frontend Engineer");
    await dialog.getByRole("button", { name: "Add employee" }).click();
    await toast(page, "Employee added");
  });
  await step(page, "When inviting Kabir, only roles within Pooja's own access can be ticked", async () => {
    await page.goto("/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite user" });
    await dialog.getByLabel("Work email").fill("kabir.singh@nimbustech.io");
    await dialog.getByLabel("Employee record").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Kabir");
    await dialog.getByRole("option", { name: /Kabir Singh/ }).click();
    await expect(dialog.getByRole("checkbox", { name: /^Company Administrator/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /^Manager\b/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /^Payroll Manager/ })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /^Employee\b/ }).check();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("dialog", { name: "Invitation ready" })).toBeVisible();
  });
  await step(page, "Trying to grant Company Administrator through the API is refused", async () => {
    const roles = await api<{ id: number; system_key: string }[]>(page, "GET", "/roles");
    const admin = roles.data.find((r) => r.system_key === "company_admin")!;
    const result = await api(page, "POST", "/users/invite", { email: "intruder@nimbustech.io", full_name: "Intruder", role_ids: [admin.id] });
    expect(result.status).toBe(403);
  });
});
