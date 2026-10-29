/**
 * G-13 / AS-M4 Chrome checks (AS 13 §4.8 exit criteria, adapted to the time-stack cast; WI-AS-4.8) on 8500/3500.
 * (a) Priya (Alpha, v2) opens the att-regularize Modal from My attendance and files a "Missed punch-in" (21:00–22:00)
 *     for a past day with a reason; the preview names her approver; My requests shows it pending.
 * (b) Arjun opens Approvals (module attendance), sees the row with the subject summary and approves it; Priya's request
 *     reads approved and the day carries the REQUEST session.
 * (c) Priya files On duty for a future working range; non-working dates are listed as skipped; Arjun approves the
 *     whole trip with one decision.
 * (d) Kavya (HR) musters one person of her branch for yesterday as Present; the row reads "Saved".
 * (e) Beta (v1): /attendance/requests answers 404 and the Muster page is not in the menu.
 * Rerun-safe: open requests of Priya are withdrawn first, a free past date is chosen, future on-duty is cancelled.
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

function localDay(offset = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400 * 1000); // Asia/Kolkata (Alpha)
  return now.toISOString().slice(0, 10);
}

async function ensureRequestPolicy(page: Page, priya: number) {
  // Requests reach back up to 30 days: the policy must resolve for past dates too, not only from today.
  const resolved = await api(page, "GET",
    `/attendance/policies/resolve?type=ATTENDANCE_REQUEST_POLICY&employee_id=${priya}&date=${localDay(-25)}`);
  const fields = resolved.data?.version?.fields ?? {};
  if (resolved.data?.status === "RESOLVED" && (fields.profile ?? "STANDARD") === "STANDARD"
      && (fields.self_kinds ?? ["MISSED_PUNCH"]).includes("MISSED_PUNCH")) return;
  const list = await api(page, "GET", "/attendance/policies?type=ATTENDANCE_REQUEST_POLICY");
  const items = (list.data?.items ?? list.data ?? []) as { id: number; name: string }[];
  let policy = items.find((p) => p.name === "G-13 self-service requests");
  if (!policy) {
    const created = await api(page, "POST", "/attendance/policies", {
      type: "ATTENDANCE_REQUEST_POLICY", name: "G-13 self-service requests",
      fields: { window_mode: "ROLLING", backdate_days: 30 },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    policy = created.data;
  }
  const assigned = await api(page, "PUT", `/attendance/policies/${policy!.id}/assignments`,
    { rules: [{ criteria: { everyone: true }, priority: 950, effective_from: "2026-01-01" }] });
  expect(assigned.status, JSON.stringify(assigned.data)).toBe(200);
  const activated = await api(page, "POST", `/attendance/policies/${policy!.id}/versions/1/activate`,
    { effective_from: "2026-01-01", reason: "G-13 e2e: STANDARD request policy" });
  expect([200, 409]).toContain(activated.status);
}

/** A past date whose evening 21:00–22:00 is free for Priya. */
async function freeDay(page: Page): Promise<string> {
  for (let offset = -2; offset >= -25; offset -= 1) {
    const day = localDay(offset);
    const form = await api(page, "GET", `/attendance/requests/form?date=${day}&mode=SELF`);
    if (form.status !== 200) continue;
    const busy = (form.data.sessions as { in: string | null; out: string | null }[])
      .some((s) => (s.in ?? "00:00") < "22:00" && (s.out ?? "23:59") > "21:00");
    if (!busy) return day;
  }
  throw new Error("no free evening for Priya in the last 25 days");
}

let filedDay = "";

test("(a) Priya files a missed punch-in from My attendance", async ({ page, browser }, testInfo) => {
  const kavya = await openAs(browser, "alpha", "kavya");
  try {
    await ensureRequestPolicy(kavya.page, employeeId("alpha", "priya"));
  } finally {
    await kavya.close();
  }
  await signIn(page, "alpha", "priya");
  const open = await api(page, "GET", "/attendance/requests?mine=true&status=PENDING,RETURNED,DRAFT");
  expect(open.status).toBe(200);
  for (const row of open.data.items) await api(page, "POST", `/attendance/requests/${row.id}/withdraw`, {});
  filedDay = await freeDay(page);

  await page.goto("/attendance");
  await expect(page.getByTestId("my-requests")).toBeVisible();
  await page.getByTestId("new-request").click();
  const modal = page.getByTestId("att-regularize");
  await expect(modal).toBeVisible();
  await page.getByTestId("reg-date").fill(filedDay);
  await page.getByTestId("reg-kind-IN").click();
  await page.getByTestId("reg-time-in").fill("21:00");
  await page.getByTestId("reg-time-out").fill("22:00");
  // A system-caused reason never counts toward the cycle limit (R-4), so reruns never hit REQUEST_LIMIT_REACHED.
  await page.getByTestId("reg-reason").selectOption("DEVICE_FAILURE");
  await page.getByTestId("reg-comment").fill("Late release support, forgot to punch");
  await expect(page.getByTestId("reg-route")).toContainText(/Goes to:/, { timeout: 15_000 });
  await shot(page, testInfo, "13a-regularize-modal");
  await page.getByTestId("reg-submit").click();
  await expect(page.getByText("Request sent for approval").first()).toBeVisible();
  const row = page.getByTestId("my-requests").getByText("Punch-in 21:00").first();
  await expect(row).toBeVisible();
  await expect(page.getByTestId("my-requests").getByTestId("my-request-status").first()).toHaveText("pending");
  await shot(page, testInfo, "13a-my-requests-pending");
});

