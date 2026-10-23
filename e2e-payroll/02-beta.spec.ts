import {
  BRAND, api, company, db, stepUpApi, expect, expectDenied, expectNoForeignBrand, expectNoUnmaskedBankData, login, mainText, settle,
  shot, step, test, writeEvidence,
} from "./support";
import { digits, financialRow, money } from "./money";

/**
 * Beta Logistics ("Beta Workforce", AE, AED) — Goal 2 §18.2 in installed Google Chrome.
 * AE is CONFIG_ONLY: runs carry no statutory lines and finalize only under the approved I-15 attestation.
 * Expected amounts are hand-calculated below (never produced by the engine).
 */
const J = "beta";
const B = company("beta");
const OCT = B.runs.finalized.id;
const NOV = B.runs.draft.id;
const people = (B as any).people as Record<string, { employee_id: number; user_id: number | null; name: string }>;

test("B01-B03 branding, AED amounts and the October run", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "beta", "admin");
  try {
    const p = admin.page;
    await expect(p.locator("body")).toContainText(BRAND.beta);
    await expectNoForeignBrand(p, "beta");
    await shot(p, testInfo, "beta-01-dashboard");
    step(J, 1, "Beta Workforce branding", "pass");

    await p.goto(`/payroll/runs/${OCT}`);
    await settle(p);
    const text = await mainText(p);
    expect(text).toMatch(/AED|د\.إ/);
    // Run net total = sum of the employees' nets (DB)
    const sums = db("run_employee_sums", { run_id: OCT })[0];
    expect(sums.currency).toBe("AED");
    expect(sums.currency_max).toBe("AED");
    expect(digits(text)).toContain(money(sums.net).replace(/\.00$/, ""));
    await shot(p, testInfo, "beta-02-october-run-aed");
    step(J, 2, "AED run summary equals the DB sum of nets", "pass", { net: sums.net, calculated: sums.calculated, excluded: sums.excluded });

    // B03 allowances / overtime: Ravi Menon (fleet structure 9,500 AED + trip pay 1,250 + approved OT 2 h on a workday)
    // BASIC 5,500 + HOUSING 3,200 + FOOD 800 = 9,500.00; trip pay 1,250.00 (approved wage input);
    // OT hourly base = BASIC / calendar days (31) / 8 h = 5,500 / 248 = 22.1774193...; x 2 h x 1.25 = 55.4435... -> 55.44
    // gross = 9,500.00 + 1,250.00 + 55.44 = 10,805.44 AED; no deductions (CONFIG_ONLY) -> net 10,805.44.
    const ravi = db("run_employees", { run_id: OCT }).find((r) => r.name === "Ravi Menon")!;
    financialRow({ company: "beta", run: OCT, employee: "Ravi Menon", check: "gross (allowances + trip pay + OT 1.25x)", expected: "10805.44", actual: money(ravi.gross) });
    expect(money(ravi.gross)).toBe("10805.44");
    expect(money(ravi.net)).toBe("10805.44");
    await p.goto(`/payroll/runs/${OCT}/employees/${ravi.id}`);
    await settle(p);
    expect(digits(await mainText(p))).toContain("10805.44");
    await shot(p, testInfo, "beta-03-allowances-overtime-ravi");
    step(J, 3, "allowances, trip pay and overtime (hand-calculated)", "pass");
    expect(admin.pageErrors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test("B04-B05 reimbursement and loan recovery on the payslip (Fatima Zahra)", async ({ browser }, testInfo) => {
  // Loan 6,000.00 AED over a tenure of 6 -> 1,000.00 per run; approved claim 320.00 AED (reimbursement, not gross).
  // Gross = BASIC 6,500 + HOUSING 3,700 + FOOD 800 = 11,000.00; net = 11,000.00 - 1,000.00 + 320.00 = 10,320.00 AED.
  const fatima = db("run_employees", { run_id: OCT }).find((r) => r.name === "Fatima Zahra")!;
  financialRow({ company: "beta", run: OCT, employee: "Fatima Zahra", check: "gross", expected: "11000.00", actual: money(fatima.gross) });
  financialRow({ company: "beta", run: OCT, employee: "Fatima Zahra", check: "net = gross - loan 1,000 + claim 320", expected: "10320.00", actual: money(fatima.net) });
  expect(money(fatima.gross)).toBe("11000.00");
  expect(money(fatima.deductions)).toBe("1000.00");
  expect(money(fatima.reimbursements)).toBe("320.00");
  expect(money(fatima.net)).toBe("10320.00");
  const lines = db("lines", { run_id: OCT, employee_id: people.emp2.employee_id });
  expect(lines.find((l) => l.component_code === "LOAN_RECOVERY")?.amount).toBe("1000.0000");
  expect(lines.find((l) => l.kind === "REIMBURSEMENT")?.amount).toBe("320.0000");

  const emp = await login(browser, testInfo, "beta", "emp2");
  try {
    const p = emp.page;
    await p.goto("/me/payslips");
    await settle(p);
    const slips = (await api(p, "GET", "/me/payroll/payslips")).data.items as { id: number; run_id: number; labels: string[] }[];
    const oct = slips.find((s) => s.run_id === OCT)!;
    expect(oct.labels.join(" ")).toMatch(/Statutory deductions not calculated/);
    await p.goto(`/me/payslips/${oct.id}`);
    await settle(p);
    const text = digits(await mainText(p));
    expect(text).toContain("10320.00");
    expect(text).toContain("1000.00");
    expect(text).toContain("320.00");
    expect(text).toMatch(/Statutory deductions not calculated/);
    await shot(p, testInfo, "beta-04-payslip-loan-reimbursement", { fullPage: true });
    step(J, 4, "payslip shows the loan recovery and the reimbursement", "pass");

    await p.goto("/me/loans");
    await settle(p);
    expect(digits(await mainText(p))).toContain("5000.00"); // 6,000 - 1,000 recovered
    await shot(p, testInfo, "beta-05-my-loans-balance");
    step(J, 5, "loan balance 5,000.00 AED after one instalment", "pass");
  } finally {
    await emp.close();
  }
});

test("B06-B07 bank validation, pending change and cooling-off", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "beta", "emp2");
  try {
    const p = emp.page;
    await p.goto("/me/bank-accounts");
    await settle(p);
    await expectNoUnmaskedBankData(p);
    const mine = (await api(p, "GET", "/me/payroll/bank-accounts")).data;
    const items = (mine.items ?? mine) as { status: string; verification_status: string }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((a) => /PENDING/.test(a.status))).toBe(true);
    await shot(p, testInfo, "beta-06-my-bank-pending-change");
    // Format validation: an invalid IBAN checksum is refused by the API (never stored). Bank changes need a
    // fresh step-up first (without it the API answers 403 before looking at the details).
    const before = db("bank_accounts_of_employee", { employee_id: people.emp2.employee_id }).length;
    const body = { holder_name: "Fatima Zahra", country: "AE", currency: "AED", iban: "AE070331234567890123457", bank_name: "Test Bank (fictitious)" };
    const noStepUp = await api(p, "POST", "/me/payroll/bank-accounts", body);
    expect(noStepUp.status).toBe(403);
    await stepUpApi(p, "beta", "emp2");
    const bad = await api(p, "POST", "/me/payroll/bank-accounts", body);
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.data)).toMatch(/IBAN|iban|checksum/);
    expect(db("bank_accounts_of_employee", { employee_id: people.emp2.employee_id }).length).toBe(before);
    writeEvidence("beta-06-invalid-iban.json", { without_step_up: { status: noStepUp.status, code: (noStepUp.data as any)?.code }, with_step_up: { status: bad.status, code: (bad.data as any)?.code } });
    step(J, 6, "pending bank change visible to the employee; invalid IBAN refused after step-up (422)", "pass", { invalid_iban_status: bad.status, code: (bad.data as any)?.code });
  } finally {
    await emp.close();
  }
  const fin = await login(browser, testInfo, "beta", "finance");
  try {
    const p = fin.page;
    await p.goto("/payroll/bank-details");
    await settle(p);
    await expectNoUnmaskedBankData(p);
    await shot(p, testInfo, "beta-07-finance-bank-changes");
    const changes = db("bank_changes_of_employee", { employee_id: people.emp2.employee_id });
    expect(changes.some((c) => /PENDING|COOLING/.test(c.status))).toBe(true);
    step(J, 7, "finance sees the pending change (masked)", "pass", { changes: changes.map((c) => c.status) });
  } finally {
    await fin.close();
  }
});

