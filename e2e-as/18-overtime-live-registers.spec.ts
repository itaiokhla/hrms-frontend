/**
 * G-18 (AS-M8) overtime review and G-20 (AS-M9) live board + statutory registers, on the time stack 8500/3500.
 *
 * (a) Kavya opens Attendance › Live (`/attendance?tab=live`): tiles (expected, present, late, not yet in, absent…)
 *     reconcile with the list (count = list), a tile and the quick filters narrow the list, search finds a person.
 * (b) Priya files 30 min of overtime for yesterday; Arjun opens Overtime › Review with attendance, sees it beside the
 *     attendance figure, opens the context (attendance day, caps, consent) and approves it for payroll in one click.
 * (c) "Run proposals" answers with the proposal counts (the nightly job, run on demand).
 * (d) Kavya generates Form 25 and Form D in Reports › Attendance registers: the grid shows mark codes, the seal is
 *     shown, and the PDF / Excel downloads arrive.
 * (e) Arjun (no attendance:export) does not see the registers; Priya (SELF) gets 403 on the live board API.
 */
import { api, expect, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

let entryId = 0;

function yesterdayIst() {
  const d = new Date(Date.now() + 330 * 60_000 - 86_400_000);
  return d.toISOString().slice(0, 10);
}

test("(a) Kavya reads the live board: tiles reconcile with the list and filter it", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance?tab=live");
  const board = page.getByTestId("live-board");
  await expect(board).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("live-tile-expected")).toBeVisible();
  await expect(page.getByTestId("live-updated")).toContainText("Live");
  const data = await api(page, "GET", "/attendance/live-board?limit=100");
  expect(data.status).toBe(200);
  expect(data.data.consistency.expected_equals_present_plus_on_duty_plus_absent).toBe(true);
  const counted = Object.values(data.data.counts as Record<string, number>).reduce((a, b) => a + b, 0);
  expect(counted).toBe(data.data.total);
  await expect(page.getByTestId("live-tile-present_people-value")).toHaveText(
    data.data.tiles.find((t: { key: string }) => t.key === "present_people").value);
  await shot(page, testInfo, "18a-live-board");
  await page.getByTestId("live-quick-in_office").click();
  await expect(page.getByTestId("live-quick-in_office")).toHaveAttribute("aria-pressed", "true");
  await expect(async () => {  // the filtered page replaces the list after the refetch
    const statuses = await page.locator('[data-testid^="live-status-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    expect(statuses.every((s) => s === "WORKING" || s === "ON_LUNCH")).toBe(true);
  }).toPass({ timeout: 20_000 });
  await page.getByTestId("live-quick-in_office").click();
  await page.getByTestId("live-tile-off").click();
  await expect(page.getByTestId("live-tile-off")).toHaveAttribute("aria-pressed", "true");
  await shot(page, testInfo, "18a-live-board-off-filter");
  await page.getByTestId("live-tile-off").click();
  const first = data.data.items[0];
  if (first) {
    await page.getByTestId("live-search").fill(first.name.split(" ")[0]);
    await expect(page.getByRole("cell").getByTestId(`live-row-${first.employee_id}`)).toBeVisible();
  }
});

test("(b) Arjun reviews Priya's overtime with the attendance context and approves it for payroll", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "priya");
  const day = yesterdayIst();
  const filed = await api(page, "POST", "/overtime/entries", { date: day, minutes: 30, reason: "Release support (e2e)" });
  expect([201, 409]).toContain(filed.status);
  if (filed.status === 201) entryId = filed.data.id;
  await signIn(page, "alpha", "arjun");
  await page.goto("/overtime?tab=review");
  await expect(page.getByTestId("ot-review")).toBeVisible({ timeout: 30_000 });
  if (!entryId) {
    const queue = await api(page, "GET", "/attendance/overtime/queue?limit=100");
    entryId = queue.data.items[0]?.id ?? 0;
  }
  expect(entryId).toBeGreaterThan(0);
  const row = page.getByRole("cell").getByTestId(`ot-review-row-${entryId}`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId("ot-context")).toBeVisible();
  await expect(page.getByTestId("ot-consent")).toBeVisible();
  await shot(page, testInfo, "18b-overtime-context");
  await page.keyboard.press("Escape");
  await page.getByRole("cell").getByTestId(`ot-pay-${entryId}`).click();
  await expect(page.getByText("Approved for payroll")).toBeVisible();
  await expect(page.getByTestId(`ot-review-row-${entryId}`)).toHaveCount(0);
  const entry = await api(page, "GET", `/overtime/entries/${entryId}`);
  expect(entry.data.status).toBe("APPROVED");
  expect(entry.data.comp_off).toBe(false);
  await shot(page, testInfo, "18b-overtime-approved");
});

test("(c) Run proposals answers with the counts", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/overtime?tab=review");
  await expect(page.getByTestId("ot-review")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ot-run").click();
  await expect(page.getByText(/\d+ new, \d+ updated, \d+ new versions/)).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "18c-run-proposals");
});

test("(d) Kavya generates Form 25 and Form D with sealed downloads", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/reports/attendance");
  await expect(page.getByTestId("registers-hub")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("register-FORM_25").click();
  await page.getByTestId("register-generate").click();
  const preview = page.getByTestId("register-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("register-seal")).toContainText("Seal");
  await expect(page.getByTestId("register-grid")).toBeVisible();
  await shot(page, testInfo, "18d-form-25");
  const pdf = page.waitForEvent("download");
  await page.getByTestId("register-download-pdf").click();
  expect((await pdf).suggestedFilename()).toMatch(/^ATT_FORM_25_.*\.pdf$/);
  const xlsx = page.waitForEvent("download");
  await page.getByTestId("register-download-xlsx").click();
  expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByTestId("register-FORM_D").click();
  await page.getByTestId("register-generate").click();
  await expect(page.getByTestId("register-preview")).toContainText("Form D");
  await shot(page, testInfo, "18d-form-d");
});

test("(e) registers and the live board stay with their permissions", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  expect((await api(page, "GET", "/attendance/registers")).data.items).toEqual([]);
  expect((await api(page, "GET", "/attendance/registers/form-25?from=2026-10-01&to=2026-10-31&legal_entity_id=1")).status).toBe(403);
  await page.goto("/reports/attendance");
  await expect(page.getByTestId("registers-hub")).toHaveCount(0);
  await shot(page, testInfo, "18e-registers-denied");
  await signIn(page, "alpha", "priya");
  expect((await api(page, "GET", "/attendance/live-board")).status).toBe(403);
});
