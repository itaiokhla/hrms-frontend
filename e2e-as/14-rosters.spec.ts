/**
 * G-14 / AS-M5 Chrome checks (AS 13 §4.9 exit, adapted to what G-14 ships) on the time stack 8500/3500 with the G-14
 * seed: rotation PUNE-6ON2OFF (crews A/B/C = Imran, Ravi, Sunita; anchor Mon 2026-11-02), roster period
 * RP-PUNE-PROD-2026-11, Kiran = Roster planner (no publish), Asha = Roster publisher.
 * (a) Kiran generates the period from the rotation; the grid shows Ravi on B on Wed 2026-11-04 (cycle index 8);
 * (b) validation lists the findings; (c) Kiran has no Publish button; (d) an illegal edit (A 06:00 the morning after
 * B ends 22:00, 8 h rest) dragged onto the grid is blocked at publish with INSUFFICIENT_REST_HOURS; (e) Asha publishes
 * the legal roster with the warnings acknowledged; (f) Ravi sees B on 4 Nov in My schedule.
 */
import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

const CELL = (emp: number, day: string) => `cell-${emp}-${day}`;

test("AS-M5 (a)-(f): generate from a rotation, validate, illegal publish blocked, publish, My schedule", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "kiran");
  const ravi = employeeId("alpha", "ravi");
  const periods = await api(page, "GET", "/rosters?limit=200");
  const period = periods.data.items.find((p: any) => p.code === "RP-PUNE-PROD-2026-11");
  expect(period, "seeded period").toBeTruthy();

  await test.step("(a) Kiran generates the drafts; Ravi is on B on Wed 4 Nov (index 8)", async () => {
    if (period.status === "DRAFT" && !period.drafts) {
      const generated = await api(page, "POST", `/rosters/${period.id}/generate`, {});
      expect(generated.status, JSON.stringify(generated.data)).toBe(200);
      expect(generated.data.generated).toBeGreaterThan(0);
    } else if (period.status !== "DRAFT") {
      // Rerun: an earlier run published the period. Drop leftover drafts (step g regenerates them) and draft one
      // always-legal change (Imran's planned work mode on a WORK day) so there is something to validate and publish.
      let grid = await api(page, "GET", `/rosters/${period.id}`);
      if (grid.data.period.drafts) {
        const discarded = await api(page, "DELETE", `/rosters/${period.id}/drafts?row_version=${grid.data.period.row_version}`);
        expect(discarded.status, JSON.stringify(discarded.data)).toBe(200);
        grid = await api(page, "GET", `/rosters/${period.id}`);
      }
      const imran = employeeId("alpha", "imran");
      const entry = grid.data.entries.find((e: any) => e.employee_id === imran && e.kind === "WORK");
      const saved = await api(page, "PUT", `/rosters/${period.id}/drafts`, { row_version: grid.data.period.row_version, cells: [{
        employee_id: imran, shift_date: entry.shift_date, entry_seq: entry.entry_seq, action: "UPSERT", kind: "WORK",
        shift_id: entry.shift_id, planned_work_mode: entry.planned_work_mode === "ON_SITE" ? "FIELD" : "ON_SITE" }] });
      expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    }
    await page.goto("/rosters");
    await page.getByRole("link", { name: /RP-PUNE-PROD-2026-11/ }).first().click().catch(async () => {
      await page.goto(`/rosters/${period.id}`);
    });
    await page.waitForURL(new RegExp(`/rosters/${period.id}`));
    await expect(page.getByTestId("roster-grid")).toBeVisible();
    await expect(page.getByTestId(CELL(ravi, "2026-11-04"))).toHaveAttribute("aria-label", /: B( \(draft\))?/);
    await shot(page, testInfo, "a-generated-grid");
  });

  await test.step("(b) validation lists the findings; (c) the planner has no Publish button", async () => {
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("validation-panel")).toBeVisible();
    await expect(page.getByTestId("validation-clean").or(page.getByTestId("validation-results"))).toBeVisible();
    await expect(page.getByTestId("open-publish")).toHaveCount(0);
    await shot(page, testInfo, "b-validation-planner");
  });

  await test.step("(d) an A shift dragged onto Thu 5 Nov leaves 8 h of rest: publishing is blocked", async () => {
    await page.getByTestId("palette-shift-A").dragTo(page.getByTestId(CELL(ravi, "2026-11-05")));
    await expect(page.getByTestId(CELL(ravi, "2026-11-05"))).toHaveAttribute("data-state", "pending");
    await page.getByTestId("save-drafts").click();
    await expect(page.getByText(/Saved \d+ cells? as drafts\./)).toBeVisible();
    const asha = await openAs(browser, "alpha", "asha");
    await asha.page.goto(`/rosters/${period.id}`);
    await asha.page.getByTestId("open-publish").click();
    const modal = asha.page.getByTestId("publish-modal");
    await expect(modal.getByTestId("publish-blocking")).toHaveAttribute("data-code", "INSUFFICIENT_REST_HOURS");
    for (const box of await modal.locator("[data-testid^=ack-]").all()) await box.check();
    for (const reason of await modal.locator("[data-testid^=reason-]").all()) await reason.fill("Planned staffing");
    await asha.page.getByTestId("publish-confirm").click();
    await expect(asha.page.getByTestId("roster-error")).toHaveAttribute("data-code", "INSUFFICIENT_REST_HOURS");
    await shot(asha.page, testInfo, "d-insufficient-rest-blocked");
    const refused = await api(asha.page, "POST", `/rosters/${period.id}/publish`, {});
    expect(refused.status).toBe(422);
    expect(refused.data.code).toBe("INSUFFICIENT_REST_HOURS");
    await asha.close();
    // Kiran puts the rotation's B back on Thursday.
    await page.getByTestId("palette-shift-B").click();
    await page.getByTestId(CELL(ravi, "2026-11-05")).click();
    await page.getByTestId("save-drafts").click();
    await expect(page.getByText(/Saved \d+ cells? as drafts\./)).toBeVisible();
  });

  await test.step("(e) Asha publishes the legal roster with the warnings acknowledged", async () => {
    const asha = await openAs(browser, "alpha", "asha");
    await asha.page.goto(`/rosters/${period.id}`);
    await asha.page.getByTestId("open-publish").click();
    const modal = asha.page.getByTestId("publish-modal");
    await expect(modal.getByTestId("publish-summary")).toBeVisible();
    await expect(modal.getByTestId("publish-blocking")).toHaveCount(0);
    for (const box of await modal.locator("[data-testid^=ack-]").all()) await box.check();
    for (const reason of await modal.locator("[data-testid^=reason-]").all()) await reason.fill("Planned staffing");
    await asha.page.getByTestId("publish-confirm").click();
    await expect(asha.page.getByText(/Roster published:/)).toBeVisible();
    await expect(asha.page.getByTestId("period-status")).toHaveText("Published");
    await expect(asha.page.getByTestId(CELL(ravi, "2026-11-04"))).toHaveAttribute("data-state", "published");
    await shot(asha.page, testInfo, "e-published");
    await asha.close();
  });

  await test.step("(f) Ravi sees B on Wed 4 Nov in My schedule", async () => {
    const r = await openAs(browser, "alpha", "ravi");
    await r.page.goto("/rosters/my-schedule");
    // Page forward only once each window has loaded (an early click skips past the date).
    const days = r.page.locator("[data-testid^=schedule-day-]");
    await expect(days.first()).toBeVisible();
    for (let i = 0; i < 8 && !(await r.page.getByTestId("schedule-day-2026-11-04").count()); i += 1) {
      const first = (await days.first().getAttribute("data-testid")) ?? "";
      await r.page.getByTestId("schedule-next").click();
      await expect(days.first()).not.toHaveAttribute("data-testid", first);
    }
    const day = r.page.getByTestId("schedule-day-2026-11-04");
    await expect(day.getByTestId("schedule-shift")).toHaveText("B");
    await expect(day).toHaveAttribute("data-kind", "work");
    await shot(r.page, testInfo, "f-ravi-my-schedule");
    await r.close();
  });

  await test.step("(g) Kiran runs the roster generator: periods and rotation drafts 90 days forward", async () => {
    await page.goto("/rosters");
    await page.getByTestId("open-generate").click();
    const modal = page.getByTestId("generate-modal");
    await modal.getByLabel("Branch").selectOption({ label: "Pune Plant" });
    await expect(modal.getByLabel("Days ahead")).toHaveValue("90");
    await page.getByTestId("generate-confirm").click();
    await expect(modal.getByTestId("generate-result")).toBeVisible();
    await expect(modal.getByTestId("generate-period").first()).toBeVisible();
    await shot(page, testInfo, "g-generate-90-days");
    const list = await api(page, "GET", "/rosters?limit=200");
    const pune = list.data.items.filter((p: any) => p.code.startsWith("RP-") && p.status !== "CANCELLED");
    const today = new Date();
    const covered = new Set<string>();
    for (const p of pune) {
      for (let d = new Date(`${p.start_date}T00:00:00Z`); d <= new Date(`${p.end_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        covered.add(d.toISOString().slice(0, 10));
      }
    }
    for (let i = 1; i < 90; i += 1) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
      expect(covered.has(d.toISOString().slice(0, 10)), `period covering day +${i}`).toBe(true);
    }
  });
});