test("B08-B09 attestation gate and approval hierarchy on the November draft", async ({ browser }, testInfo) => {
  const proc = await login(browser, testInfo, "beta", "processor");
  try {
    const p = proc.page;
    await p.goto(`/payroll/runs/${NOV}`);
    await settle(p);
    await shot(p, testInfo, "beta-08-november-draft");
    const fin = await api(p, "GET", `/payroll/runs/${NOV}/finalization`);
    expect(fin.status).toBe(200);
    writeEvidence("beta-08-finalization-status.json", fin.data);
    // AE is not verified: the statutory state must say so (attestation in force), never "verified".
    expect(JSON.stringify(fin.data)).not.toMatch(/"verified":\s*true/);
    step(J, 8, "statutory state of the AE run: not verified, attestation-gated", "pass", { statutory: (fin.data as any)?.statutory ?? null });
  } finally {
    await proc.close();
  }
  // Attestations: only the maker/checker accounts may read them; the processor is refused.
  const procApi = await login(browser, testInfo, "beta", "processor", { label: "processor-attest" });
  try {
    const s = (await api(procApi.page, "GET", "/payroll/statutory-attestations")).status;
    expectDenied(s, "processor reading attestations");
    step(J, 9, "attestation register restricted to maker/checker", "pass", { processor_status: s });
  } finally {
    await procApi.close();
  }
});

