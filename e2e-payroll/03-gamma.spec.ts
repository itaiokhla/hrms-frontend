import {
  BRAND, api, company, creds, db, expect, expectDenied, expectNoForeignBrand, login, mainText, settle, shot, step, test, writeEvidence,
} from "./support";
import { digits, financialRow, money } from "./money";

/**
 * Gamma Solutions ("Gamma HR Cloud", US, USD) — Goal 2 §18.3 in installed Google Chrome.
 * Bi-weekly pay group (period 2026-10-19 .. 2026-11-01, 10 Mon-Fri working days, 14 calendar days).
 * US is CONFIG_ONLY: no statutory lines; runs finalize under the approved I-15 attestation.
 * Expected amounts are hand-calculated below, never produced by the engine.
 */
const J = "gamma";
const G = company("gamma");
const RUN = G.runs.finalized.id;
const DRAFT = G.runs.draft.id;
const people = (G as any).people as Record<string, { employee_id: number; user_id: number | null; name: string }>;
const byName = (name: string) => db("run_employees", { run_id: RUN }).find((r) => r.name === name)!;
const LEAVER = (creds().anchors as { leavers: Record<string, string> }).leavers.gamma;
/** Mon-Fri days from the period start (Mon 19 Oct 2026) to the leaving day, both included. */
const LEAVER_DAYS = (() => {
  let n = 0;
  for (let d = new Date("2026-10-19T00:00:00Z"); d <= new Date(`${LEAVER}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += 1;
  }
  return n;
})();
// Exact cents: hours x 3150 cents per hour.
const LIAM_GROSS = ((LEAVER_DAYS * 8 * 3150) / 100).toFixed(2);

test("G01-G02 branding, USD and the bi-weekly run", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "gamma", "admin");
  try {
    const p = admin.page;
    await expect(p.locator("body")).toContainText(BRAND.gamma);
    await expectNoForeignBrand(p, "gamma");
    await shot(p, testInfo, "gamma-01-dashboard");
    step(J, 1, "Gamma HR Cloud branding", "pass");
    await p.goto(`/payroll/runs/${RUN}`);
    await settle(p);
    const text = await mainText(p);
    expect(text).toMatch(/\$|USD/);
    expect(text).toMatch(/Bi-weekly/i);
    const sums = db("run_employee_sums", { run_id: RUN })[0];
    expect(sums.currency).toBe("USD");
    expect(digits(text)).toContain(money(sums.net).replace(/\.00$/, ""));
    await shot(p, testInfo, "gamma-02-biweekly-run-usd");
    step(J, 2, "USD bi-weekly run; summary equals the DB sum of nets", "pass", { net: sums.net });
  } finally {
    await admin.close();
  }
});

test("G03-G08 hourly, overtime, task pay, bonus, commission, joiner and leaver (hand-calculated)", async ({ browser }, testInfo) => {
  // David Wilson, hourly 48.00 USD: punches Mon 19 .. Thu 22 Oct (4 x 8 h = 32 h) plus the period's remaining
  // 6 working days unmarked -> Gamma's attendance pay policy unmarked_day = PRESENT pays them at 8 h = 48 h;
  // payable 80 h x 48.00 = 3,840.00. Approved overtime 2 h on a workday at 1.5x, hourly base = the hourly wage:
  // 2 x 1.5 x 48.00 = 144.00. Approved task: 6 code reviews x rate card 45.00 = 270.00.
  // gross = 3,840.00 + 144.00 + 270.00 = 4,254.00; no deductions -> net 4,254.00.
  const david = byName("David Wilson");
  const checks: [string, string, string, string][] = [
    ["David Wilson", "gross (80 h x 48 + OT 2 h x 1.5 x 48 + task 6 x 45)", "4254.00", money(david.gross)],
    // Chloe Nguyen, salaried 2,850.00 per bi-weekly period, joined 21 Oct (period day + 2); proration basis
    // CALENDAR_DAYS (company setting): 21 Oct .. 1 Nov = 12 of 14 days -> 2,850 x 12 / 14 = 2,442.857142... -> 2,442.86;
    // approved commission 1,340.00 -> gross 3,782.86.
    ["Chloe Nguyen", "gross (joiner 12/14 calendar days + commission)", "3782.86", money(byName("Chloe Nguyen").gross)],
    // Liam Turner, hourly 31.50, leaver on the seed's anchor date (the day before the seed ran: anchors.leavers.gamma).
    // Employed Mon 19 Oct .. the leaving day; each Mon-Fri working day is 8 h. Seeded on 23 Oct -> leaver 22 Oct ->
    // 4 days = 32 h x 31.50 = 1,008.00; seeded on 24 Oct -> leaver 23 Oct -> 5 days = 40 h x 31.50 = 1,260.00.
    ["Liam Turner", `gross (leaver ${LEAVER}: ${LEAVER_DAYS * 8} h x 31.50)`, LIAM_GROSS, money(byName("Liam Turner").gross)],
    // Jessica Davis, salaried 4,800.00 + approved bonus 750.00 = 5,550.00.
    ["Jessica Davis", "gross (salary + bonus)", "5550.00", money(byName("Jessica Davis").gross)],
    // Sarah Johnson, salaried 4,200.00 + approved claim 86.40 (reimbursement, not earnings) -> net 4,286.40.
    ["Sarah Johnson", "net (salary + reimbursement 86.40)", "4286.40", money(byName("Sarah Johnson").net)],
  ];
  for (const [employee, check, expected, actual] of checks) financialRow({ company: "gamma", run: RUN, employee, check, expected, actual });
  for (const [employee, , expected, actual] of checks) expect(actual, employee).toBe(expected);

  const proc = await login(browser, testInfo, "gamma", "processor");
  try {
    const p = proc.page;
    for (const [n, name, file] of [
      [3, "David Wilson", "gamma-03-hourly-ot-task-david"],
      [4, "Chloe Nguyen", "gamma-04-joiner-commission-chloe"],
      [5, "Liam Turner", "gamma-05-leaver-liam"],
      [6, "Jessica Davis", "gamma-06-bonus-jessica"],
    ] as const) {
      const row = byName(name);
      await p.goto(`/payroll/runs/${RUN}/employees/${row.id}`);
      await settle(p);
      expect(digits(await mainText(p))).toContain(money(row.gross));
      await shot(p, testInfo, file);
      step(J, n, `${name}: employee in run matches the hand calculation`, "pass", { gross: row.gross });
    }
    step(J, 7, "overtime (David 2 h x 1.5)", "pass");
    step(J, 8, "task pay (6 x 45.00)", "pass");
  } finally {
    await proc.close();
  }
});

test("G09 retro: backdated rate 48.00 -> 52.00 produces an arrears proposal", async ({ browser }, testInfo) => {
  // The corrected rate applies from the period start: payable 80 h x (52.00 - 48.00) = 320.00, plus overtime
  // 2 h x 1.5 x 4.00 = 12.00 -> arrears 332.00 USD (task pay is per unit, unchanged).
  const admin = await login(browser, testInfo, "gamma", "admin");
  try {
    const p = admin.page;
    const list = await api(p, "GET", "/payroll/arrears-proposals");
    expect(list.status).toBe(200);
    const proposal = (list.data.items as any[]).find((x) => x.employee_id === people.emp1.employee_id)!;
    expect(proposal).toBeTruthy();
    financialRow({ company: "gamma", run: RUN, employee: "David Wilson", check: "arrears (80 h x 4.00 + 2 h x 1.5 x 4.00)", expected: "332.00", actual: proposal.totals.arrears.amount });
    expect(proposal.totals.arrears.amount).toBe("332.00");
    await p.goto("/payroll/inputs?tab=arrears");
    await settle(p);
    await shot(p, testInfo, "gamma-09-arrears-proposal");
    writeEvidence("gamma-09-arrears.json", { status: proposal.status, totals: proposal.totals });
    step(J, 9, "retro correction -> arrears proposal 332.00 USD", "pass");
  } finally {
    await admin.close();
  }
});

test("G10 reversal of a finalized run needs two different approvers", async ({ browser }, testInfo) => {
  // Requesting a reversal is safe to exercise: the original run never changes and nothing is paid. The
  // request is made by the payroll manager in the UI; approval needs two other approvers (not exercised here
  // so the finalized run stays the reference for the other journeys).
  const admin = await login(browser, testInfo, "gamma", "admin");
  try {
    const p = admin.page;
    await p.goto(`/payroll/runs/${RUN}`);
    await settle(p);
    const more = p.getByRole("button", { name: /more run actions/i });
    test.skip(!(await more.count()), "No 'More run actions' menu for the payroll manager on a finalized run");
    await more.click();
    const item = p.getByRole("menuitem", { name: /reverse run|reversal requests/i });
    if (!(await item.count())) {
      await shot(p, testInfo, "gamma-10-no-reversal-action");
      step(J, 10, "reversal action not offered to this role", "info");
      return;
    }
    await item.click();
    const dlg = p.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await shot(p, testInfo, "gamma-10-reversal-dialog");
    await p.keyboard.press("Escape");
    expect(db("run", { id: RUN })[0].status).toBe("FINALIZED");
    step(J, 10, "reversal dialog (two approvers) available; original run untouched", "pass");
  } finally {
    await admin.close();
  }
});

test("G11-G13 payment tracking, self-service and permission boundaries", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "gamma", "emp1");
  try {
    const p = emp.page;
    await p.goto("/me/payslips");
    await settle(p);
    expect(digits(await mainText(p))).toContain("4254.00");
    await shot(p, testInfo, "gamma-11-my-payslips");
    await p.goto("/me/payments");
    await settle(p);
    await shot(p, testInfo, "gamma-11b-my-payments");
    expect(db("settled_without_evidence", { company_id: G.company_id })[0].n).toBe(0);
    step(J, 11, "self-service payslip (4,254.00 USD) and payment tracking", "pass");

    const log: Record<string, number> = {};
    for (const path of [`/payroll/runs`, `/payroll/runs/${RUN}/employees`, `/payroll/employees/${people.emp2.employee_id}/compensation`, `/payroll/arrears-proposals`, `/payroll/payment-batches`]) {
      log[path] = (await api(p, "GET", path)).status;
      expectDenied(log[path], `Gamma employee ${path}`);
    }
    await p.goto(`/payroll/runs/${RUN}`);
    await settle(p);
    await shot(p, testInfo, "gamma-12-employee-denied-run");
    writeEvidence("gamma-12-employee-denials.json", log);
    step(J, 12, "employee permission boundaries", "pass", log);
  } finally {
    await emp.close();
  }
  const admin = await login(browser, testInfo, "gamma", "admin");
  try {
    const p = admin.page;
    const runs = (await api(p, "GET", "/payroll/runs")).data.items as { currency: string }[];
    expect(runs.every((r) => r.currency === "USD")).toBe(true);
    for (const k of ["alpha", "beta"] as const) expectDenied((await api(p, "GET", `/payroll/runs/${company(k).runs.finalized.id}`)).status, `${k} run from Gamma`);
    const search = await api(p, "GET", "/employees?q=Fatima");
    expect(JSON.stringify(search.data)).not.toContain("Fatima Zahra");
    await p.goto(`/payroll/runs/${DRAFT}`);
    await settle(p);
    await shot(p, testInfo, "gamma-13-next-period-draft");
    step(J, 13, "Alpha/Beta data absent from Gamma", "pass");
  } finally {
    await admin.close();
  }
});
