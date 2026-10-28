/**
 * G-07 / AS-M3 Chrome checks (AS 13 §4.6 exit 5; seed tenancy plan §2.2: Alpha is cut over at the end of G-07, Beta
 * stays LEGACY) on the time stack 8500/3500.
 * (a) Kavya (HR admin) opens Attendance › Attendance setup, prepares and reconciles a past window of Alpha; the report
 *     shows its days and differences; she cannot approve her own reconcile. Ananya Rao (founder, a second administrator)
 *     switches attendance v2 on with "Confirm it's you"; the card reads "Attendance v2: active".
 * (b) Kavya evaluates yesterday for Alpha (recompute), opens Attendance › Exceptions and, from a row, the evaluated day
 *     (result, halves, history).
 * (c) Beta (v1) has no Exceptions menu and its evaluated-day URL renders "not found" (spine §15.7).
 * Rerun-safe: when Alpha is already V2_ACTIVE, (a) checks the active card and skips the switch.
 */
import type { Page } from "@playwright/test";

import { completeStepUpIfAsked } from "../e2e-lh/step-up";

import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

function localDay(offset = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400 * 1000); // Asia/Kolkata (Alpha HQ)
  return now.toISOString().slice(0, 10);
}

/** Opens the Attendance menu group (its sub-pages render only while open) and returns its sub-page list. */
async function attendanceMenu(page: Page) {
  const toggle = page.getByRole("button", { name: /(show|hide) attendance pages/i }).first();
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return page.getByRole("list", { name: "Attendance" }).first();
}

async function setupStatus(page: Page) {
  const r = await api(page, "GET", "/attendance/setup/status");
  expect(r.status).toBe(200);
  return r.data as { state: string; prepared: boolean; last_reconcile: any };
}

test("(a) prepare, reconcile and a second administrator switches Alpha to attendance v2", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance");
  await (await attendanceMenu(page)).getByRole("link", { name: "Attendance setup" }).click();
  await expect(page.getByTestId("attendance-cutover")).toBeVisible();
  const before = await setupStatus(page);
  if (before.state === "V2_ACTIVE") {
    await expect(page.getByTestId("cutover-state")).toHaveText(/Attendance v2: active/);
    await shot(page, testInfo, "07a-already-active");
    return;
  }
  if (!before.prepared) {
    await page.getByRole("button", { name: /^Prepare$/ }).click();
    await expect(page.getByRole("button", { name: /^Prepared$/ })).toBeVisible();
  }
  await page.getByLabel("From", { exact: true }).fill(localDay(-14));
  await page.getByLabel("To", { exact: true }).fill(localDay(-1));
  const previous = (await setupStatus(page)).last_reconcile?.job_id ?? 0;
  await page.getByRole("button", { name: /^Reconcile$/ }).click();
  await expect.poll(async () => {
    const last = (await setupStatus(page)).last_reconcile;
    return last && last.job_id > previous ? last.status : "WAITING";
  }, { timeout: 240_000, intervals: [2_000] }).toBe("SUCCEEDED");
  await page.reload();
  const report = page.getByTestId("reconcile-report");
  await expect(report).toContainText(/differences/);
  const status = await setupStatus(page);
  expect(status.last_reconcile.differences).toBe(0);
  // The maker never approves (exit 4): the switch stays disabled for Kavya.
  await expect(page.getByRole("button", { name: /switch on attendance v2/i })).toBeDisabled();
  await expect(page.getByText(/another administrator approves the switch/i)).toBeVisible();
  await shot(page, testInfo, "07a-reconciled-by-kavya");

  const founder = await openAs(browser, "alpha", "founder");
  try {
    await founder.page.goto("/settings/attendance/overview");
    const button = founder.page.getByRole("button", { name: /switch on attendance v2/i });
    await expect(button).toBeEnabled();
    await button.click();
    await completeStepUpIfAsked(founder.page, "alpha", "founder");
    await expect(founder.page.getByTestId("cutover-state")).toHaveText(/Attendance v2: active/, { timeout: 30_000 });
    await shot(founder.page, testInfo, "07a-v2-active-by-ananya");
  } finally {
    await founder.close();
  }
});

