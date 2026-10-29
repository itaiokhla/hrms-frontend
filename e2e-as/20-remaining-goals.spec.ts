/**
 * Remaining attendance goals in real Chrome on the time stack (8500/3500): G-24 channels / push / calendar feed /
 * service worker, manager-prepared team payroll with files and maker-checker commit, contractor invoices from approved
 * timesheets, payroll-cost invoices, G-22 country packs and industry templates, G-23 readiness + acceptance and a real
 * per-tenant cut-over (Gamma, US), and G-15 notice-period consent on an open-shift claim.
 *
 * (a) Kavya adds a signed webhook channel (to a receiver this test runs), tests it, checks the HMAC signature with the
 *     secret the page reveals, reads the delivery log, pauses / resumes; a WhatsApp slot reports "provider pending".
 * (b) Arjun (manager, no payroll codes) prepares pay inputs for Priya with a PDF and submits; the channel receives
 *     team_batch.submitted. Karan (payroll) returns it with a note; Arjun edits and resubmits; Karan approves and the
 *     line becomes an approved wage input.
 * (c) Arjun drafts a contractor invoice for Nitin from his approved week (hours × rate).
 * (d) Rahul and Sunil hold the finance role: Rahul issues Nitin's invoice, Sunil approves it. Rahul drafts a
 *     payroll-cost invoice of the finalized "E2E cost run" (fee + GST); he cannot issue his own; Sunil issues it,
 *     downloads the PDF and voids it with a reason.
 * (e) Kavya: Readiness & country rules — go-live checklist, acceptance run, India pack applied then released, an
 *     industry template creates draft policies.
 * (f) Gamma (US): the founder prepares and reconciles, Emily (second administrator) switches on attendance v2; the
 *     founder applies the US pack, switches on open shifts, posts an open shift inside the 14-day notice window;
 *     Jordan claims it and must agree in the consent dialog; the Fair Workweek estimate runs.
 * (g) Ravi: My schedule calendar link (served without a session, revoked = 404), browser notifications card; the
 *     service worker is active and /punch opens offline.
 * (h) The approvals inbox offers Shift requests and Team payroll.
 * Data for (b)–(d) comes from hrms-backend/scripts/seed_remaining_goals_e2e.py (idempotent; run here first).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";

import { request as pwRequest, type Page } from "@playwright/test";

import { completeStepUpIfAsked } from "../e2e-lh/step-up";
import { BACKEND, api, employeeId, expect, openAs, shot, signIn, store, test } from "./support";

test.describe.configure({ mode: "serial" });

const received: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
let server: http.Server;
let hookUrl = "";
let seed: { contractor: { employee_id: number; timesheet_id: number; week: string }; cost_run_id: number };
const STAMP = Date.now().toString(36);

test.beforeAll(async () => {
  const out = execFileSync(path.join(BACKEND, "venv", "Scripts", "python.exe"), ["scripts/seed_remaining_goals_e2e.py"],
    { cwd: BACKEND, env: { ...process.env, E2E_PG_DATA: ".local-postgres-time" }, encoding: "utf8" });
  seed = JSON.parse(out.trim().split("\n").pop()!);
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(200); res.end("ok"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hookUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/hrms-hook`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const eventsReceived = () => received.map((r) => { try { return JSON.parse(r.body.toString()).event as string; } catch { return ""; } });

async function channelId(page: Page, name: string): Promise<number> {
  const r = await api(page, "GET", "/integrations/channels");
  return (r.data.items as { id: number; name: string }[]).find((c) => c.name === name)!.id;
}

async function packEntity(page: Page, country: string): Promise<number> {
  const r = await api(page, "GET", "/attendance/packs");
  return (r.data.items as { legal_entity_id: number; country: string }[]).find((e) => e.country === country)!.legal_entity_id;
}

async function batchByTitle(page: Page, title: string) {
  const r = await api(page, "GET", "/payroll/team/batches?box=mine");
  return (r.data.items as { id: number; title: string; status: string }[]).find((b) => b.title === title)!;
}

test("(a) Kavya connects a signed webhook channel and verifies its signature", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("integrations")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("channel-new").click();
  await page.getByTestId("channel-kind").selectOption("WEBHOOK");
  await page.getByTestId("channel-name").fill(`Ops hook ${STAMP}`);
  await page.getByTestId("channel-url").fill(hookUrl);
  await page.getByTestId("channel-event-team_batch.submitted").check();
  await shot(page, testInfo, "20a-channel-form");
  await page.getByTestId("channel-save").click();
  await expect(page.getByText("Channel added").first()).toBeVisible();
  const id = await channelId(page, `Ops hook ${STAMP}`);
  const card = page.getByTestId(`channel-${id}`);
  const before = received.length;
  await page.getByTestId(`channel-test-${id}`).click();
  await expect(page.getByText("Test message delivered").first()).toBeVisible({ timeout: 30_000 });
  expect(received.length).toBe(before + 1);
  await page.getByTestId(`channel-secret-${id}`).click();
  const secret = (await page.getByTestId("channel-secret-value").textContent())!.trim();
  const last = received[received.length - 1];
  const stamp = String(last.headers["x-hrms-timestamp"]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${stamp}.`).update(last.body).digest("hex");
  expect(last.headers["x-hrms-signature"]).toBe(expected);
  expect(JSON.parse(last.body.toString()).event).toBe("channel.test");
  await shot(page, testInfo, "20a-signing-secret");
  await page.keyboard.press("Escape");
  await page.getByTestId(`channel-log-${id}`).click();
  await expect(page.getByTestId("delivery-log")).toContainText("sent");
  await shot(page, testInfo, "20a-delivery-log");
  await page.keyboard.press("Escape");
  await page.getByTestId(`channel-pause-${id}`).click();
  await expect(card.getByTestId("channel-state")).toHaveText("Paused");
  await page.getByTestId(`channel-pause-${id}`).click();
  await expect(card.getByTestId("channel-state")).toHaveText("Active");
  // WhatsApp is a provider slot only.
  await page.getByTestId("channel-new").click();
  await page.getByTestId("channel-kind").selectOption("WHATSAPP");
  await page.getByTestId("channel-name").fill(`WA ${STAMP}`);
  await page.getByTestId("channel-save").click();
  await expect(page.getByText("Channel added").first()).toBeVisible();
  const waId = await channelId(page, `WA ${STAMP}`);
  await expect(page.getByTestId(`channel-${waId}`).getByTestId("channel-state")).toHaveText("Provider pending");
  await page.getByTestId(`channel-test-${waId}`).click();
  await expect(page.getByText(/No WhatsApp provider/).first()).toBeVisible();
  await page.getByTestId(`channel-delete-${waId}`).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Channel removed").first()).toBeVisible();
  await shot(page, testInfo, "20a-channels");
  // A plain employee cannot open integrations.
  const ravi = await openAs(page.context().browser()!, "alpha", "ravi");
  expect((await api(ravi.page, "GET", "/integrations/channels")).status).toBe(403);
  await ravi.close();
});

test("(b) Arjun prepares pay inputs with a file; payroll returns, then commits them", async ({ browser }, testInfo) => {
  const title = `Diwali incentives ${STAMP}`;
  const arjun = await openAs(browser, "alpha", "arjun");
  const page = arjun.page;
  expect((await api(page, "GET", "/payroll/wage-inputs")).status).toBe(403);  // managers hold no payroll codes
  await page.goto("/payroll/team-inputs");
  await expect(page.getByTestId("team-payroll")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("team-list")).toContainText("Priya Shah");
  await expect(page.getByTestId("team-list")).toContainText("Pay amounts are hidden");
  await shot(page, testInfo, "20b-team-view");
  await page.getByTestId("batch-new").click();
  await page.getByTestId("batch-title").fill(title);
  await page.getByTestId("line-employee-0").selectOption(String(employeeId("alpha", "priya")));
  await page.getByTestId("line-component-0").selectOption("INCENTIVE");
  await page.getByTestId("line-amount-0").fill("1500.00");
  await page.getByTestId("line-reason-0").fill("Festival target met");
  await page.getByTestId("batch-add-line").click();
  await page.getByTestId("line-employee-1").selectOption(String(employeeId("alpha", "rohan")));
  await page.getByTestId("line-component-1").selectOption("BONUS");
  await page.getByTestId("line-amount-1").fill("800.00");
  await page.getByTestId("line-reason-1").fill("Weekend release support");
  await shot(page, testInfo, "20b-batch-editor");
  await page.getByTestId("batch-save").click();
  await expect(page.getByTestId("batch-sheet")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("batch-file-input").setInputFiles({ name: "targets.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e targets") });
  await expect(page.getByTestId("batch-files")).toContainText("targets.pdf");
  const before = eventsReceived().filter((e) => e === "team_batch.submitted").length;
  await page.getByTestId("batch-submit").click();
  await expect(page.getByTestId("batch-sheet-status")).toHaveText("Waiting for payroll");
  await shot(page, testInfo, "20b-submitted");
  await expect.poll(() => eventsReceived().filter((e) => e === "team_batch.submitted").length, { timeout: 60_000 }).toBeGreaterThan(before);
  const batch = await batchByTitle(page, title);

  const karan = await openAs(browser, "alpha", "karan");
  await karan.page.goto(`/payroll/team-inputs?tab=approvals`);
  await karan.page.getByTestId(`batch-${batch.id}`).click();
  await expect(karan.page.getByTestId("batch-lines")).toContainText("Priya Shah");
  await expect(karan.page.getByTestId("batch-files")).toContainText("targets.pdf");
  await karan.page.getByTestId("batch-return").click();
  await karan.page.getByTestId("batch-decide-note").fill("Split the incentive: 1750 for Priya");
  await karan.page.getByTestId("batch-decide-confirm").click();
  await expect(karan.page.getByTestId("batch-sheet-status")).toHaveText("Returned to you");
  await shot(karan.page, testInfo, "20b-returned-by-karan");

  await page.goto(`/payroll/team-inputs?tab=batches&batch=${batch.id}`);
  await expect(page.getByTestId("batch-sheet-status")).toHaveText("Returned to you");
  await expect(page.getByTestId("batch-sheet")).toContainText("1750 for Priya");
  await page.getByTestId("batch-edit").click();
  await page.getByTestId("line-amount-0").fill("1750.00");
  await page.getByTestId("batch-save").click();
  await expect(page.getByTestId("batch-sheet")).toBeVisible();
  await page.getByTestId("batch-submit").click();
  await expect(page.getByTestId("batch-sheet-status")).toHaveText("Waiting for payroll");

  await karan.page.goto(`/payroll/team-inputs?tab=approvals&batch=${batch.id}`);
  await karan.page.getByTestId("batch-approve").click();
  await completeStepUpIfAsked(karan.page, "alpha", "karan");
  await expect(karan.page.getByTestId("batch-sheet-status")).toHaveText("Committed to payroll", { timeout: 30_000 });
  await expect(karan.page.getByTestId("batch-lines")).toContainText("Wage input #");
  await shot(karan.page, testInfo, "20b-committed");
  const inputs = await api(karan.page, "GET", `/payroll/wage-inputs?employee_id=${employeeId("alpha", "priya")}&limit=50`);
  expect(JSON.stringify(inputs.data)).toContain("1750.00");
  await karan.close();
  await arjun.close();
});

test("(c) Arjun drafts a contractor invoice from Nitin's approved week", async ({ browser }, testInfo) => {
  const arjun = await openAs(browser, "alpha", "arjun");
  const page = arjun.page;
  await page.goto("/payroll/team-inputs?tab=invoices");
  await page.getByTestId("invoice-new").click();
  await page.getByTestId("invoice-payee").selectOption(String(seed.contractor.employee_id));
  await page.getByTestId(`invoice-week-${seed.contractor.timesheet_id}`).check();
  await page.getByTestId("invoice-rate").fill("500");
  await page.getByTestId("invoice-external").fill(`NITIN-${STAMP}`);
  await shot(page, testInfo, "20c-invoice-form");
  await page.getByTestId("invoice-save").click();
  await expect(page.getByText("Invoice drafted; payroll issues it").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("team-invoices")).toContainText("Nitin Gowda");
  await expect(page.getByTestId("team-invoices")).toContainText(/8,000\.00|8000\.00/);
  await shot(page, testInfo, "20c-invoice-drafted");
  await arjun.close();
});

async function grantFinance(page: Page, person: "rahul" | "sunil") {
  const userId = store().companies.alpha.ids.people[person].user_id;
  const roles = (await api(page, "GET", "/roles")).data as { id: number; system_key: string | null }[];
  const finance = roles.find((r) => r.system_key === "finance_payments")!;
  const user = (await api(page, "GET", `/users/${userId}`)).data as { roles: { id: number }[] };
  const ids = new Set(user.roles.map((r) => r.id));
  if (!ids.has(finance.id)) {
    ids.add(finance.id);
    const r = await api(page, "PUT", `/users/${userId}/roles`, { role_ids: [...ids] });
    expect(r.status).toBe(200);
  }
}

test("(d) finance issues and approves the invoice; a payroll-cost invoice is issued by a second person", async ({ browser }, testInfo) => {
  const founder = await openAs(browser, "alpha", "founder");
  await grantFinance(founder.page, "rahul");
  await grantFinance(founder.page, "sunil");
  await founder.close();
  const rahul = await openAs(browser, "alpha", "rahul");
  const sunil = await openAs(browser, "alpha", "sunil");
  const invoices = (await api(rahul.page, "GET", "/payroll/invoices?status=DRAFT&limit=200")).data.items as { id: number; external_number: string }[];
  const invoice = invoices.find((i) => i.external_number === `NITIN-${STAMP}`)!;
  expect(invoice).toBeTruthy();
  await rahul.page.goto("/payroll/invoices");
  await expect(rahul.page.getByTestId("contractor-invoices")).toBeVisible({ timeout: 30_000 });
  await rahul.page.getByTestId(`invoice-issue-${invoice.id}`).click();
  await completeStepUpIfAsked(rahul.page, "alpha", "rahul");
  await expect(rahul.page.getByTestId(`contractor-invoice-${invoice.id}`).getByTestId("contractor-invoice-status")).toHaveText("issued", { timeout: 30_000 });
  await shot(rahul.page, testInfo, "20d-invoice-issued");
  await sunil.page.goto("/payroll/invoices");
  await sunil.page.getByTestId(`invoice-approve-${invoice.id}`).click();
  await completeStepUpIfAsked(sunil.page, "alpha", "sunil");
  await expect(sunil.page.getByTestId(`contractor-invoice-${invoice.id}`).getByTestId("contractor-invoice-status")).toHaveText("approved", { timeout: 30_000 });
  await shot(sunil.page, testInfo, "20d-invoice-approved");

  // Payroll cost invoice of the finalized run.
  await rahul.page.goto("/payroll/invoices?tab=cost");
  await rahul.page.getByTestId("cost-new").click();
  await rahul.page.getByTestId("cost-run").selectOption(String(seed.cost_run_id));
  await expect(rahul.page.getByTestId("cost-groups")).toContainText("3 people");
  await rahul.page.getByTestId("cost-fee").fill("10");
  await rahul.page.getByTestId("cost-tax-label").fill("GST");
  await rahul.page.getByTestId("cost-tax-rate").fill("18");
  await rahul.page.getByTestId("cost-bill-name").fill(`Alpha client ${STAMP}`);
  await shot(rahul.page, testInfo, "20d-cost-form");
  await rahul.page.getByTestId("cost-save").click();
  await expect(rahul.page.getByText(/Cost invoice drafted/).first()).toBeVisible({ timeout: 30_000 });
  const costs = (await api(rahul.page, "GET", `/payroll/cost-invoices?run_id=${seed.cost_run_id}`)).data.items as { id: number; status: string; total: string; bill_to: { name: string } }[];
  const cost = costs.find((c) => c.bill_to.name === `Alpha client ${STAMP}`)!;
  // 3 × (56,000 gross + 1,800 employer) = 173,400; +10 % fee = 190,740; +18 % GST = 225,073.20
  expect(cost.total).toBe("225073.20");
  await rahul.page.getByTestId(`cost-issue-${cost.id}`).click();
  await completeStepUpIfAsked(rahul.page, "alpha", "rahul");
  await expect(rahul.page.getByText(/Someone other than the preparer/).first()).toBeVisible();
  await sunil.page.goto("/payroll/invoices?tab=cost");
  await sunil.page.getByTestId(`cost-issue-${cost.id}`).click();
  await completeStepUpIfAsked(sunil.page, "alpha", "sunil");
  const card = sunil.page.getByTestId(`cost-invoice-${cost.id}`);
  await expect(card.getByTestId("cost-status")).toHaveText("issued", { timeout: 30_000 });
  await expect(card).toContainText(/CINV-\d{4}-\d{4}/);
  const pdf = await sunil.page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: "include" });
    return { status: r.status, type: r.headers.get("content-type"), head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 4)) };
  }, `/api/v1/payroll/cost-invoices/${cost.id}/pdf`);
  expect(pdf).toEqual({ status: 200, type: "application/pdf", head: "%PDF" });
  await shot(sunil.page, testInfo, "20d-cost-issued");
  await sunil.page.getByTestId(`cost-void-${cost.id}`).click();
  await sunil.page.getByTestId("cost-void-reason").fill("Client asked for a combined invoice");
  await sunil.page.getByTestId("cost-void-confirm").click();
  await completeStepUpIfAsked(sunil.page, "alpha", "sunil");
  await expect(card.getByTestId("cost-status")).toHaveText("void", { timeout: 30_000 });
  await shot(sunil.page, testInfo, "20d-cost-void");
  await rahul.close();
  await sunil.close();
});

test("(e) Kavya runs the go-live checklist, acceptance, country rules and an industry template", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/readiness");
  await expect(page.getByTestId("readiness-items")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("check-cutover")).toHaveAttribute("data-status", "PASS");
  await expect(page.getByTestId("check-shifts")).toHaveAttribute("data-status", "PASS");
  await page.getByTestId("acceptance-start").click();
  await expect(page.getByTestId("acceptance-status")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("acceptance-probes")).toContainText("approval engine accepts module shift_request");
  const ready = (await api(page, "GET", "/attendance/readiness")).data.summary.ready as boolean;
  if (ready) await expect(page.getByTestId("acceptance-sign")).toBeEnabled();
  else await expect(page.getByTestId("acceptance-sign")).toBeDisabled();
  await shot(page, testInfo, "20e-checklist-and-acceptance");

  await page.getByRole("tab", { name: "Country rules" }).click();
  const entity = page.getByTestId(`pack-${await packEntity(page, "IN")}`);
  await expect(entity).toContainText("Not verified");
  const toggle = entity.locator("[data-testid^='pack-toggle-']");
  for (const target of ["Applied", "Guidance only"]) {
    await toggle.click();
    await page.getByTestId("pack-reason").fill(`Chrome check ${target}`);
    await page.getByTestId("pack-confirm").click();
    await expect(entity.getByTestId("pack-adopted")).toHaveText(target, { timeout: 30_000 });
    await shot(page, testInfo, `20e-pack-${target.replace(" ", "-").toLowerCase()}`);
  }
  await page.getByRole("tab", { name: "Industry templates" }).click();
  const bundle = page.getByTestId("bundle-AE_RETAIL_SPLIT");
  if (await bundle.getByTestId("bundle-apply-AE_RETAIL_SPLIT").count()) {
    await bundle.getByTestId("bundle-apply-AE_RETAIL_SPLIT").click();
    await expect(page.getByText("Draft policies created").first()).toBeVisible();
  }
  await expect(bundle).toContainText("Drafts created");
  await shot(page, testInfo, "20e-bundles");
});

test("(f) Gamma: real cut-over, US pack, open shift claimed inside the notice window with consent", async ({ browser }, testInfo) => {
  const founder = await openAs(browser, "gamma", "founder");
  const fp = founder.page;
  const status = (await api(fp, "GET", "/attendance/setup/status")).data;
  if (status.state !== "V2_ACTIVE") {
    await fp.goto("/settings/attendance/overview");
    await expect(fp.getByTestId("attendance-cutover")).toBeVisible({ timeout: 30_000 });
    if (!status.prepared) {
      await fp.getByRole("button", { name: /^Prepare$/ }).click();
      await expect(fp.getByRole("button", { name: /^Prepared$/ })).toBeVisible({ timeout: 60_000 });
    }
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await fp.getByLabel("From", { exact: true }).fill(day(-7));
    await fp.getByLabel("To", { exact: true }).fill(day(-1));
    const previous = status.last_reconcile?.job_id ?? 0;
    await fp.getByRole("button", { name: /^Reconcile$/ }).click();
    await expect.poll(async () => {
      const last = (await api(fp, "GET", "/attendance/setup/status")).data.last_reconcile;
      return last && last.job_id > previous ? last.status : "WAITING";
    }, { timeout: 240_000, intervals: [2_000] }).toBe("SUCCEEDED");
    expect((await api(fp, "GET", "/attendance/setup/status")).data.last_reconcile.differences).toBe(0);
    await shot(fp, testInfo, "20f-gamma-reconciled");
    // Emily becomes the second administrator and approves the switch.
    const emilyUser = store().companies.gamma.ids.people.emily.user_id;
    const roles = (await api(fp, "GET", "/roles")).data as { id: number; system_key: string | null }[];
    const hr = roles.find((r) => r.system_key === "hr_admin")!;
    const current = (await api(fp, "GET", `/users/${emilyUser}`)).data.roles.map((r: { id: number }) => r.id);
    if (!current.includes(hr.id)) expect((await api(fp, "PUT", `/users/${emilyUser}/roles`, { role_ids: [...current, hr.id] })).status).toBe(200);
    const emily = await openAs(browser, "gamma", "emily");
    await emily.page.goto("/settings/attendance/overview");
    const button = emily.page.getByRole("button", { name: /switch on attendance v2/i });
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    await completeStepUpIfAsked(emily.page, "gamma", "emily");
    await expect(emily.page.getByTestId("cutover-state")).toHaveText(/Attendance v2: active/, { timeout: 30_000 });
    await shot(emily.page, testInfo, "20f-gamma-v2-by-emily");
    await emily.close();
  }
  // US pack.
  await fp.goto("/settings/attendance/readiness?tab=packs");
  const pack = fp.getByTestId(`pack-${await packEntity(fp, "US")}`);
  if ((await pack.getByTestId("pack-adopted").textContent()) !== "Applied") {
    await pack.locator("[data-testid^='pack-toggle-']").click();
    await fp.getByTestId("pack-reason").fill("Fair Workweek for the New York stores");
    await fp.getByTestId("pack-confirm").click();
  }
  await expect(pack.getByTestId("pack-adopted")).toHaveText("Applied", { timeout: 30_000 });
  await expect(pack).toContainText("14 days, consent for late additions");
  await shot(fp, testInfo, "20f-us-pack");
  // Open shifts on, any team in the branch.
  await fp.goto("/settings/attendance/shift-requests");
  await expect(fp.getByTestId("shift-request-settings")).toBeVisible({ timeout: 30_000 });
  for (const id of ["srs-requests", "srs-open"]) {
    if ((await fp.getByTestId(id).getAttribute("aria-checked")) !== "true") await fp.getByTestId(id).click();
  }
  if ((await fp.getByTestId("srs-same-team").getAttribute("aria-checked")) === "true") await fp.getByTestId("srs-same-team").click();
  if (await fp.getByTestId("srs-save").isEnabled()) {
    await fp.getByTestId("srs-save").click();
    await expect(fp.getByText("Shift request settings saved").first()).toBeVisible();
  }
  // The next weekend day (Jordan is off) without an open shift of ours, inside 14 days.
  const existing = (await api(fp, "GET", "/open-shifts")).data.items as { shift_date: string }[];
  let date = "";
  for (let n = 2; n < 13 && !date; n++) {
    const d = new Date(Date.now() + n * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    if ((d.getUTCDay() === 0 || d.getUTCDay() === 6) && !existing.some((s) => s.shift_date === iso)) date = iso;
  }
  test.skip(!date, "every weekend day inside the notice window already has an open shift (rerun next week)");
  await fp.goto("/rosters/my-schedule?tab=open");
  await fp.getByTestId("open-shift-post").click();
  await fp.getByTestId("open-shift-branch").selectOption({ label: "Gamma Manhattan Store" });
  await fp.getByTestId("open-shift-date").fill(date);
  await fp.getByTestId("open-shift-shift").selectOption({ label: "NY-OPEN" });
  await fp.getByTestId("open-shift-form").getByRole("checkbox").uncheck();
  await fp.getByTestId("open-shift-submit").click();
  await expect(fp.getByText("Open shift posted").first()).toBeVisible({ timeout: 30_000 });
  const posted = ((await api(fp, "GET", "/open-shifts")).data.items as { id: number; shift_date: string }[]).find((s) => s.shift_date === date)!;

  const jordan = await openAs(browser, "gamma", "jordan");
  await jordan.page.goto("/rosters/my-schedule?tab=open");
  await jordan.page.getByTestId(`claim-${posted.id}`).click();
  const warnings = jordan.page.getByTestId("warnings-confirm");
  const consent = jordan.page.getByTestId("consent-dialog");
  await expect(warnings.or(consent)).toBeVisible({ timeout: 30_000 });
  if (await warnings.isVisible()) await warnings.click();
  await expect(consent).toBeVisible({ timeout: 30_000 });
  await expect(jordan.page.getByTestId("consent-confirm")).toBeDisabled();
  await shot(jordan.page, testInfo, "20f-consent-dialog");
  await jordan.page.getByTestId("consent-check").check();
  await jordan.page.getByTestId("consent-confirm").click();
  await expect(jordan.page.getByText("The shift is yours").first()).toBeVisible({ timeout: 30_000 });
  const mine = (await api(jordan.page, "GET", "/shift-requests?box=mine")).data.items as { open_shift_id: number; status: string }[];
  expect(mine.find((r) => r.open_shift_id === posted.id)?.status).toBe("APPROVED");
  await shot(jordan.page, testInfo, "20f-claimed");
  await jordan.close();

  await fp.goto("/settings/attendance/readiness?tab=fww");
  await fp.getByTestId("fww-run").click();
  await expect(fp.getByTestId("fww-result")).toContainText("Predictability pay owed");
  await shot(fp, testInfo, "20f-fair-workweek");
  await founder.close();
});

test("(g) calendar feed, browser notifications, service worker and offline /punch", async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  await context.grantPermissions(["notifications"], { origin: test.info().project.use.baseURL as string });
  const page = await context.newPage();
  await signIn(page, "alpha", "ravi");
  await page.goto("/rosters/my-schedule");
  await expect(page.getByTestId("calendar-feed-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("feed-create").click();
  const url = (await page.getByTestId("feed-url").textContent())!.trim();
  expect(url).toMatch(/\/api\/v1\/calendar\/\d+\..+\.ics$/);
  const anonymous = await pwRequest.newContext();
  const feed = await anonymous.get(url);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(await feed.text()).toContain("BEGIN:VCALENDAR");
  await shot(page, testInfo, "20g-calendar-link");
  await page.getByTestId("feed-revoke").click();
  await expect(page.getByTestId("feed-state")).toHaveText("Off");
  expect((await anonymous.get(url)).status()).toBe(404);
  await anonymous.dispose();

  // Service worker + push.
  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15_000))]);
    return reg ? { scope: (reg as ServiceWorkerRegistration).scope, active: !!(reg as ServiceWorkerRegistration).active } : null;
  });
  expect(sw?.active).toBe(true);
  await page.getByTestId("push-toggle").click();
  const on = page.getByText("Browser notifications are on").first();
  const blocked = page.locator("[role=status]").filter({ hasText: /push|Registration|service|abort/i }).first();
  await expect(on.or(blocked)).toBeVisible({ timeout: 30_000 });
  testInfo.annotations.push({ type: "push", description: (await on.isVisible()) ? "subscribed through Chrome's push service" : "Chrome refused the push subscription in this environment" });
  await shot(page, testInfo, "20g-push");
  if (await on.isVisible()) {
    await page.getByTestId("push-test").click();
    await expect(page.getByText(/Test notification sent|Sent to no browser/).first()).toBeVisible();
    await page.getByTestId("push-toggle").click();
    await expect(page.getByTestId("push-state")).toHaveText("Off");
  }

  // Offline punch page through the service worker.
  await page.goto("/punch");
  await expect(page.getByTestId("punch-screen")).toBeVisible({ timeout: 30_000 });
  await page.reload();  // now controlled by the worker: the page and the session are cached
  await expect(page.getByTestId("punch-screen")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("punch-screen")).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "20g-punch-offline");
  await context.setOffline(false);
  await context.close();
});

test("(h) the approvals inbox offers shift requests and team payroll", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/approvals");
  const select = page.getByTestId("approvals-module");
  await expect(select.locator("option", { hasText: "Shift requests" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: "Team payroll" })).toHaveCount(1);
  await select.selectOption("shift_request");
  await expect(page).toHaveURL(/module=shift_request/);
  await shot(page, testInfo, "20h-approvals-modules");
});
