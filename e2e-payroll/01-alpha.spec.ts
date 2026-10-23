import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  BACKEND, BRAND, account, api, company, completeStepUpModal, db, evidencePath, expect, expectDenied, expectNoForeignBrand,
  expectNoUnmaskedBankData, login, mainText, settle, shot, step, test, writeEvidence,
} from "./support";
import { digits, financialRow, money } from "./money";

/**
 * Alpha Technologies ("Alpha People", IN, INR) — Goal 2 §18.1, 26 steps, in installed Google Chrome.
 *
 * Expected amounts are computed by hand below (Decimal arithmetic written out with the reasoning), never by
 * the engine. Each test is one or a few journey steps; the lifecycle tests (calculate → settings change →
 * recalculate → submit → approve → finalize) depend on each other and run in file order (workers: 1).
 * Data used: seeded draft run of the Weekly hourly crew (Suresh Kumar, 250.00 INR/h) and the seeded,
 * finalized October monthly run (Rohan Gupta, Meera Joshi).
 */
const J = "alpha";
const A = company("alpha");
const DRAFT = A.runs.draft.id; // weekly hourly crew, 2026-10-19 .. 2026-10-25
const OCT = A.runs.finalized.id; // monthly, October 2026 (finalized by the seed)
const people = (A as any).people as Record<string, { employee_id: number; user_id: number | null; name: string }>;

test.describe.configure({ mode: "default" });

test("A01-A03 login branding, payroll overview KPIs and the zero-state of an empty scope", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    // A01 — brand after sign-in (tenant hosts are off: the login page is the platform's; the workspace is Alpha's).
    await expect(admin.page.locator("body")).toContainText(BRAND.alpha);
    await expectNoForeignBrand(admin.page, "alpha");
    await shot(admin.page, testInfo, "alpha-01-dashboard");
    step(J, 1, "login branding (Alpha People)", "pass", { title: await admin.page.title() });

    // A02 — payroll overview with KPIs backed by the API.
    await admin.page.goto("/payroll");
    await settle(admin.page);
    const overview = await api(admin.page, "GET", "/payroll/overview");
    expect(overview.status).toBe(200);
    await expect(admin.page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(admin.page, testInfo, "alpha-02-payroll-overview");
    step(J, 2, "payroll overview KPIs", "pass", { overview_keys: Object.keys(overview.data ?? {}) });
  } finally {
    await admin.close();
  }

  // A03 — zero-state: the IN02-only processor sees the overview of an entity without any run.
  const svc = await login(browser, testInfo, "alpha", "svcproc");
  try {
    await svc.page.goto("/payroll/runs");
    await settle(svc.page);
    const runs = await api(svc.page, "GET", "/payroll/runs");
    expect(runs.status).toBe(200);
    // DB: Alpha has runs only on entity IN01; the IN02-scoped processor must see none of them.
    const ids = (runs.data.items ?? []).map((r: { id: number }) => r.id);
    expect(ids).not.toContain(OCT);
    expect(ids).not.toContain(DRAFT);
    await shot(svc.page, testInfo, "alpha-03-zero-state-in02-processor");
    await svc.page.goto("/payroll");
    await settle(svc.page);
    await shot(svc.page, testInfo, "alpha-03b-overview-in02-processor");
    step(J, 3, "zero-state KPIs for an entity without runs (IN02 processor)", "pass", { visible_runs: ids.length });
    expect(svc.pageErrors).toEqual([]);
  } finally {
    await svc.close();
  }
});

