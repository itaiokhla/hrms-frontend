/**
 * Goal 1 (LH-M1 work weeks; 04-holiday/03 §5.10, 09-ui-ux/02 §19) on the time stack 8500/3500 in Chrome:
 * Alpha's Arjun (work-calendar administrator, seed goal G-03) creates "Pune Factory Schedule" from the template
 * MON_SAT_2ND_4TH_SAT_OFF, checks that the interactive preview marks the 2nd and 4th Saturdays as weekly offs
 * (January 2027 and the current month), saves, then posts a version from the 1st of next month (every Saturday off)
 * through "Change from a date…" and sees it scheduled. Evidence: test-evidence/<date>-g03/ (E2E_TIME_GOAL=g03).
 */
import { api, expect, shot, signIn, test } from "../e2e-as/support";

test.describe.configure({ mode: "serial" });

const NAME = "Pune Factory Schedule";

/** ISO dates of the Saturdays of a YYYY-MM month. */
function saturdays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1) break;
    if (date.getUTCDay() === 6) out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

function nextMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

test("LH-WWK-05 / Goal 1: create Pune Factory Schedule from a template, preview 2nd and 4th Saturdays, add a version", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");

  // Rerun-safe: the code is unique per tenant, so a rerun on the same seed gets a suffixed code (same name).
  const existing = await api(page, "GET", "/work-weeks?q=PUNE_FACTORY");
  expect(existing.status, JSON.stringify(existing.data)).toBe(200);
  const code = existing.data.items.length ? `PUNE_FACTORY_${Date.now().toString(36).toUpperCase()}`.slice(0, 30) : "PUNE_FACTORY_SCHEDULE";
  const today: string = existing.data.local_today;
  const month = today.slice(0, 7);

  await test.step("the work-weeks admin page is reachable from Holidays", async () => {
    await page.goto("/holidays/work-weeks");
    await expect(page.getByRole("heading", { name: "Work weeks" })).toBeVisible();
    await expect(page.getByText("MON_FRI").first()).toBeVisible();
    await shot(page, testInfo, "g03-ww-1-list");
  });

  await test.step("New work week opens the work-week modal; the template fills the rules", async () => {
    await page.getByTestId("new-work-week").click();
    await expect(page).toHaveURL(/modal=work-week/);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("template-select").selectOption("MON_SAT_2ND_4TH_SAT_OFF");
    await dialog.getByLabel(/^Name/).fill(NAME);
    await dialog.getByLabel(/^Code/).fill(code);
    const saturday = dialog.getByTestId("weekday-5");
    await expect(saturday.getByLabel("2nd Saturday off")).toBeChecked();
    await expect(saturday.getByLabel("4th Saturday off")).toBeChecked();
    await expect(dialog.getByTestId("weekday-6").getByRole("radio", { name: "Off", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  await test.step("the preview marks the 2nd and 4th Saturdays of this month as weekly offs", async () => {
    const dialog = page.getByRole("dialog");
    const sats = saturdays(month);
    await expect(dialog.getByTestId(`ww-day-${sats[1]}`)).toHaveAttribute("data-portion", "FULL");
    await expect(dialog.getByTestId(`ww-day-${sats[3]}`)).toHaveAttribute("data-portion", "FULL");
    for (const other of [sats[0], sats[2], ...(sats[4] ? [sats[4]] : [])]) {
      await expect(dialog.getByTestId(`ww-day-${other}`)).toHaveAttribute("data-portion", "WORKING");
    }
    await shot(page, testInfo, "g03-ww-2-preview-this-month");
  });

  await test.step("January 2027 (five Saturdays): 9th and 23rd off, 2nd, 16th and 30th working", async () => {
    const dialog = page.getByRole("dialog");
    let shown = month;
    while (shown < "2027-01") {
      await dialog.getByRole("button", { name: "Next month" }).click();
      const [y, m] = shown.split("-").map(Number);
      shown = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    }
    await expect(dialog.getByTestId("preview-month")).toHaveText("January 2027");
    for (const off of ["2027-01-09", "2027-01-23", "2027-01-03", "2027-01-31"]) {
      await expect(dialog.getByTestId(`ww-day-${off}`)).toHaveAttribute("data-portion", "FULL");
    }
    for (const working of ["2027-01-02", "2027-01-16", "2027-01-30"]) {
      await expect(dialog.getByTestId(`ww-day-${working}`)).toHaveAttribute("data-portion", "WORKING");
    }
    await expect(dialog.getByTestId("preview-totals")).toContainText("Working days: 24");
    await expect(dialog.getByTestId("ww-day-2027-01-09")).toContainText("2nd");
    await shot(page, testInfo, "g03-ww-3-preview-january-2027");
  });

  let patternId = 0;
  await test.step("Save pattern opens the pattern detail with version 1", async () => {
    await page.getByRole("dialog").getByTestId("work-week-save").click();
    await expect(page).toHaveURL(/\/holidays\/work-weeks\/\d+/);
    patternId = Number(page.url().match(/work-weeks\/(\d+)/)![1]);
    await expect(page.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();
    const detail = await api(page, "GET", `/work-weeks/${patternId}`);
    expect(detail.data.code).toBe(code);
    expect(detail.data.rules).toEqual({ weekly_off_days: [6], nth_weekday_offs: [{ weekday: 5, nth: [2, 4] }] });
    expect(detail.data.versions).toHaveLength(1);
    await expect(page.getByTestId("work-week-preview")).toBeVisible();
    await shot(page, testInfo, "g03-ww-4-detail-schedule");
  });

  const from = nextMonthStart(today);
  await test.step("Change from a date…: every Saturday off from the 1st of next month (a new version)", async () => {
    await page.getByTestId("change-from-date").click();
    await expect(page).toHaveURL(/modal=work-week&id=\d+/);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("weekday-5").getByRole("radio", { name: "Off", exact: true }).click();
    await dialog.getByLabel(/^Effective from/).fill(from);
    const sats = saturdays(from.slice(0, 7));
    await expect(dialog.getByTestId(`ww-day-${sats[0]}`)).toHaveAttribute("data-portion", "FULL");
    await expect(dialog.getByTestId(`ww-day-${sats[0]}`)).toHaveAttribute("data-changed", "true");
    await expect(dialog.getByTestId("work-week-impact")).toBeVisible();
    await expect(dialog.getByTestId("work-week-save")).toHaveText("Schedule change");
    await shot(page, testInfo, "g03-ww-5-version-preview");
    await dialog.getByTestId("work-week-save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await test.step("the Versions tab lists v2 scheduled and v1 closed the day before; history is kept", async () => {
    await page.getByRole("tab", { name: /Versions/ }).click();
    await expect(page.getByText("v2").first()).toBeVisible();
    const versions = await api(page, "GET", `/work-weeks/${patternId}/versions`);
    expect(versions.data.items.map((v: { version: number; effective_from: string; state: string }) => [v.version, v.effective_from, v.state])).toEqual([
      [2, from, "SCHEDULED"],
      [1, versions.data.items[1].effective_from, "CURRENT"],
    ]);
    expect(versions.data.items[1].rules).toEqual({ weekly_off_days: [6], nth_weekday_offs: [{ weekday: 5, nth: [2, 4] }] });
    expect(versions.data.items[0].rules).toEqual({ weekly_off_days: [5, 6], nth_weekday_offs: [] });
    await shot(page, testInfo, "g03-ww-6-versions");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText(/version 2 from/).first()).toBeVisible();
    await shot(page, testInfo, "g03-ww-7-history");
  });
});
