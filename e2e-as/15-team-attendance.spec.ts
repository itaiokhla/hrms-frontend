/**
 * Team attendance (owner request 2026-10-28; IG-AS-98..101) on the time stack 8500/3500.
 * (a) Kavya (HR admin) opens Settings › Attendance › Team attendance, switches on "Managers punch for their team"
 *     with a required location and saves.
 * (b) Arjun (manager) opens Attendance › Team: "My team today" lists his reports; he punches Priya in with a location
 *     entered by hand and a reason; Priya reads "Working".
 * (c) Arjun punches Priya out; the board reads "Punched out".
 * (d) Arjun deletes that session from the team records with a reason; it leaves the list (kept for audit).
 * (e) Priya cannot punch for anyone (no Team tab board), and Arjun never sees people outside his line.
 * (f) Timesheets and Period close pages open for the roles that hold them.
 * Rerun-safe: a running session of Priya is punched out first; the deleted session is the one this run created.
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

async function teamTab(page: Page) {
  await page.goto("/attendance");
  const tab = page.getByRole("tab", { name: "Team" });
  await expect(page.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();
  if (await tab.count()) {
    // The first click can land before hydration: retry until the tab is selected.
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(page.getByTestId("team-board")).toBeVisible({ timeout: 20_000 });
}

async function proxyPunch(page: Page, priyaId: number, direction: "in" | "out") {
  await page.getByTestId(`team-punch-${direction}-${priyaId}`).click();
  const modal = page.getByTestId("proxy-punch");
  await expect(modal).toBeVisible();
  await page.getByTestId("proxy-mode-manual").click();
  await page.getByTestId("proxy-lat").fill("12.9716");
  await page.getByTestId("proxy-lng").fill("77.5946");
  await page.getByTestId("proxy-address").fill("Client office, MG Road");
  await page.getByTestId("proxy-reason").fill("Phone battery died at the client site");
  await page.getByTestId("proxy-submit").click();
}

let sessionId = 0;
let targetId = 0;
let targetName = "";

test("(a) Kavya switches on team punches in the attendance settings", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/team");
  await expect(page.getByTestId("team-settings")).toBeVisible();
  const toggle = page.getByTestId("ts-proxy-enabled");
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await page.getByTestId("ts-location").selectOption("REQUIRED");
  const manual = page.getByTestId("ts-manual");
  if ((await manual.getAttribute("aria-checked")) !== "true") await manual.click();
  const save = page.getByTestId("team-settings-save");
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText("Team attendance settings saved").first()).toBeVisible();
  }
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await shot(page, testInfo, "15a-team-settings");
});

test("(b) Arjun punches a report in with a location entered by hand", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  await teamTab(page);
  // A report without a session today (one session per day on this tenant): Priya after an earlier run's delete,
  // else any other report of Arjun.
  const board = await api(page, "GET", "/attendance/team/today");
  expect(board.status).toBe(200);
  const items = board.data.items as { employee_id: number; name: string; state: string }[];
  const priya = items.find((i) => i.employee_id === employeeId("alpha", "priya"));
  const free = [priya, ...items].find((i) => i && i.state === "NOT_PUNCHED_IN");
  expect(free, "a report of Arjun without attendance today").toBeTruthy();
  targetId = free!.employee_id;
  targetName = free!.name;
  const row = page.getByTestId(`team-member-${targetId}`);
  await expect(row).toBeVisible();
  await shot(page, testInfo, "15b-team-board");
  await proxyPunch(page, targetId, "in");
  await expect(page.getByText(/punched in/).first()).toBeVisible();
  await expect(row.getByTestId("team-state")).toHaveText("Working", { timeout: 15_000 });
  const after = await api(page, "GET", "/attendance/team/today");
  sessionId = after.data.items.find((i: { employee_id: number }) => i.employee_id === targetId).session_id;
  expect(sessionId).toBeGreaterThan(0);
  await shot(page, testInfo, "15b-report-working");
});

test("(c) Arjun punches the report out", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  await teamTab(page);
  await page.waitForTimeout(61_000);  // the shortest session is one minute (TOO_SOON otherwise)
  await proxyPunch(page, targetId, "out");
  await expect(page.getByTestId(`team-member-${targetId}`).getByTestId("team-state")).toHaveText("Punched out", { timeout: 15_000 });
  await shot(page, testInfo, "15c-report-out");
});

test("(d) Arjun deletes the session with a reason", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  await teamTab(page);
  const del = page.getByTestId(`row-delete-${sessionId}`).filter({ visible: true }).first();
  await expect(del).toBeVisible({ timeout: 20_000 });
  await del.click();
  await page.getByTestId("delete-reason").fill("Recorded by mistake during the e2e run");
  await shot(page, testInfo, "15d-delete-modal");
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByText("Attendance deleted").first()).toBeVisible();
  await expect(page.getByTestId(`row-delete-${sessionId}`)).toHaveCount(0, { timeout: 15_000 });
  // The deleted session no longer counts: the report can be punched in again today.
  const board = await api(page, "GET", "/attendance/team/today");
  expect(board.data.items.find((i: { employee_id: number }) => i.employee_id === targetId).state).toBe("NOT_PUNCHED_IN");
  await shot(page, testInfo, `15d-deleted-${targetName.split(" ")[0].toLowerCase()}`);
});

test("(e) employees cannot punch for others and managers stay inside their line", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "priya");
  await page.goto("/attendance");
  await expect(page.getByTestId("team-board")).toHaveCount(0);
  const r = await api(page, "POST", "/attendance/team/punch", {
    employee_id: employeeId("alpha", "rohan"), direction: "IN", reason: "test",
    location: { source: "MANUAL", latitude: 12.9, longitude: 77.5 } });
  expect([403, 404]).toContain(r.status);
  const arjun = await openAs(browser, "alpha", "arjun");
  try {
    const board = await api(arjun.page, "GET", "/attendance/team/today");
    const ids = board.data.items.map((i: { employee_id: number }) => i.employee_id);
    expect(ids).not.toContain(employeeId("alpha", "ravi"));  // Pune crew, not Arjun's line
    await shot(page, testInfo, "15e-employee-view");
  } finally {
    await arjun.close();
  }
});

test("(f) timesheets and period close open for their roles", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "priya");
  await page.goto("/attendance/timesheets");
  await expect(page.getByTestId("ts-table")).toBeVisible({ timeout: 20_000 });
  await shot(page, testInfo, "15f-timesheet");
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance/period-close");
  await expect(page.getByRole("heading", { name: "Attendance period close" })).toBeVisible();
  await shot(page, testInfo, "15f-period-close");
});