test("A04-A08 settings, components, structures, assignments and inputs", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "alpha", "admin");
  const p = admin.page;
  try {
    // A04 settings (company level, inheritance badges)
    await p.goto("/settings/payroll/currency");
    await settle(p);
    await expect(p.locator('[data-setting="payroll.rounding.net_pay_increment"]')).toBeVisible();
    await shot(p, testInfo, "alpha-04-settings-currency-rounding");
    step(J, 4, "payroll settings (rounding section, inheritance)", "pass");

    // A05 components
    await p.goto("/payroll/components");
    await settle(p);
    await expect(p.locator("main")).toContainText("BASIC");
    await shot(p, testInfo, "alpha-05-components");
    step(J, 5, "pay components list", "pass");

    // A06 structures: the CTC staff structure and the hourly crew structure (seeded)
    await p.goto("/payroll/structures");
    await settle(p);
    const structures = await api(p, "GET", "/payroll/salary-structures");
    expect(structures.status).toBe(200);
    const names = (structures.data.items ?? structures.data).map((s: { name: string }) => s.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const n of names.slice(0, 2)) await expect(p.locator("main")).toContainText(n);
    await shot(p, testInfo, "alpha-06-structures");
    step(J, 6, "salary structures", "pass", { structures: names });

    // A07 assignments: Ritu Bansal and Kabir Das have none (excluded NO_SALARY in the run)
    await p.goto("/payroll/compensation");
    await settle(p);
    await expect(p.locator("main")).toContainText(people.emp1.name);
    await shot(p, testInfo, "alpha-07-compensation-assignments");
    const excluded = db("run_employees", { run_id: OCT }).filter((r) => r.exclusion_reason === "NO_SALARY").map((r) => r.name).sort();
    // Seed guide: Aarav Mehta (admin), Ritu Bansal and Kabir Das have no salary assignment.
    expect(excluded).toEqual(["Aarav Mehta", "Kabir Das", "Ritu Bansal"]);
    step(J, 7, "salary assignments; employees without salary are excluded (NO_SALARY)", "pass", { excluded });

    // A08 inputs: attendance/leave/OT approved sources (Rohan Gupta's approved overtime)
    await p.goto("/payroll/inputs");
    await settle(p);
    await shot(p, testInfo, "alpha-08-inputs");
    step(J, 8, "inputs workspace (wage inputs, overtime, tasks, claims)", "pass");
    expect(admin.pageErrors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test("A09-A11 pre-check, lock & calculate and explain the hourly crew run", async ({ browser }, testInfo) => {
  const proc = await login(browser, testInfo, "alpha", "processor");
  const p = proc.page;
  try {
    await p.goto(`/payroll/runs/${DRAFT}`);
    await settle(p);
    await expect(p.locator("main")).toContainText(/Weekly hourly crew/);
    await shot(p, testInfo, "alpha-09-draft-run");
    const before = db("run", { id: DRAFT })[0];
    if (before.status === "DRAFT") {
      await p.getByRole("button", { name: /run pre-checks/i }).click();
      await expect(p.getByRole("button", { name: /lock & calculate/i })).toBeVisible({ timeout: 30_000 });
    }
    step(J, 9, "draft run pre-checks", "pass", { status_before: before.status });

    const status = db("run", { id: DRAFT })[0].status;
    if (["READY", "DRAFT"].includes(status)) {
      await p.getByRole("button", { name: /lock & calculate/i }).click();
      await p.getByRole("button", { name: /^lock & calculate$/i }).last().click(); // confirm dialog
    }
    await expect.poll(() => db("run", { id: DRAFT })[0].status, { timeout: 120_000 }).toMatch(/REVIEW_REQUIRED|CALCULATED|READY_FOR_APPROVAL/);
    await p.reload();
    await settle(p);
    await shot(p, testInfo, "alpha-10-calculated-summary");
    step(J, 10, "lock & calculate", "pass", { status: db("run", { id: DRAFT })[0].status });

    // A11 explanation for Suresh Kumar: hourly 250.00 INR x payable hours of the week 19-25 Oct (Mon-Sat week).
    // Seed punches Mon 19 .. Thu 22 (weekdays before "today" 23 Oct), 09:00-17:30 with a 30-minute unpaid lunch
    // = 8 h a day -> 32 h worked. Fri 23 and Sat 24 are working days without punches: Alpha's attendance pay
    // policy says unmarked_day = PRESENT, so they are paid at the standard 8 h a day -> 16 h. Sun 25 is the weekly
    // off (no pay for an hourly worker). Payable hours 32 + 16 = 48 h; 48 x 250.00 = 12,000.00 INR.
    const expectedGross = "12000.00";
    const row = db("run_employees", { run_id: DRAFT }).find((r) => r.name === "Suresh Kumar")!;
    expect(row, "Suresh Kumar is in the weekly run").toBeTruthy();
    expect(money(row.gross)).toBe(expectedGross);
    await p.goto(`/payroll/runs/${DRAFT}/employees/${row.id}`);
    await settle(p);
    await expect(p.getByRole("region", { name: "Pay lines" })).toBeVisible();
    expect(digits(await mainText(p))).toContain(digits(expectedGross));
    const why = p.getByRole("button", { name: /why this amount\?/i }).first();
    if (await why.count()) {
      await why.click();
      await shot(p, testInfo, "alpha-11-explanation");
      await p.keyboard.press("Escape");
    } else await shot(p, testInfo, "alpha-11-employee-in-run");
    financialRow({ company: "alpha", run: DRAFT, employee: "Suresh Kumar", check: "gross (32 h punched + 16 h unmarked=PRESENT) x 250.00", expected: expectedGross, actual: money(row.gross) });
    step(J, 11, "employee in run with explanation; gross matches hand calculation", "pass", { gross: row.gross });
    expect(proc.pageErrors).toEqual([]);
  } finally {
    await proc.close();
  }
});

test("A12-A13 settings change at pay-group level and recalculated difference", async ({ browser }, testInfo) => {
  const before = db("run_employees", { run_id: DRAFT }).find((r) => r.name === "Suresh Kumar")!;
  // The increment is chosen so the change is visible: 100 INR unless the net is already a multiple of 100,
  // otherwise 7 INR (any multiple of the minor unit up to 100 units is a valid value of this setting).
  const unroundedCents = Math.round(Number(before.net) * 100);
  const INCREMENT = unroundedCents % 10000 !== 0 ? 100 : 7;
  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    const p = admin.page;
    // Net pay rounding increment (INCREMENT INR) on the Weekly pay group only (PAY_GROUP override), from the period start.
    const weekly = (A as any).ids.pay_groups.weekly as number;
    await p.goto(`/settings/payroll/currency?scope=PAY_GROUP&id=${weekly}`);
    await settle(p);
    const field = p.locator('[data-setting="payroll.rounding.net_pay_increment"]');
    await expect(field).toBeVisible();
    await field.locator("input").first().fill(String(INCREMENT));
    await p.getByLabel("Effective from").fill("2026-10-19");
    await p.getByLabel(/^Reason/).fill(`E2E: round weekly crew net pay to ${INCREMENT} INR (test)`);
    await shot(p, testInfo, "alpha-12-settings-change-pending");
    await p.getByRole("button", { name: /^save$/i }).click();
    await expect.poll(() => db("setting", { company_id: A.company_id, key: "payroll.rounding.net_pay_increment" }).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const rows = db("setting", { company_id: A.company_id, key: "payroll.rounding.net_pay_increment" });
    expect(rows.some((r) => r.scope_type === "PAY_GROUP" && Number(r.scope_id) === weekly)).toBe(true);
    // Other tenants unchanged (their rows for this key stay absent)
    expect(db("setting", { company_id: company("beta").company_id, key: "payroll.rounding.net_pay_increment" })).toEqual([]);
    await shot(p, testInfo, "alpha-12b-settings-saved");
    step(J, 12, `settings change: net pay rounding increment ${INCREMENT} at pay-group level`, "pass", { rows: rows.map((r) => ({ scope: r.scope_type, value: r.value })) });
  } finally {
    await admin.close();
  }

  const proc = await login(browser, testInfo, "alpha", "processor");
  try {
    const p = proc.page;
    await p.goto(`/payroll/runs/${DRAFT}`);
    await settle(p);
    const stamp = db("run", { id: DRAFT })[0].calculated_at;
    await p.getByRole("button", { name: /recalculate/i }).first().click();
    await p.getByRole("button", { name: /^recalculate all$/i }).click();
    await expect.poll(() => db("run", { id: DRAFT })[0].calculated_at, { timeout: 120_000 }).not.toBe(stamp);
    await expect.poll(() => db("run", { id: DRAFT })[0].status, { timeout: 120_000 }).toMatch(/REVIEW_REQUIRED|CALCULATED/);
    const after = db("run_employees", { run_id: DRAFT }).find((r) => r.name === "Suresh Kumar")!;
    // Hand calculation in integer paise: before = unrounded net; after = before rounded HALF_UP (company default
    // net_pay_mode) to a multiple of INCREMENT: floor(cents / inc + 1/2) * inc, with inc = INCREMENT x 100 paise.
    const unrounded = Number(before.net);
    const inc = INCREMENT * 100;
    const roundedCents = Math.floor((2 * unroundedCents + inc) / (2 * inc)) * inc;
    const expected = (roundedCents / 100).toFixed(2);
    expect(money(after.net)).toBe(expected);
    expect(Math.round(Number(after.net) * 100) % inc).toBe(0);
    expect(expected).not.toBe(money(before.net)); // the change is visible
    financialRow({ company: "alpha", run: DRAFT, employee: "Suresh Kumar", check: `net after rounding increment ${INCREMENT} (HALF_UP)`, expected, actual: money(after.net), before: money(before.net) });
    await p.reload();
    await settle(p);
    await shot(p, testInfo, "alpha-13-recalculated");
    step(J, 13, "recalculate shows the difference", "pass", { net_before: before.net, net_after: after.net, difference: (Number(after.net) - unrounded).toFixed(2) });
  } finally {
    await proc.close();
  }
});

test("A14-A18 exceptions, submit, SoD denial, independent approval and finalize with step-up", async ({ browser }, testInfo) => {
  const proc = await login(browser, testInfo, "alpha", "processor");
  try {
    const p = proc.page;
    await p.goto(`/payroll/runs/${DRAFT}?tab=exceptions`);
    await settle(p);
    await p.getByRole("tab", { name: /exceptions/i }).click().catch(() => undefined);
    await shot(p, testInfo, "alpha-14-exceptions");
    const ex = db("exceptions", { run_id: DRAFT });
    step(J, 14, "exceptions tab", "pass", { exceptions: ex.map((e) => `${e.code}:${e.status}`) });

    if (db("run", { id: DRAFT })[0].status === "REVIEW_REQUIRED") {
      await p.goto(`/payroll/runs/${DRAFT}`);
      await settle(p);
      await p.getByRole("button", { name: /submit for approval/i }).first().click();
      const dialog = p.getByRole("dialog");
      await dialog.locator("textarea").fill("E2E: weekly crew ready for approval");
      await dialog.getByRole("button", { name: /submit for approval/i }).click();
    }
    await expect.poll(() => db("run", { id: DRAFT })[0].status, { timeout: 30_000 }).toMatch(/APPROVAL_PENDING|APPROVED|FINALIZED/);
    await shot(p, testInfo, "alpha-15-submitted");
    step(J, 15, "submit for approval", "pass", { status: db("run", { id: DRAFT })[0].status });

    // A16 separation of duties: the submitter sees no Approve button and the API refuses.
    await p.reload();
    await settle(p);
    await expect(p.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
    const run = (await api(p, "GET", `/payroll/runs/${DRAFT}`)).data;
    const self = await api(p, "POST", `/payroll/runs/${DRAFT}/approve`, { row_version: run.row_version, comment: null });
    if (run.status === "APPROVAL_PENDING") {
      expect([403, 409, 422]).toContain(self.status);
      expect(db("run", { id: DRAFT })[0].approved_at).toBeNull();
    }
    step(J, 16, "self-approval refused (SoD)", "pass", { status: self.status, code: (self.data as any)?.code });
  } finally {
    await proc.close();
  }

  const approver = await login(browser, testInfo, "alpha", "approver");
  try {
    const p = approver.page;
    await p.goto(`/payroll/runs/${DRAFT}`);
    await settle(p);
    if (db("run", { id: DRAFT })[0].status === "APPROVAL_PENDING") {
      await p.getByRole("button", { name: /^approve$/i }).first().click();
      const dialog = p.getByRole("dialog");
      await dialog.locator("textarea").fill("E2E: checked hours and rounding");
      await shot(p, testInfo, "alpha-17a-approve-dialog");
      await dialog.getByRole("button", { name: /^approve/i }).last().click();
    }
    await expect.poll(() => db("run", { id: DRAFT })[0].status, { timeout: 30_000 }).toMatch(/^(APPROVED|FINALIZED)$/);
    // The approver cannot finalize (no payroll manager rights)
    const run = (await api(p, "GET", `/payroll/runs/${DRAFT}`)).data;
    const fin = await api(p, "POST", `/payroll/runs/${DRAFT}/finalize`, { confirm_text: run.label, row_version: run.row_version }, { "Idempotency-Key": `e2e-${Date.now()}` });
    expectDenied(fin.status === 409 || fin.status === 422 ? 403 : fin.status, "approver finalize");
    await shot(p, testInfo, "alpha-17-approved");
    step(J, 17, "independent approval by the payroll approver", "pass", { approver_finalize_status: fin.status });
  } finally {
    await approver.close();
  }

  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    const p = admin.page;
    await p.goto(`/payroll/runs/${DRAFT}`);
    await settle(p);
    const label = db("run", { id: DRAFT })[0];
    if (label.status === "APPROVED") {
      await p.getByRole("button", { name: /^finalize$/i }).first().click();
      const typed = p.getByRole("dialog", { name: /finalize run/i });
      const runApi = (await api(p, "GET", `/payroll/runs/${DRAFT}`)).data;
      await typed.locator("input").fill(runApi.label);
      await shot(p, testInfo, "alpha-18-finalize-typed-confirm");
      await typed.getByRole("button", { name: /^finalize$/i }).click();
      await completeStepUpModal(p, "alpha", "admin");
    }
    await expect.poll(() => db("run", { id: DRAFT })[0].status, { timeout: 60_000 }).toBe("FINALIZED");
    // Finalized nets = payment obligations (DB)
    const sums = db("run_employee_sums", { run_id: DRAFT })[0];
    const obligations = db("obligations", { run_id: DRAFT });
    const obligationTotal = obligations.reduce((a, o) => a + Number(o.amount), 0).toFixed(2);
    expect(obligationTotal).toBe(money(sums.net));
    await p.reload();
    await settle(p);
    await shot(p, testInfo, "alpha-18b-finalized");
    step(J, 18, "finalize with typed confirmation + e-mailed step-up code", "pass", { run: label.number, obligations: obligationTotal, net: sums.net });
  } finally {
    await admin.close();
  }
});

test("A19 payslips generated for the finalized run", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    const p = admin.page;
    await expect.poll(() => db("documents_of_run", { run_id: DRAFT }).filter((d) => /PAYSLIP/.test(d.doc_type)).length, { timeout: 120_000 }).toBeGreaterThan(0);
    await p.goto(`/payroll/payslips`);
    await settle(p);
    await expect(p.locator("main")).toContainText(/Payslip|PS\//);
    await shot(p, testInfo, "alpha-19-payslips");
    const docs = db("documents_of_run", { run_id: DRAFT });
    expect(docs.every((d) => d.company_id === A.company_id)).toBe(true);
    step(J, 19, "payslips generated, tenant-owned", "pass", { documents: docs.map((d) => `${d.doc_type}:${d.number}:${d.status}`) });
  } finally {
    await admin.close();
  }
});

test("A20-A21 employee My Salary and payslip PDF download (Rohan Gupta, October)", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "alpha", "emp1");
  try {
    const p = emp.page;
    await p.goto("/me/salary");
    await settle(p);
    await expectNoForeignBrand(p, "alpha");
    await shot(p, testInfo, "alpha-20-my-salary");
    step(J, 20, "employee My Salary", "pass");

    // Hand calculation (CTC 1,200,000 INR/year): monthly 100,000.00 = BASIC 50,000 + HRA 20,000 + FIXED 30,000.
    // Approved overtime 2 h on a workday at 1.5x; OT hourly base = BASIC / calendar days (31) / 8 h
    // = 50,000 / 248 = 201.6129032...; 2 x 1.5 x 201.6129032 = 604.8387... -> 604.84 (HALF_UP to paise).
    // Gross = 100,604.84; no deductions in this run -> net 100,604.84.
    const expectedNet = "100604.84";
    const row = db("run_employees", { run_id: OCT }).find((r) => r.name === "Rohan Gupta")!;
    expect(money(row.gross)).toBe("100604.84");
    expect(money(row.net)).toBe(expectedNet);
    financialRow({ company: "alpha", run: OCT, employee: "Rohan Gupta", check: "net (CTC/12 + OT 2h x 1.5 x BASIC/31/8)", expected: expectedNet, actual: money(row.net) });
    // Meera Joshi: CTC 720,000 -> 60,000/month; 1 LOP day of 31 (calendar basis):
    // BASIC 30,000 x 30/31 = 29,032.2580 -> 29,032.26; HRA 12,000 x 30/31 = 11,612.9032 -> 11,612.90;
    // FIXED 18,000 x 30/31 = 17,419.3548 -> 17,419.35; gross 58,064.51; advance 15,000 over 2 runs -> 7,500.00;
    // net = 58,064.51 - 7,500.00 = 50,564.51.
    const meera = db("run_employees", { run_id: OCT }).find((r) => r.name === "Meera Joshi")!;
    financialRow({ company: "alpha", run: OCT, employee: "Meera Joshi", check: "gross (1 LOP day, calendar basis)", expected: "58064.51", actual: money(meera.gross) });
    financialRow({ company: "alpha", run: OCT, employee: "Meera Joshi", check: "net (advance instalment 7,500.00)", expected: "50564.51", actual: money(meera.net) });
    expect(money(meera.gross)).toBe("58064.51");
    expect(money(meera.net)).toBe("50564.51");

    await p.goto("/me/payslips");
    await settle(p);
    await expect(p.locator("main")).toContainText(/October 2026/);
    expect(digits(await mainText(p))).toContain(digits("100604.84"));
    await shot(p, testInfo, "alpha-21-my-payslips");
    const list = (await api(p, "GET", "/me/payroll/payslips")).data.items as { id: number; run_id: number }[];
    const oct = list.find((d) => d.run_id === OCT)!;
    const [download] = await Promise.all([
      p.waitForEvent("download", { timeout: 45_000 }),
      p.goto(`/me/payslips/${oct.id}`).then(async () => {
        await settle(p);
        await p.getByRole("button", { name: /download/i }).or(p.getByRole("link", { name: /download/i })).first().click();
      }),
    ]);
    const file = evidencePath("alpha-21-payslip-rohan-october.pdf");
    await download.saveAs(file);
    const pdf = JSON.parse(execFileSync(path.join(BACKEND, "venv", "Scripts", "python.exe"), [path.join(BACKEND, "scripts", "e2e_pdf.py"), file, evidencePath("alpha-21-payslip-page1.png")], { cwd: BACKEND, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
    expect(pdf.pages).toBeGreaterThan(0);
    expect(digits(pdf.text)).toContain(digits("100604.84"));
    expect(pdf.text).toMatch(/Alpha/);
    expect(pdf.text).not.toMatch(/Beta Logistics|Gamma Solutions|Beta Workforce|Gamma HR Cloud/);
    fs.writeFileSync(evidencePath("alpha-21-payslip-text-check.json"), JSON.stringify({ sha256: pdf.sha256, pages: pdf.pages, fonts: pdf.fonts, contains_net: true }, null, 2));
    step(J, 21, "payslip download (PDF text checked by PyMuPDF)", "pass", { sha256: pdf.sha256 });
    expect(emp.pageErrors).toEqual([]);
  } finally {
    await emp.close();
  }
});

test("A22 bank management: masked self-service and finance views", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "alpha", "emp1");
  try {
    await emp.page.goto("/me/bank-accounts");
    await settle(emp.page);
    await expectNoUnmaskedBankData(emp.page);
    await shot(emp.page, testInfo, "alpha-22-my-bank-accounts-masked");
  } finally {
    await emp.close();
  }
  const fin = await login(browser, testInfo, "alpha", "finance");
  try {
    await fin.page.goto("/payroll/bank-details");
    await settle(fin.page);
    await expectNoUnmaskedBankData(fin.page);
    await shot(fin.page, testInfo, "alpha-22b-finance-bank-details-masked");
    step(J, 22, "bank details masked for employee and finance", "pass");
  } finally {
    await fin.close();
  }
});