test("(b) exceptions and the evaluated day for Alpha", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  const yesterday = localDay(-1);
  const people = ["asha", "vikram", "kiran"].map((p) => employeeId("alpha", p));
  const recompute = await api(page, "POST", "/attendance/days/recompute",
                              { employee_ids: people, start: localDay(-7), end: yesterday, reason: "G-07 Chrome check" });
  expect(recompute.status).toBe(200);
  await page.goto("/attendance");
  await (await attendanceMenu(page)).getByRole("link", { name: "Exceptions" }).click();
  const view = page.getByTestId("attendance-exceptions");
  await expect(view).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill(localDay(-7));
  await page.getByLabel("To", { exact: true }).fill(yesterday);
  // Rows link to the evaluated day; the list is loaded once a row (or the empty state) shows.
  const rows = view.getByRole("link").filter({ hasText: /\S/ });
  await expect(rows.first().or(view.getByText("No exceptions in this range.")).first()).toBeVisible();
  const listed = await api(page, "GET", `/attendance/exceptions?start=${localDay(-7)}&end=${yesterday}&limit=200`);
  expect(listed.status).toBe(200);
  expect(listed.data.total).toBeGreaterThan(0);
  await expect(rows.first()).toBeVisible();
  await shot(page, testInfo, "07b-exceptions");

  const first = listed.data.items[0];
  await rows.first().click();
  await page.waitForURL(/\/attendance\/days\/\d+\/\d{4}-\d{2}-\d{2}/);
  const day = page.getByTestId("attendance-day");
  await expect(day).toBeVisible();
  await expect(day.getByTestId("day-result")).toBeVisible();
  await expect(day.getByText("First half")).toBeVisible();
  await expect(day.getByText("History")).toBeVisible();
  expect(first.exception_codes.length).toBeGreaterThan(0);
  await shot(page, testInfo, "07b-evaluated-day");
});

test("(d) Kavya drafts standard attendance rules and previews their impact (no activation)", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/overview");
  await page.getByRole("link", { name: "Attendance rules" }).click();
  const editor = page.getByTestId("attendance-rules-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Name", { exact: true }).fill(`G-07 preview ${Date.now()}`);
  await editor.getByLabel("Effective from", { exact: true }).fill(localDay(-14));
  await editor.getByLabel("Thresholds", { exact: true }).selectOption("ABSOLUTE");
  await editor.getByLabel("Full day (minutes)", { exact: true }).fill("450");
  await editor.getByLabel("Half day (minutes)", { exact: true }).fill("240");
  await editor.getByRole("button", { name: /save draft and preview impact/i }).click();
  const preview = page.getByTestId("rules-preview");
  await expect(preview).toBeVisible({ timeout: 120_000 });
  await expect(preview).toContainText(/covers \d+ people/);
  await expect(preview.getByRole("button", { name: "Activate" })).toBeVisible();
  await shot(page, testInfo, "07d-rules-preview");
});

test("(c) Beta stays on attendance v1: no Exceptions menu, evaluated days are not found", async ({ page }, testInfo) => {
  await signIn(page, "beta", "mariam");
  const status = await setupStatus(page);
  expect(status.state).not.toBe("V2_ACTIVE");
  await page.goto("/attendance");
  const menu = await attendanceMenu(page);
  await expect(menu.getByRole("link", { name: "Attendance setup" })).toBeVisible();  // the group is open
  await expect(menu.getByRole("link", { name: "Exceptions" })).toHaveCount(0);
  const someone = employeeId("beta", "mariam");
  await page.goto(`/attendance/days/${someone}/${localDay(-1)}`);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await shot(page, testInfo, "07c-beta-v1-not-found");
});
