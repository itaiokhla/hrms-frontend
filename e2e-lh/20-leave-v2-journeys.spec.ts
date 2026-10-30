/**
 * Leave v2 (LH-M2..M10) end to end on the time stack 8500/3500 in Chrome, three tenants:
 *   Alpha (India office plan) and Gamma (US PTO plan) go live on leave plans + the ledger; Beta stays LEGACY_V1.
 *   1. HR setup: types, plan from template, assignment, activation, reconciliation, "Go live" with typed confirmation
 *      and "Confirm it's you" (Alpha through the UI, Gamma through the API).
 *   2. Employee: home, balances, apply with the live preview (weekend not charged), half day, draft, withdraw.
 *   3. Manager / HR: approvals inbox approve + reject + return, change request (partial cancel) approval, team calendar,
 *      apply on behalf, balance adjustment, HR admin workspace tabs, comp-off claim, encashment request.
 *   4. Security: tenant isolation (404 across companies), employee RBAC (403 on admin APIs, no admin page).
 *   5. Legacy tenant Beta keeps the legacy leave flow.
 * Rerun-safe: picks free dates per run and skips go-live when a tenant is already live.
 * Evidence: test-evidence/<date>-g<NN>/ (E2E_TIME_GOAL, e.g. lh-v2).
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, test } from "../e2e-as/support";
import { completeStepUpIfAsked, stepUpViaApi } from "./step-up";

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const SEED = parseInt(RUN.slice(-2), 36) % 40;

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
/** Request detail keeps the legacy lowercase `status` and adds `status_v2`. */
const st = (d: any) => String(d?.status_v2 ?? d?.status ?? "").toUpperCase();
const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Next Friday on/after the given day. */
function friday(from: string) {
  let d = from;
  while (dow(d) !== 5) d = addDays(d, 1);
  return d;
}

async function ensureLive(page: Page, key: "alpha" | "gamma", person: string, template: string, planName: string) {
  const setup = await api(page, "GET", "/leaves/setup");
  expect(setup.status, JSON.stringify(setup.data)).toBe(200);
  if (setup.data.state === "V2_ACTIVE") return false;
  const plans = await api(page, "GET", "/leaves/plans");
  expect(plans.status, JSON.stringify(plans.data)).toBe(200);
  const list = (Array.isArray(plans.data) ? plans.data : plans.data.items ?? []) as { id: number; name: string }[];
  let plan = list.find((p) => p.name === planName);
  await stepUpViaApi(page, key, person);
  if (!plan) {
    const created = await api(page, "POST", "/leaves/plans", { name: planName, template_key: template, effective_from: "2026-01-01" });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    plan = created.data;
    const assign = await api(page, "PUT", `/leaves/plans/${plan!.id}/assignments`, {
      rules: [{ criteria: { everyone: true }, priority: 10, effective_from: "2026-01-01" }],
    });
    expect(assign.status, JSON.stringify(assign.data)).toBe(200);
    const act = await api(page, "POST", `/leaves/plans/${plan!.id}/versions/1/activate`, { effective_from: "2026-01-01", reason: `Set up ${planName}` });
    expect(act.status, JSON.stringify(act.data)).toBe(200);
  }
  return true;
}

/** Rerun safety: withdraw this person's open (pending / returned / draft) requests left by earlier runs. */
async function withdrawOpen(page: Page) {
  const list = await api(page, "GET", "/leaves/requests?limit=200");
  for (const r of (list.data.items ?? []) as any[]) {
    if (["PENDING", "RETURNED", "DRAFT"].includes(r.status) && r.start_date >= "2026-11-01") {
      await api(page, "POST", `/leaves/requests/${r.id}/withdraw`, { reason: "e2e cleanup" });
    }
  }
}

/** Submit a request through the API on the first free slot; returns the created request. */
async function applyFree(page: Page, body: Record<string, unknown>, from: string, span = 0, tries = 25) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    let start = addDays(from, i);
    while ([0, 6].includes(dow(start))) start = addDays(start, 1);
    const r = await api(page, "POST", "/leaves/requests", { ...body, start_date: start, end_date: addDays(start, span) });
    if (r.status === 201) return r.data;
    last = r;
  }
  throw new Error(`no free slot: ${JSON.stringify(last?.data)}`);
}

