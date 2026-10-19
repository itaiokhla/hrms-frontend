import { NIMBUS, SAFFRON, api, expect, login, openAs, step, test } from "./support/fixtures";

interface Ids {
  divya: number;
  divyaUser: number;
  payroll: number;
  leave: number;
  asset: number;
  role: number;
}

test("Saffron cannot reach Nimbus data, whatever id it tries", async ({ page, browser }, testInfo) => {
  // Collect real Nimbus ids first (as Nimbus's own administrator).
  const ananya = await openAs(browser, testInfo, "Ananya (collects Nimbus ids)", NIMBUS.admin);
  const ids: Ids = await step(ananya.page, "Look up real Nimbus record ids", async () => {
    const employees = await api<{ items: { id: number; full_name: string }[] }>(ananya.page, "GET", "/employees?limit=200");
    const users = await api<{ items: { id: number; email: string }[] }>(ananya.page, "GET", "/users?limit=200");
    const payroll = await api<{ items: { id: number }[] }>(ananya.page, "GET", "/payroll?limit=1"); // newest month
    const leaves = await api<{ items: { id: number; status: string }[] }>(ananya.page, "GET", "/leaves?limit=200");
    const assets = await api<{ items: { id: number }[] }>(ananya.page, "GET", "/assets");
    const roles = await api<{ id: number; system_key: string }[]>(ananya.page, "GET", "/roles");
    return {
      divya: employees.data.items.find((e) => e.full_name === "Divya Menon")!.id,
      divyaUser: users.data.items.find((u) => u.email === NIMBUS.divya)!.id,
      payroll: payroll.data.items[0].id,
      leave: (leaves.data.items.find((l) => l.status === "pending") ?? leaves.data.items[0]).id,
      asset: assets.data.items[0].id,
      role: roles.data.find((r) => r.system_key === "company_admin")!.id,
    };
  });
  await ananya.close();

  await login(page, SAFFRON.admin);
  const probes: [string, string, string, unknown?][] = [
    ["Read a Nimbus employee", "GET", `/employees/${ids.divya}`],
    ["Edit a Nimbus employee", "PUT", `/employees/${ids.divya}`, { position: "Hacked" }],
    ["Read a Nimbus payslip", "GET", `/payroll/${ids.payroll}/slip`],
    ["Download a Nimbus payslip PDF", "GET", `/payroll/${ids.payroll}/slip.pdf`],
    ["Approve a Nimbus leave", "POST", `/leaves/${ids.leave}/approve`, {}],
    ["Open a Nimbus asset", "GET", `/assets/${ids.asset}`],
    ["Read a Nimbus user account", "GET", `/users/${ids.divyaUser}`],
    ["Suspend a Nimbus user", "PUT", `/users/${ids.divyaUser}/status`, { status: "suspended" }],
    ["Open a Nimbus employee photo", "GET", `/employees/${ids.divya}/photo`],
  ];
  for (const [label, method, path, body] of probes) {
    await step(page, `Saffron admin tries to: ${label} → not found`, async () => {
      expect((await api(page, method, path, body)).status, `${method} ${path}`).toBe(404);
    });
  }

  await step(page, "Linking a Saffron login to a Nimbus employee is refused", async () => {
    const result = await api(page, "POST", "/users/invite", {
      email: "spy@saffronfoods.in", full_name: "Spy Account", employee_id: ids.divya, role_ids: [],
    });
    expect(result.status).toBe(404);
  });

  await step(page, "Granting a Nimbus role to a Saffron user is refused", async () => {
    const users = await api<{ items: { id: number; email: string }[] }>(page, "GET", "/users?limit=200");
    const ramesh = users.data.items.find((u) => u.email === SAFFRON.ramesh)!;
    expect((await api(page, "PUT", `/users/${ramesh.id}/roles`, { role_ids: [ids.role] })).status).toBe(404);
  });

  await step(page, "Smuggling a company_id into a new employee is rejected outright", async () => {
    const result = await api<{ code: string }>(page, "POST", "/employees", {
      first_name: "Fake", last_name: "Hire", email: "fake@saffronfoods.in", employee_code: "SAF-999",
      hire_date: "2026-01-01", company_id: 1,
    });
    expect(result.status).toBe(422);
  });

  await step(page, "Saffron's directory and search show only Saffron people", async () => {
    await page.goto("/employees");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.getByText("nimbustech.io")).toHaveCount(0);
    const search = await api<{ total: number; items: { email: string }[] }>(page, "GET", "/employees?q=Menon");
    expect(search.data.items.every((e) => e.email.endsWith("@saffronfoods.in"))).toBeTruthy();
  });

  await step(page, "Both companies have a 'Team Lead' role, with different permissions", async () => {
    await page.goto("/roles");
    await page.getByRole("button", { name: /^Team Lead/ }).click();
    await expect(page.getByRole("button", { name: "View employees: Own and headed departments" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Approve leave: Direct reports" })).toHaveAttribute("aria-pressed", "false");
  });
});
