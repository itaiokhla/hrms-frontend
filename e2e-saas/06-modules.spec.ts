import { KEYS, api, evidencePath, expect, host, inspectPdf, openTenant, secrets, shot, signIn, test, toast, writeEvidence } from "./support";

/**
 * The existing HRMS modules for each company's own employees: attendance with lunch, leave and
 * approval, payslips in the company currency, regional holidays and assigned assets.
 */
const S = secrets();
const CURRENCY: Record<string, RegExp> = { INR: /₹/, AED: /AED/, USD: /\$/ };
const ASSET = { alpha: "ThinkPad T14", beta: "Delivery van (Toyota Hiace)", gamma: "MacBook Pro 14" };
const HOLIDAY = { alpha: "Diwali", beta: "UAE National Day", gamma: "Thanksgiving Day" };

for (const key of KEYS) {
  test(`${key}: an employee's attendance, leave, holidays, assets and payslips`, async ({ browser }, testInfo) => {
    const c = S.companies[key];
    const t = await openTenant(browser, testInfo, `${key}-employee-modules`, host(c));
    const evidence: Record<string, unknown> = {};
    try {
      await signIn(t.page, c.people.emp1.email, S.password);
      const history = (await api(t.page, "GET", "/attendance/me/history")).data;
      expect(history.total).toBeGreaterThanOrEqual(5); // the seeded week, with lunch breaks
      evidence.attendance = history.items;
      await t.page.goto("/attendance");
      await expect(t.page.getByRole("heading", { name: "Attendance" }).first()).toBeVisible();
      await shot(t.page, testInfo, `06-${key}-attendance`);

      await t.page.goto("/leaves");
      await expect(t.page.getByText(/Casual Leave|Sick Leave/).first()).toBeVisible();
      await shot(t.page, testInfo, `06-${key}-leave`);
      const mine = (await api(t.page, "GET", "/leaves/my")).data as { id: number; status: string }[];
      evidence.leave = mine.map((l) => ({ id: l.id, status: l.status }));

      await t.page.goto("/holidays");
      await expect(t.page.getByText(HOLIDAY[key]).first()).toBeVisible();
      await t.page.goto("/assets");
      await expect(t.page.getByText(ASSET[key]).first()).toBeVisible();
      await shot(t.page, testInfo, `06-${key}-assets`);

      await t.page.goto("/payslips");
      if (c.payroll.emp1.status === "approved") {
        await t.page.getByRole("button").filter({ hasText: /Gross/ }).first().click();
        const [download] = await Promise.all([
          t.page.waitForEvent("download"),
          t.page.getByRole("button", { name: /Download PDF/i }).click(),
        ]);
        const file = evidencePath(`06-${key}-payslip.pdf`);
        await download.saveAs(file);
        const pdf = inspectPdf(file, evidencePath(`06-${key}-payslip-page1.png`));
        expect(pdf.text).toMatch(CURRENCY[c.currency]);
        expect(pdf.text).toContain(c.legal_entity.legal_name);
        for (const other of KEYS.filter((k) => k !== key)) expect(pdf.text).not.toContain(S.companies[other].legal_entity.legal_name);
        expect(pdf.has_black_square).toBe(false);
        evidence.payslip = { sha256: pdf.sha256, fonts: pdf.fonts };
        await shot(t.page, testInfo, `06-${key}-payslip`);
      } else {
        // Gamma's payroll is a draft (no second payroll user to approve it): nothing is published to employees.
        const published = (await api(t.page, "GET", "/payroll/my")).data;
        expect(Array.isArray(published) ? published : published.items).toEqual([]);
        await shot(t.page, testInfo, `06-${key}-no-published-payslip`);
        evidence.payslip = "none published (draft payroll)";
      }
      writeEvidence(`06-${key}-modules.json`, evidence);
      expect(t.errors).toEqual([]);
    } finally {
      await t.close();
    }
  });
}

test("Alpha: the team lead approves a pending leave request in the browser", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const lead = await openTenant(browser, testInfo, "alpha-team-lead-approval", host(A));
  try {
    await signIn(lead.page, A.people.teamlead.email, S.password);
    await lead.page.goto("/leaves?tab=approvals");
    const card = lead.page.getByRole("article", { name: new RegExp(`^Leave request from ${A.people.emp1.name}`) })
      .filter({ hasText: "Family function" });
    await expect(card).toBeVisible();
    await shot(lead.page, testInfo, "06-alpha-team-lead-approvals");
    await card.getByPlaceholder("Remarks (optional)").fill("Enjoy the function");
    await card.getByRole("button", { name: "Approve" }).click();
    await toast(lead.page, "Approved");
    // A request from someone outside the team lead's direct reports cannot be approved.
    expect((await api(lead.page, "POST", `/leaves/${S.companies.beta.pending_leave_id}/approve`, { remarks: "x" })).status).toBe(404);
  } finally {
    await lead.close();
  }
});

test("Regional holidays follow the employee's branch", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const blr = await openTenant(browser, testInfo, "alpha-bengaluru-holidays", host(A));
  const del = await openTenant(browser, testInfo, "alpha-delhi-holidays", host(A));
  try {
    await signIn(blr.page, A.people.emp1.email, S.password); // Bengaluru
    await signIn(del.page, A.people.emp3.email, S.password); // Delhi
    const names = async (page: typeof blr.page) =>
      ((await api(page, "GET", "/holidays?year=2026&mine=true")).data as { name: string }[]).map((h) => h.name);
    expect(await names(blr.page)).toContain("Karnataka Rajyotsava");
    expect(await names(del.page)).not.toContain("Karnataka Rajyotsava");
    expect(await names(del.page)).toContain("Diwali");
  } finally {
    await blr.close();
    await del.close();
  }
});