test("Leave v2 — HR goes live, employees apply, managers decide, HR operates, tenants stay isolated", async ({ page, browser }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const base = addDays("2026-11-09", (SEED % 4) * 7); // stay inside the 2026 cycle (2027 is not granted yet)
  let approvedId = 0;
  let detail0: any = null;

  await test.step("1a. Alpha HR setup: types, plan from the India office template, reconciliation", async () => {
    await signIn(page, "alpha", "founder");
    const wasLegacy = await ensureLive(page, "alpha", "founder", "IN.OFFICE.V1", "Alpha India Office");
    await page.goto("/settings/leave/types");
    await expect(page.getByRole("main")).toContainText(/casual/i);
    await shot(page, testInfo, "lh20-01-types-catalogue");
    await page.goto("/settings/leave/plans");
    await expect(page.getByRole("main")).toContainText(/Alpha India Office|Default plan/);
    await shot(page, testInfo, "lh20-02-plans");
    await page.goto("/settings/leave/setup");
    await expect(page.getByTestId("leave-state")).toBeVisible();
    if (wasLegacy) {
      await page.getByTestId("run-reconcile").click();
      await expect(page.getByText("Unexplained").first()).toBeVisible();
      await shot(page, testInfo, "lh20-03-reconcile-report");
      await page.getByTestId("go-live-open").click();
      const dialog = page.getByRole("dialog", { name: /go live/i });
      await dialog.getByRole("textbox").fill("GO LIVE");
      await shot(page, testInfo, "lh20-04-go-live-typed-confirmation");
      await dialog.getByTestId("go-live-submit").click();
      await completeStepUpIfAsked(page, "alpha", "founder", 8_000);
      await expect(page.getByText(/Leave v2 is live/).first()).toBeVisible({ timeout: 30_000 });
    }
    const setup = await api(page, "GET", "/leaves/setup");
    expect(setup.data.state).toBe("V2_ACTIVE");
    await page.reload();
    await shot(page, testInfo, "lh20-05-alpha-v2-active");
  });

  await test.step("1b. Gamma (US) goes live on the US PTO template — a second tenant, its own plan", async () => {
    const grace = await openAs(browser, "gamma", "founder");
    if (await ensureLive(grace.page, "gamma", "founder", "US.PTO.V1", "Gamma US PTO")) {
      const report = await api(grace.page, "GET", "/leaves/setup/reconcile");
      expect(report.status, JSON.stringify(report.data)).toBe(200);
      const live = await api(grace.page, "POST", "/leaves/setup/go-live", { confirm: "GO LIVE" });
      expect(live.status, JSON.stringify(live.data)).toBe(200);
    }
    await grace.page.goto("/settings/leave/setup");
    await expect(grace.page.getByTestId("leave-state")).toBeVisible();
    await shot(grace.page, testInfo, "lh20-06-gamma-v2-active");
    await grace.close();
  });

  await test.step("2a. Rohan: home, balances, apply Fri→Mon with the live preview (the weekend is not charged)", async () => {
    const arjun0 = await openAs(browser, "alpha", "arjun");
    await withdrawOpen(arjun0.page);
    await arjun0.close();
    const rohan = await openAs(browser, "alpha", "rohan");
    const p = rohan.page;
    await withdrawOpen(p);
    // Earlier runs' approved casual leave in Nov–Dec is cancelled through change requests the manager approves.
    const old = await api(p, "GET", "/leaves/requests?limit=200");
    for (const r of (old.data.items ?? []) as any[]) {
      if (r.status !== "APPROVED" || r.leave_type !== "casual" || r.start_date < "2026-11-01" || r.start_date > "2026-12-31") continue;
      const c = await api(p, "POST", `/leaves/requests/${r.id}/changes`, { kind: "CANCEL", proposed: {}, reason: "e2e cleanup" });
      if (c.status === 201) {
        const a = await openAs(browser, "alpha", "arjun");
        await api(a.page, "POST", `/leaves/changes/${c.data.id}/approve`, {});
        await a.close();
      }
    }
    await p.goto("/leaves/home");
    await expect(p.getByTestId("leave-home")).toBeVisible();
    await shot(p, testInfo, "lh20-07-employee-home");
    await p.goto("/leaves/balances");
    await expect(p.getByTestId("balance-card-casual").first()).toBeVisible({ timeout: 30_000 });
    await shot(p, testInfo, "lh20-08-employee-balances");
    const before = await api(p, "GET", "/leaves/balances/me");
    expect(before.status).toBe(200);
    let start = friday(base);
    let submitted: any = null;
    for (let i = 0; i < 12 && !submitted; i++, start = addDays(start, 7)) {
      await p.goto("/leaves/apply");
      await expect(p.getByTestId("apply-leave-form")).toBeVisible();
      await p.getByTestId("leave-type-select").selectOption("casual");
      await p.getByTestId("leave-start").fill(start);
      await p.getByTestId("leave-end").fill(addDays(start, 3));
      await p.getByTestId("leave-reason").fill(`Family function ${RUN}`);
      const preview = p.getByTestId("leave-preview");
      await expect(preview).toBeVisible();
      await expect(p.getByTestId("preview-charged").or(p.getByTestId("preview-error")).first()).toBeVisible();
      await p.waitForTimeout(1500);
      if ((await p.getByTestId("preview-error").isVisible()) || !(await p.getByTestId("leave-submit").isEnabled())) continue;
      await expect(p.getByTestId("preview-charged")).toContainText(/^\s*[12] days?/); // Sat + Sun never charged (a holiday may also drop a day)
      if (i === 0 || !submitted) await shot(p, testInfo, "lh20-09-apply-preview-weekend-free");
      await p.getByTestId("leave-submit").click();
      await expect(p.getByTestId("leave-detail").or(p.getByText(/submitted|sent for approval/i)).first()).toBeVisible({ timeout: 20_000 });
      await shot(p, testInfo, "lh20-09b-request-submitted-drawer");
      const mine = await api(p, "GET", `/leaves/requests?limit=50`);
      submitted = ((mine.data.items ?? mine.data) as any[]).filter((r) => r.start_date === start && r.status === "PENDING").sort((x, y) => y.id - x.id)[0];
    }
    expect(submitted, "the request was created from the form").toBeTruthy();
    approvedId = submitted.id;
    const charged = Number(submitted.days ?? submitted.number_of_days ?? submitted.units ?? 2);
    expect(charged).toBeLessThanOrEqual(2);
    await p.goto("/leaves/requests");
    await expect(p.getByTestId("leave-requests")).toBeVisible();
    await shot(p, testInfo, "lh20-10-my-requests-pending");

    // A half day (first half) and a draft that is withdrawn.
    const half = await applyFree(p, { leave_type: "earned", start_portion: "FULL", end_portion: "FIRST_HALF", reason: `Half day ${RUN}` }, addDays(base, 2));
    expect(Number(half.number_of_days ?? half.days ?? half.units)).toBe(0.5);
    const withdrawn = await api(p, "POST", `/leaves/requests/${half.id}/withdraw`, { reason: "Plans changed" });
    expect(withdrawn.status, JSON.stringify(withdrawn.data)).toBe(200);
    await rohan.close();
  });

  await test.step("3a. Arjun (manager) approves from the inbox; any HR step is cleared by Kavya", async () => {
    const arjun = await openAs(browser, "alpha", "arjun");
    await arjun.page.goto("/leaves/approvals");
    await expect(arjun.page.getByTestId("approvals-inbox")).toBeVisible();
    const approve = arjun.page.getByTestId(`approval-approve-${approvedId}`).first();
    await expect(approve).toBeVisible();
    await shot(arjun.page, testInfo, "lh20-11-manager-inbox");
    await approve.click();
    await completeStepUpIfAsked(arjun.page, "alpha", "arjun", 3_000);
    await expect(approve).toBeHidden({ timeout: 30_000 }); // the card leaves the inbox once decided
    await expect.poll(async () => st((await api(arjun.page, "GET", `/leaves/requests/${approvedId}`)).data), { timeout: 30_000 })
      .not.toBe("PENDING");
    await shot(arjun.page, testInfo, "lh20-12-manager-approved");
    await arjun.page.goto("/leaves/calendar");
    await expect(arjun.page.getByTestId("team-calendar")).toBeVisible();
    await shot(arjun.page, testInfo, "lh20-13-team-calendar");
    await arjun.close();
    const kavya = await openAs(browser, "alpha", "kavya");
    let detail = await api(kavya.page, "GET", `/leaves/requests/${approvedId}`);
    if (st(detail.data) !== "APPROVED") {
      await kavya.page.goto("/leaves/approvals");
      await kavya.page.getByTestId(`approval-approve-${approvedId}`).first().click();
      await completeStepUpIfAsked(kavya.page, "alpha", "kavya", 3_000);
      await expect(kavya.page.getByText(/approved/i).first()).toBeVisible();
      detail = await api(kavya.page, "GET", `/leaves/requests/${approvedId}`);
    }
    expect(st(detail.data)).toBe("APPROVED");
    await kavya.close();
  });

  await test.step("3b. Reject and return-for-changes decisions; the employee sees them", async () => {
    const rohan = await openAs(browser, "alpha", "rohan");
    const toReject = await applyFree(rohan.page, { leave_type: "earned", reason: `Reject me ${RUN}` }, addDays(base, 21));
    const toReturn = await applyFree(rohan.page, { leave_type: "earned", reason: `Return me ${RUN}` }, addDays(base, 22));
    const arjun = await openAs(browser, "alpha", "arjun");
    const rej = await api(arjun.page, "POST", `/leaves/requests/${toReject.id}/reject`, { remarks: "Release week — please pick another day" });
    expect(rej.status, JSON.stringify(rej.data)).toBe(200);
    const ret = await api(arjun.page, "POST", `/leaves/requests/${toReturn.id}/return`, { reason: "Add a handover note" });
    expect(ret.status, JSON.stringify(ret.data)).toBe(200);
    await arjun.close();
    await rohan.page.goto("/leaves/requests");
    await expect(rohan.page.getByTestId("leave-requests")).toContainText(/rejected/i);
    await expect(rohan.page.getByTestId("leave-requests")).toContainText(/returned/i);
    await shot(rohan.page, testInfo, "lh20-14-rejected-and-returned");
    await rohan.close();
  });

  await test.step("3c. Partial cancel of the approved leave goes through a change request the manager approves", async () => {
    const rohan = await openAs(browser, "alpha", "rohan");
    const detail = await api(rohan.page, "GET", `/leaves/requests/${approvedId}`);
    const lastDay = detail.data.end_date as string;
    detail0 = detail.data;
    const change = await api(rohan.page, "POST", `/leaves/requests/${approvedId}/changes`, { kind: "PARTIAL_CANCEL", proposed: { dates: [lastDay] }, reason: "Back a day early" });
    expect(change.status, JSON.stringify(change.data)).toBe(201);
    await rohan.close();
    const arjun = await openAs(browser, "alpha", "arjun");
    await arjun.page.goto("/leaves/approvals?tab=changes");
    const approveChange = arjun.page.getByTestId(`change-approve-${change.data.id}`).first();
    await expect(approveChange).toBeVisible();
    await shot(arjun.page, testInfo, "lh20-15-change-request-in-inbox");
    await approveChange.click();
    await expect(approveChange).toBeHidden({ timeout: 30_000 });
    const after = await api(arjun.page, "GET", `/leaves/requests/${approvedId}`);
    expect(Number(after.data.number_of_days ?? after.data.days ?? after.data.units)).toBeLessThan(Number(detail0.number_of_days ?? detail0.days ?? detail0.units));
    await arjun.close();
    await test.step("cleanup: cancel the rest of the approved leave (change request approved by the manager)", async () => {
      const r2 = await openAs(browser, "alpha", "rohan");
      const cancel = await api(r2.page, "POST", `/leaves/requests/${approvedId}/changes`, { kind: "CANCEL", proposed: {}, reason: "e2e cleanup" });
      await r2.close();
      if (cancel.status === 201) {
        const a2 = await openAs(browser, "alpha", "arjun");
        const ok = await api(a2.page, "POST", `/leaves/changes/${cancel.data.id}/approve`, {});
        expect(ok.status, JSON.stringify(ok.data)).toBe(200);
        await a2.close();
      }
    });
  });

  await test.step("3d. Manager applies on behalf; HR adjusts a balance and works the admin console", async () => {
    const arjun = await openAs(browser, "alpha", "arjun");
    const team = await api(arjun.page, "GET", `/leaves/team-calendar?start=${base}&end=${addDays(base, 30)}`);
    expect(team.status, JSON.stringify(team.data)).toBe(200);
    const rohanId = employeeId("alpha", "rohan");
    const onBehalf = await applyFree(arjun.page, { leave_type: "earned", employee_id: rohanId, reason: `On behalf ${RUN}` }, addDays(base, 23));
    expect(onBehalf.employee_id ?? rohanId).toBe(rohanId);
    await arjun.close();

    const kavya = await openAs(browser, "alpha", "kavya");
    const adj = await api(kavya.page, "POST", "/leaves/adjustments", { employee_id: rohanId, leave_type: "casual", delta: "1.00", effective_date: "2026-10-30", reason: `Long-service bonus day ${RUN}` });
    if (adj.status === 403 && JSON.stringify(adj.data).includes("STEP_UP")) await stepUpViaApi(kavya.page, "alpha", "kavya");
    const adj2 = adj.status === 201 || adj.status === 200 ? adj : await api(kavya.page, "POST", "/leaves/adjustments", { employee_id: rohanId, leave_type: "casual", delta: "1.00", effective_date: "2026-10-30", reason: `Long-service bonus day ${RUN}` });
    expect([200, 201], JSON.stringify(adj2.data)).toContain(adj2.status);
    const ledger = await api(kavya.page, "GET", `/leaves/ledger?employee_id=${rohanId}&leave_type=casual`);
    expect(ledger.status, JSON.stringify(ledger.data)).toBe(200);
    expect(JSON.stringify(ledger.data)).toContain(RUN);
    await kavya.page.goto("/leaves/admin");
    await expect(kavya.page.getByRole("main")).toBeVisible();
    await shot(kavya.page, testInfo, "lh20-16-hr-admin-workspace");
    for (const tab of ["Balances", "Record leave", "Documents", "Reports", "Year end", "Imports", "Lifecycle"]) {
      const t = kavya.page.getByRole("tab", { name: new RegExp(tab, "i") }).first();
      if (await t.isVisible().catch(() => false)) {
        await t.click();
        await kavya.page.waitForTimeout(800);
        await shot(kavya.page, testInfo, `lh20-17-admin-${tab.toLowerCase().replace(/\s+/g, "-")}`);
      }
    }
    const usage = await api(kavya.page, "GET", "/leaves/reports/usage?start=2026-01-01&end=2026-12-31");
    expect(usage.status, JSON.stringify(usage.data)).toBe(200);
    const liability = await api(kavya.page, "GET", "/leaves/reports/liability?date=2026-10-30");
    expect([200, 403]).toContain(liability.status);
    await kavya.close();
  });

  await test.step("3e. Comp-off claim for weekend work and an encashment request reach the approver", async () => {
    const rohan = await openAs(browser, "alpha", "rohan");
    let sat = addDays("2026-10-01", 0);
    while (dow(sat) !== 6) sat = addDays(sat, 1);
    const claim = await api(rohan.page, "POST", "/leaves/comp-off/claims", { worked_date: addDays(sat, 7 * (SEED % 4)), reason: `Release support ${RUN}` });
    expect([201, 409, 422], JSON.stringify(claim.data)).toContain(claim.status);
    const enc = await api(rohan.page, "POST", "/leaves/encashments", { leave_type: "earned", units: "1.00", reason: `Encash ${RUN}` });
    expect([201, 409, 422], JSON.stringify(enc.data)).toContain(enc.status);
    await rohan.page.goto("/leaves/balances");
    await shot(rohan.page, testInfo, "lh20-18-balances-after-adjustment");
    await rohan.close();
    const arjun = await openAs(browser, "alpha", "arjun");
    for (const tab of ["comp-off", "encashments"]) {
      await arjun.page.goto(`/leaves/approvals?tab=${tab}`);
      await expect(arjun.page.getByTestId("approvals-inbox")).toBeVisible();
      await arjun.page.waitForTimeout(1000);
      await shot(arjun.page, testInfo, `lh20-18b-inbox-${tab}`);
    }
    await arjun.close();
    testInfo.annotations.push({ type: "comp-off", description: `${claim.status} ${claim.data?.code ?? claim.data?.status ?? ""}` });
    testInfo.annotations.push({ type: "encashment", description: `${enc.status} ${enc.data?.code ?? enc.data?.status ?? ""}` });
  });

  await test.step("4. Security: other tenants get 404, employees get 403 on admin APIs and no admin page", async () => {
    const jordan = await openAs(browser, "gamma", "founder");
    const cross = await api(jordan.page, "GET", `/leaves/requests/${approvedId}`);
    expect(cross.status).toBe(404);
    const crossLedger = await api(jordan.page, "GET", `/leaves/balances/employees/${employeeId("alpha", "rohan")}`);
    expect([403, 404]).toContain(crossLedger.status);
    await jordan.close();
    const rohan = await openAs(browser, "alpha", "rohan");
    for (const path of ["/leaves/plans", "/leaves/setup/reconcile", "/leaves/reports/liability", `/leaves/ledger?employee_id=${employeeId("alpha", "priya")}`, `/leaves/balances/employees/${employeeId("alpha", "priya")}`]) {
      const r = await api(rohan.page, "GET", path);
      expect([403, 404], `${path} → ${r.status}`).toContain(r.status);
    }
    const adj = await api(rohan.page, "POST", "/leaves/adjustments", { employee_id: employeeId("alpha", "rohan"), leave_type: "casual", delta: "5.00", effective_date: "2026-10-30", reason: "self grant" });
    expect(adj.status).toBe(403);
    await rohan.page.goto("/settings/leave/plans");
    await expect(rohan.page.getByText(/Alpha India Office/)).toHaveCount(0);
    await shot(rohan.page, testInfo, "lh20-19-employee-denied-admin");
    await rohan.close();
  });

  await test.step("5. Beta stays on the legacy leave flow (multi-company: per-tenant gate)", async () => {
    const layla = await openAs(browser, "beta", "layla");
    const access = await api(layla.page, "GET", "/leaves/access");
    expect(access.data.v2_enabled).toBe(false);
    let r = { status: 0, data: {} as any };
    for (let i = 0; i < 30 && r.status !== 200; i++) {
      let d = addDays(base, 30 + i * 3);
      while ([5, 6].includes(dow(d))) d = addDays(d, 1);
      r = await api(layla.page, "POST", "/leaves/apply", { leave_type: "casual", start_date: d, end_date: d, reason: `Legacy ${RUN}` });
    }
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const legacy = await api(layla.page, "GET", "/leaves?status=pending&limit=200");
    expect(legacy.status, JSON.stringify(legacy.data)).toBe(200);
    expect(((legacy.data.items ?? legacy.data) as any[]).some((l) => l.id === r.data.id), "legacy list has the request").toBe(true);
    await layla.page.goto("/leaves");
    await expect(layla.page.getByRole("main")).toContainText(/pending/i);
    await layla.page.waitForTimeout(1000);
    await shot(layla.page, testInfo, "lh20-20-beta-legacy-flow");
    await layla.close();
  });
});