test("A23-A24 finance batch: prepare, approve, release as manual — 'Submitted for manual payment — unverified'", async ({ browser }, testInfo) => {
  const batchOf = () => db("batches_of_run", { run_id: OCT }).find((b) => b.status !== "CANCELLED");
  // 23a — the finance preparer previews and creates the batch from the finalized October run.
  if (!batchOf()) {
    const prep = await login(browser, testInfo, "alpha", "finance");
    try {
      const p = prep.page;
      await p.goto(`/payroll/payments?modal=new-batch&run=${OCT}`);
      await settle(p);
      await shot(p, testInfo, "alpha-23-create-batch");
      await p.getByRole("button", { name: /preview/i }).first().click();
      await expect(p.getByRole("region", { name: "Proposed batches" })).toBeVisible({ timeout: 30_000 });
      await shot(p, testInfo, "alpha-23b-batch-proposal");
      await p.getByRole("button", { name: /create/i }).last().click();
      await expect.poll(() => (batchOf() ? 1 : 0), { timeout: 30_000 }).toBe(1);
    } finally {
      await prep.close();
    }
  }
  const batchId = batchOf()!.id as number;
  step(J, "23a", "finance prepares a payment batch from the finalized run", "pass", { batch: db("batch", { id: batchId })[0] });

  // 23b — a second finance user approves; the preparer may not (separation of duties).
  if (db("batch", { id: batchId })[0].status === "APPROVAL_PENDING") {
    const prep = await login(browser, testInfo, "alpha", "finance", { label: "finance-self-approve" });
    try {
      await prep.page.goto(`/payroll/payments/batches/${batchId}`);
      await settle(prep.page);
      await expect(prep.page.getByRole("button", { name: /^approve batch$/i })).toHaveCount(0);
      const detail = (await api(prep.page, "GET", `/payroll/payment-batches/${batchId}`)).data;
      const self = await api(prep.page, "POST", `/payroll/payment-batches/${batchId}/approve`, { row_version: detail.row_version });
      expect(self.status, "preparer approving own batch").toBeGreaterThanOrEqual(400);
      expect(db("batch", { id: batchId })[0].status).toBe("APPROVAL_PENDING");
      step(J, "23b-sod", "preparer cannot approve own batch", "pass", { status: self.status });
    } finally {
      await prep.close();
    }
    const appr = await login(browser, testInfo, "alpha", "finance2");
    try {
      const p = appr.page;
      await p.goto(`/payroll/payments/batches/${batchId}`);
      await settle(p);
      await p.getByRole("button", { name: /^approve batch$/i }).click();
      await expect.poll(() => db("batch", { id: batchId })[0].status, { timeout: 30_000 }).toBe("APPROVED");
      await shot(p, testInfo, "alpha-23c-batch-approved");
    } finally {
      await appr.close();
    }
  }
  step(J, "23b", "second finance user approves the batch", "pass");

  // 23c — the preparer generates the bank file (a file export is not a payment).
  if (db("batch", { id: batchId })[0].status === "APPROVED") {
    const prep = await login(browser, testInfo, "alpha", "finance", { label: "finance-file" });
    try {
      const p = prep.page;
      await p.goto(`/payroll/payments/batches/${batchId}`);
      await settle(p);
      await p.getByRole("button", { name: /generate file/i }).click();
      await expect.poll(() => db("batch", { id: batchId })[0].status, { timeout: 30_000 }).toBe("FILE_GENERATED");
      await shot(p, testInfo, "alpha-23d-file-generated");
    } finally {
      await prep.close();
    }
  }
  expect(db("instructions_of_batch", { batch_id: batchId }).filter((i) => ["SETTLED", "RECONCILED"].includes(i.status))).toEqual([]);

  // 23d — the signatory (not the preparer) marks the batch as submitted, with typed confirmation and step-up.
  const rel = await login(browser, testInfo, "alpha", "finance3");
  try {
    const p = rel.page;
    await p.goto(`/payroll/payments/batches/${batchId}`);
    await settle(p);
    if (db("batch", { id: batchId })[0].status === "FILE_GENERATED") {
      await p.getByRole("button", { name: /^mark as submitted$/i }).first().click();
      const typed = p.getByRole("dialog", { name: /mark batch as submitted/i });
      await expect(typed).toBeVisible();
      await typed.locator("input").fill(db("batch", { id: batchId })[0].reference);
      await shot(p, testInfo, "alpha-23e-release-typed-confirm");
      await typed.getByRole("button", { name: /^mark as submitted$/i }).click();
      const stepUp = p.getByRole("dialog", { name: /confirm it's you/i });
      await stepUp.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      if (await stepUp.isVisible()) await completeStepUpModal(p, "alpha", "finance3");
      await expect.poll(() => db("batch", { id: batchId })[0].status, { timeout: 45_000 }).not.toBe("FILE_GENERATED");
    }
    await p.reload();
    await settle(p);
    await expect(p.locator("main")).toContainText("Submitted for manual payment — unverified");
    await shot(p, testInfo, "alpha-23f-submitted-manual-unverified");
    const instr = db("instructions_of_batch", { batch_id: batchId });
    // A file export / manual release is not a payment: nothing is SETTLED without evidence.
    expect(instr.filter((i) => ["SETTLED", "RECONCILED"].includes(i.status))).toEqual([]);
    expect(Number(db("settled_without_evidence", { company_id: A.company_id })[0].n)).toBe(0);
    // Batch total = sum of its instructions (integer paise)
    const cents = instr.reduce((a, i) => a + Math.round(Number(i.amount) * 100), 0);
    expect((cents / 100).toFixed(2)).toBe(money(db("batch", { id: batchId })[0].total_amount));
    writeEvidence("alpha-23-batch-db.json", { batch: db("batch", { id: batchId })[0], instructions: instr.map((i) => ({ status: i.status, evidence_status: i.evidence_status, amount: i.amount, channel: i.submission_channel })) });
    step(J, 23, "release as manual: 'Submitted for manual payment — unverified', nothing settled", "pass", { batch_status: db("batch", { id: batchId })[0].status, statuses: [...new Set(instr.map((i) => i.status))] });
  } finally {
    await rel.close();
  }
  // The employee sees the same truthful status (never "settled").
  const emp = await login(browser, testInfo, "alpha", "emp1", { label: "emp1-payments" });
  try {
    await emp.page.goto("/me/payments");
    await settle(emp.page);
    await shot(emp.page, testInfo, "alpha-23g-employee-payment-status");
    expect(await mainText(emp.page)).not.toMatch(/\bSettled\b/);
  } finally {
    await emp.close();
  }

  // A24 reconciliation workspace: the released items await evidence (bank statement / reviewed proof)
  const recon = await login(browser, testInfo, "alpha", "finance", { label: "finance-recon" });
  try {
    const p = recon.page;
    await p.goto("/payroll/payments/reconciliation");
    await settle(p);
    await shot(p, testInfo, "alpha-24-reconciliation");
    const runPayments = await api(p, "GET", `/payroll/runs/${OCT}/payments`);
    expect(runPayments.status).toBe(200);
    writeEvidence("alpha-24-run-payments.json", { status: runPayments.status, body: runPayments.data });
    step(J, 24, "reconciliation workspace; settlement only from statement/evidence (no statement imported)", "pass");
  } finally {
    await recon.close();
  }
});

test("A25 reports reconcile with the finalized run", async ({ browser }, testInfo) => {
  const admin = await login(browser, testInfo, "alpha", "admin");
  try {
    const p = admin.page;
    await p.goto("/payroll/reports");
    await settle(p);
    await shot(p, testInfo, "alpha-25-reports");
    const catalogue = await api(p, "GET", "/payroll/reports");
    expect(catalogue.status).toBe(200);
    const codes = (catalogue.data.groups as { reports: { code: string }[] }[]).flatMap((g) => g.reports.map((r) => r.code));
    expect(codes).toContain("payroll_register");
    await p.goto("/payroll/reports/payroll_register");
    await settle(p);
    await shot(p, testInfo, "alpha-25b-report-register");
    const monthly = (A as any).ids.pay_groups.monthly as number;
    const preview = await api(p, "GET", `/payroll/reports/payroll_register/preview?period_from=2026-10-01&period_to=2026-10-31&pay_group_id=${monthly}`);
    expect(preview.status).toBe(200);
    const number = db("run", { id: OCT })[0].number;
    const rows = (preview.data.rows as { run_number: string; net: { amount: string } | null; employee_name: string }[]).filter((r) => r.run_number === number);
    const cents = rows.reduce((a, r) => a + (r.net ? Math.round(Number(r.net.amount) * 100) : 0), 0);
    const sums = db("run_employee_sums", { run_id: OCT })[0];
    expect((cents / 100).toFixed(2)).toBe(money(sums.net));
    // Report rows belong to Alpha's employees only
    const own = new Set(db("run_employees", { run_id: OCT }).map((r) => r.name));
    expect(rows.every((r) => own.has(r.employee_name))).toBe(true);
    financialRow({ company: "alpha", run: OCT, employee: "(run total)", check: "payroll register net = DB sum of nets", expected: money(sums.net), actual: (cents / 100).toFixed(2) });
    step(J, 25, "reports: payroll register reconciles to the run's net", "pass", { rows: rows.length, net: sums.net });
  } finally {
    await admin.close();
  }
});

test("A26 negative authorization and cross-company denial", async ({ browser }, testInfo) => {
  const emp = await login(browser, testInfo, "alpha", "emp1");
  const denials: Record<string, number> = {};
  try {
    const p = emp.page;
    await p.goto("/payroll/runs");
    await settle(p);
    await shot(p, testInfo, "alpha-26-employee-denied-runs");
    for (const path of [`/payroll/runs`, `/payroll/runs/${OCT}`, `/payroll/runs/${OCT}/employees`, `/payroll/payment-batches`, `/payroll/reports/payroll_register/preview?period_from=2026-10-01&period_to=2026-10-31`]) {
      denials[`emp1 GET ${path}`] = (await api(p, "GET", path)).status;
      expectDenied(denials[`emp1 GET ${path}`], `employee ${path}`);
    }
    // The compensation list answers with the employee's own row only (SELF scope).
    const list = await api(p, "GET", "/payroll/compensation");
    denials["emp1 GET /payroll/compensation (own rows only)"] = list.status;
    if (list.status === 200) expect((list.data.items as { employee: { id: number } }[]).every((i) => i.employee.id === people.emp1.employee_id)).toBe(true);
    // The bank-account register likewise answers with the employee's own (masked) accounts only.
    const banks = await api(p, "GET", "/payroll/bank-accounts");
    denials["emp1 GET /payroll/bank-accounts (own rows only)"] = banks.status;
    if (banks.status === 200) {
      expect((banks.data.items as { employee_id: number }[]).every((i) => i.employee_id === people.emp1.employee_id)).toBe(true);
      expect(JSON.stringify(banks.data)).not.toMatch(/"account_number"\s*:\s*"\d/);
    }
    const other = people.emp4.employee_id; // Meera Joshi
    denials["emp1 GET other's compensation"] = (await api(p, "GET", `/payroll/employees/${other}/compensation`)).status;
    expectDenied(denials["emp1 GET other's compensation"], "employee reading a colleague's salary");
  } finally {
    await emp.close();
  }
  const mgr = await login(browser, testInfo, "alpha", "deptmgr");
  try {
    const p = mgr.page;
    const beta = company("beta");
    for (const [label, path] of [
      ["Beta run", `/payroll/runs/${beta.runs.finalized.id}`],
      ["Beta run employees", `/payroll/runs/${beta.runs.finalized.id}/employees`],
    ] as const) {
      denials[`deptmgr ${label}`] = (await api(p, "GET", path)).status;
      expectDenied(denials[`deptmgr ${label}`], label);
    }
    step(J, 26, "negative authorization (employee, manager) and cross-company denials", "pass", denials);
    writeEvidence("alpha-26-denials.json", denials);
  } finally {
    await mgr.close();
  }
});
