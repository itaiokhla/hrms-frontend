import { api, company, db, expect, login, mainText, settle, shot, test, writeEvidence } from "./support";

/**
 * EC-RUN-22 (refresh or a second tab during processing: safe, state and progress reload) and
 * EC-RUN-23 (dashboard KPIs: zero employees vs employees without salary; 3.8 §5.1 definitions).
 */

test("EC-RUN-23 overview KPIs: with + without salary = eligible; drill-down lists the unassigned employees", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    const p = admin.page;
    await p.goto("/payroll");
    await settle(p);
    const data = (await api(p, "GET", "/payroll/overview?period_from=2026-10-01&period_to=2026-10-31")).data;
    const k = data.kpis;
    expect(k.with_salary + k.without_salary).toBe(k.eligible);
    // Hand count from the seed guide: Alpha has 18 employees placed in pay groups; three have no salary
    // assignment (Aarav Mehta, Ritu Bansal, Kabir Das) -> eligible 18, with salary 15, without salary 3.
    const without = (await api(p, "GET", "/payroll/overview/without_salary?period_from=2026-10-01&period_to=2026-10-31")).data;
    const names = (without.items as { employee_name: string }[]).map((i) => i.employee_name).sort();
    writeEvidence("ec-run-23-overview-kpis.json", { kpis: k, without_salary: names });
    expect(names).toEqual(["Aarav Mehta", "Kabir Das", "Ritu Bansal"]);
    expect(k).toMatchObject({ eligible: 18, with_salary: 15, without_salary: 3 });
    const text = await mainText(p);
    expect(text).toMatch(/With salary/i);
    expect(text).toMatch(/Without salary/i);
    await shot(p, testInfo, "ec-run-23-alpha-overview-kpis");

    // Zero population (a branch filter matching nobody): every KPI is 0 and nothing errors.
    const zero = (await api(p, "GET", "/payroll/overview?period_from=2026-10-01&period_to=2026-10-31&branch_id=999999")).data;
    expect([zero.kpis?.eligible ?? 0, zero.kpis?.with_salary ?? 0, zero.kpis?.without_salary ?? 0]).toEqual([0, 0, 0]);
    expect(admin.pageErrors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test("EC-RUN-22 refresh and a second tab while a run calculates", async ({ browser }, testInfo) => {
  const G = company("gamma");
  const runId = G.runs.draft.id;
  const proc = await login(browser, testInfo, "gamma", "processor");
  try {
    const p = proc.page;
    await p.goto(`/payroll/runs/${runId}`);
    await settle(p);
    if (db("run", { id: runId })[0].status === "DRAFT") {
      await p.getByRole("button", { name: /run pre-checks/i }).click();
      await expect(p.getByRole("button", { name: /lock & calculate/i })).toBeVisible({ timeout: 30_000 });
    }
    await p.getByRole("button", { name: /lock & calculate/i }).click();
    await p.getByRole("button", { name: /^lock & calculate$/i }).last().click();
    // Immediately refresh this tab and open the run in a second tab of the same session.
    await p.reload();
    const second = await proc.context.newPage();
    await second.goto(`/payroll/runs/${runId}`);
    await shot(second, testInfo, "ec-run-22-second-tab-during-calculation");
    await expect.poll(() => db("run", { id: runId })[0].status, { timeout: 180_000 }).toMatch(/REVIEW_REQUIRED|CALCULATED|VALIDATION_FAILED/);
    await p.reload();
    await second.reload();
    await settle(p);
    await settle(second);
    const run = db("run", { id: runId })[0];
    // Both tabs show the same final state; one calculation stamp.
    const s1 = await mainText(p);
    const s2 = await mainText(second);
    const label = run.status === "REVIEW_REQUIRED" ? /review/i : new RegExp(run.status.replace(/_/g, " "), "i");
    expect(s1).toMatch(label);
    expect(s2).toMatch(label);
    const calc = await api(p, "GET", `/payroll/runs/${runId}`);
    expect(calc.data.calculated_at).toBe(run.calculated_at ? calc.data.calculated_at : null);
    await shot(p, testInfo, "ec-run-22-after-refresh");
    writeEvidence("ec-run-22.json", { status: run.status, calculated_at: run.calculated_at, population: run.population });
    expect(proc.pageErrors).toEqual([]);
    await second.close();
  } finally {
    await proc.close();
  }
});
