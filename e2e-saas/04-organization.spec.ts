import { KEYS, api, expect, host, openTenant, secrets, shot, signIn, test, writeEvidence } from "./support";

/** Legal entity, branches, departments and teams, the reporting tree and its guard rails. */
const S = secrets();

for (const key of KEYS) {
  test(`${key}: legal entity, branches, org chart and roles as the administrator sees them`, async ({ browser }, testInfo) => {
    const c = S.companies[key];
    const t = await openTenant(browser, testInfo, `${key}-org-admin`, host(c));
    try {
      await signIn(t.page, c.people.admin.email, S.password);
      await t.page.goto("/settings/organization");
      await expect(t.page.getByRole("heading", { name: "Legal entities & branches" })).toBeVisible();
      await expect(t.page.getByText(c.legal_entity.legal_name).first()).toBeVisible();
      for (const branch of Object.values(c.branches)) await expect(t.page.getByText(branch.name).first()).toBeVisible();
      await shot(t.page, testInfo, `04-${key}-entities-branches`);
      const entities = (await api(t.page, "GET", "/legal-entities")).data;
      expect(entities.map((e: { legal_name: string }) => e.legal_name)).toEqual([c.legal_entity.legal_name]);
      expect(entities[0].base_currency).toBe(c.currency);

      // The chart loads one level at a time: expand down to the employees (three levels of management).
      await t.page.goto("/organization");
      const managers = [c.people.deptmgr ?? c.people.opsmgr, c.people.teamlead].filter(Boolean);
      for (const person of managers) {
        await t.page.getByRole("button", { name: `Expand ${person.name}'s team` }).click();
      }
      await expect(t.page.getByText(c.people.emp1.name).first()).toBeVisible();
      await shot(t.page, testInfo, `04-${key}-org-chart`);
      await t.page.goto("/roles");
      await expect(t.page.getByText("Company Administrator").first()).toBeVisible();
      await shot(t.page, testInfo, `04-${key}-roles`);

      // Guard rails: no reporting cycle, no manager from another company.
      const top = c.people.deptmgr ?? c.people.opsmgr;
      const bottom = c.people.emp1;
      const cycle = await api(t.page, "PUT", `/org/employees/${top.employee_id}/manager`, { manager_id: bottom.employee_id });
      expect([400, 409, 422]).toContain(cycle.status);
      const other = S.companies[KEYS.find((k) => k !== key)!];
      const foreign = await api(t.page, "PUT", `/org/employees/${bottom.employee_id}/manager`, { manager_id: other.people.admin.employee_id });
      expect(foreign.status).toBe(404);
      const chain = (await api(t.page, "GET", `/org/employees/${bottom.employee_id}/chain`)).data;
      writeEvidence(`04-${key}-hierarchy.json`, { cycle: cycle.status, foreign_manager: foreign.status, chain });
    } finally {
      await t.close();
    }
  });
}