test("B10 manager without compensation visibility", async ({ browser }, testInfo) => {
  const mgr = await login(browser, testInfo, "beta", "deptmgr");
  const log: Record<string, number> = {};
  try {
    const p = mgr.page;
    await p.goto("/payroll/compensation");
    await settle(p);
    await shot(p, testInfo, "beta-10-manager-compensation-denied");
    for (const [label, path] of [
      ["team member compensation", `/payroll/employees/${people.teamlead.employee_id}/compensation`],
      ["run employees", `/payroll/runs/${OCT}/employees`],
      ["run", `/payroll/runs/${OCT}`],
    ] as const) {
      log[label] = (await api(p, "GET", path)).status;
      expectDenied(log[label], `manager ${label}`);
    }
    // The compensation list answers with the manager's own row only (SELF scope), never the team's.
    const list = await api(p, "GET", "/payroll/compensation");
    log["compensation list (own rows only)"] = list.status;
    if (list.status === 200) expect((list.data.items as { employee: { id: number } }[]).every((i) => i.employee.id === people.deptmgr.employee_id)).toBe(true);
    expect(await mainText(p)).not.toMatch(/12,?000\.00/); // Aisha's salary never rendered
    writeEvidence("beta-10-manager-denials.json", log);
    step(J, 10, "department manager cannot see others' compensation", "pass", log);
  } finally {
    await mgr.close();
  }
});

test("B11-B13 payment statuses, payslips list, reports and Alpha data absent", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "beta", "emp1");
  try {
    await emp.page.goto("/me/payments");
    await settle(emp.page);
    await shot(emp.page, testInfo, "beta-11-my-payments");
    // No batch exists for Beta: nothing may claim to be paid.
    expect(db("settled_without_evidence", { company_id: B.company_id })[0].n).toBe(0);
    expect(await mainText(emp.page)).not.toMatch(/\bSettled\b|\bPaid\b(?! by)/);
    step(J, 11, "payment status: nothing shown as settled without evidence", "pass");
  } finally {
    await emp.close();
  }
  const admin = await login(browser, testInfo, "beta", "admin");
  try {
    const p = admin.page;
    await p.goto("/payroll/payslips");
    await settle(p);
    await shot(p, testInfo, "beta-12-payslips");
    await p.goto("/payroll/reports");
    await settle(p);
    await shot(p, testInfo, "beta-12b-reports");
    step(J, 12, "payslips and reports pages", "pass");

    // B13 Alpha data absent: search, run ids, report previews
    const alpha = company("alpha");
    const search = await api(p, "GET", `/employees?q=Rohan`);
    expect(JSON.stringify(search.data)).not.toContain("Rohan Gupta");
    const runs = await api(p, "GET", "/payroll/runs");
    expect((runs.data.items as { currency: string }[]).every((r) => r.currency === "AED")).toBe(true);
    expectDenied((await api(p, "GET", `/payroll/runs/${alpha.runs.finalized.id}`)).status, "Alpha run from Beta");
    await p.goto(`/payroll/runs/${alpha.runs.finalized.id}`);
    await settle(p);
    expect(await mainText(p)).not.toContain("Alpha");
    await shot(p, testInfo, "beta-13-alpha-run-url-denied");
    step(J, 13, "Alpha data absent from Beta (search, runs, direct URL)", "pass");
  } finally {
    await admin.close();
  }
});