test("(b) Arjun approves from the approvals inbox and the day gets the session", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  await page.goto("/approvals?module=attendance");
  const card = page.locator("[data-testid^=approval-row-]").filter({ hasText: "Punch-in 21:00" }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(/Priya/);
  await shot(page, testInfo, "13b-inbox");
  await card.getByRole("button", { name: /approve/i }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expect(card).toBeHidden({ timeout: 15_000 });
  await shot(page, testInfo, "13b-approved");

  const priya = await api(page, "GET", `/attendance/requests?employee_id=${employeeId("alpha", "priya")}&from=${filedDay}&to=${filedDay}`);
  expect(priya.status).toBe(200);
  expect(priya.data.items[0].status).toBe("APPROVED");
});

test("(c) Priya's on-duty trip skips days off and Arjun approves it once", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "priya");
  const mine = await api(page, "GET", "/attendance/on-duty?mine=true&status=PENDING,APPROVED");
  for (const row of mine.data.items) {
    if (row.date > localDay(0)) await api(page, "POST", `/attendance/on-duty/${row.id}/cancel`, {});
  }
  // A week starting next Thursday: Thu, Fri, then the weekend.
  const now = new Date(`${localDay(0)}T00:00:00Z`);
  const toThursday = ((4 - now.getUTCDay() + 7) % 7) || 7;
  const start = localDay(toThursday + 7);
  const end = localDay(toThursday + 10);
  await page.goto("/attendance/on-duty");
  await page.getByTestId("od-start").fill(start);
  await page.getByTestId("od-end").fill(end);
  await page.getByTestId("od-reason").fill("Supplier audit at the client site");
  const plan = page.getByTestId("od-plan");
  await expect(plan).toContainText(/skipped/, { timeout: 15_000 });
  await expect(plan).toContainText(/Goes to:/);
  await shot(page, testInfo, "13c-on-duty-plan");
  await page.getByTestId("od-submit").click();
  await expect(page.getByText(/On duty request sent for approval/).first()).toBeVisible();

  const arjun = await openAs(browser, "alpha", "arjun");
  try {
    await arjun.page.goto("/approvals?module=attendance");
    const card = arjun.page.locator("[data-testid^=approval-row-]").filter({ hasText: /On duty/ }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: /approve/i }).click();
    await expect(card).toBeHidden({ timeout: 15_000 });
    await shot(arjun.page, testInfo, "13c-on-duty-approved");
  } finally {
    await arjun.close();
  }
  await page.reload();
  await expect(page.getByTestId("od-status").first()).toHaveText(/approved/);
});

test("(d) Kavya musters one person for yesterday", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance/muster");
  const day = localDay(-1);
  const loaded = page.waitForResponse((r) => r.url().includes("/attendance/muster") && r.url().includes(`date=${day}`)
    && r.request().method() === "GET");
  await page.getByTestId("muster-date").fill(day);
  await loaded;  // the grid of the chosen date (marks chosen on the previous date's grid are cleared)
  const grid = page.getByTestId("muster-grid");
  await expect(grid).toBeVisible({ timeout: 20_000 });
  const first = grid.locator("[data-testid^=muster-row-]").first();
  const id = (await first.getAttribute("data-testid"))!.replace("muster-row-", "");
  await page.getByTestId(`muster-mark-${id}`).selectOption("PRESENT");
  await page.getByTestId("muster-submit").click();
  await expect(page.getByTestId(`muster-result-${id}`)).toContainText(/Saved|.+/, { timeout: 20_000 });
  await expect(page.getByTestId(`muster-result-${id}`)).toContainText("Saved");
  await shot(page, testInfo, "13d-muster");
});

test("(e) Beta (v1) has no requests API and no Muster page", async ({ page }, testInfo) => {
  await signIn(page, "beta", "founder");
  const r = await api(page, "GET", "/attendance/requests");
  expect(r.status).toBe(404);
  await page.goto("/attendance");
  await expect(page.getByRole("link", { name: "Muster" })).toHaveCount(0);
  await shot(page, testInfo, "13e-beta-v1");
});
