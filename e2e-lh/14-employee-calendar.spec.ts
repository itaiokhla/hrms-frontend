/**
 * Goal 4 (LH-M1 day facts + employee holiday calendar; 09-ui-ux/02 §16, LH 05 §3.6, LH-TZ-04) on the time stack
 * 8500/3500 in Chrome:
 *   - Rohan (Alpha, Bengaluru Office, Monday-Friday) opens /holidays: the year grid has 12 months, weeks start on
 *     Monday, every month's 1st sits in the right column, today is ringed on his local date, and Republic Day
 *     (26 January 2027) is marked as a Public holiday; the Upcoming list and a day panel agree.
 *   - Layla (Beta, Dubai Mall Store, Gulf week Sunday-Thursday) opens /holidays: weeks start on Sunday and the
 *     weekend columns are Friday and Saturday; UAE National Day is a Public holiday on her calendar.
 * Evidence: test-evidence/<date>-g04/ (E2E_TIME_GOAL=g04).
 */
import type { Page } from "@playwright/test";

import { api, expect, shot, signIn, test } from "../e2e-as/support";

test.describe.configure({ mode: "serial" });

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pad = (n: number) => String(n).padStart(2, "0");
/** 0 = Monday, as the API. */
const weekdayOf = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

interface MyCalendar {
  local_today: string;
  timezone: string;
  weekend: number[];
  week_start: number;
  days: { date: string; weekly_off: boolean; holiday: { name: string; type: string } | null }[];
}

async function myCalendar(page: Page, year: number): Promise<MyCalendar> {
  const r = await api(page, "GET", `/me/calendar?from=${year}-01-01&to=${year}-12-31`);
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  return r.data as MyCalendar;
}

async function openYear(page: Page, year: number) {
  await page.goto("/holidays");
  const grid = page.getByTestId("holiday-year-grid");
  await expect(grid).toBeVisible();
  const shown = Number(await page.getByTestId("calendar-year").textContent());
  for (let y = shown; y < year; y++) {
    await page.getByRole("button", { name: "Next year" }).click();
    await expect(page.getByTestId("calendar-year")).toHaveText(String(y + 1));
  }
  await expect(page.getByTestId(`month-${year}-12`)).toBeVisible();
  return grid;
}

/** 12 months; each month's 1st in column (weekday - week start) mod 7; header order follows the week start. */
async function expectYearLayout(page: Page, year: number, weekStart: number) {
  await expect(page.locator(`section[data-testid^="month-${year}-"]`)).toHaveCount(12);
  const headers = page.getByTestId(`month-${year}-01`).getByTestId("weekday-header");
  await expect(headers).toHaveCount(7);
  await expect(headers.first()).toHaveAttribute("aria-label", WEEKDAY_NAMES[weekStart]);
  for (let m = 1; m <= 12; m++) {
    const col = (weekdayOf(year, m, 1) - weekStart + 7) % 7;
    await expect(page.getByTestId(`day-${year}-${pad(m)}-01`)).toHaveAttribute("data-col", String(col));
  }
}

test("Goal 4: Rohan (Bengaluru, Mon-Fri) sees 12 months from Monday and Republic Day 2027 as a Public holiday", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, "alpha", "rohan");

  const now = new Date().getFullYear();
  const today = await myCalendar(page, now);
  expect(today.timezone).toBe("Asia/Kolkata");
  expect(today.weekend).toEqual([5, 6]);
  expect(today.week_start).toBe(0);
  const facts2027 = await myCalendar(page, 2027);
  const republic = facts2027.days.find((d) => d.date === "2027-01-26");
  expect(republic?.holiday, JSON.stringify(republic)).toMatchObject({ name: "Republic Day", type: "PUBLIC" });

  await test.step("this year: grid, week start Monday, today ringed on the employee's local date (LH-TZ-04)", async () => {
    await openYear(page, now);
    await expect(page.getByRole("radio", { name: "My calendar" })).toHaveAttribute("aria-checked", "true");
    await expectYearLayout(page, now, 0);
    await expect(page.getByTestId(`day-${today.local_today}`)).toHaveAttribute("data-today", "true");
    await expect(page.getByTestId("weekly-off-line")).toContainText("Saturday & Sunday");
    const header = page.getByTestId(`month-${now}-01`).getByTestId("weekday-header");
    await expect(header.nth(5)).toHaveAttribute("data-weekend", "true");
    await expect(header.nth(6)).toHaveAttribute("data-weekend", "true");
    await expect(header.nth(4)).toHaveAttribute("data-weekend", "false");
    await expect(page.getByTestId("holiday-legend")).toContainText("Public holiday");
    await shot(page, testInfo, "g04-rohan-1-year-grid");
  });

  await test.step("2027: Republic Day (Tue 26 Jan) is a Public holiday cell, listed under January", async () => {
    await openYear(page, 2027);
    await expectYearLayout(page, 2027, 0);
    const cell = page.getByTestId("day-2027-01-26");
    await expect(cell).toHaveAttribute("data-kind", "public");
    await expect(cell).toHaveAttribute("data-col", "1"); // Tuesday of a Monday-first week
    await expect(cell).toHaveAccessibleName(/26 January 2027, Tuesday · Public holiday · Republic Day/);
    await expect(page.getByTestId("month-holidays-2027-01")).toContainText("Republic Day");
    await expect(page.getByTestId("day-2027-01-23")).toHaveAttribute("data-kind", "weekly-off"); // a Saturday
    await page.getByTestId("month-2027-01").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "g04-rohan-2-republic-day-2027");
    await cell.click();
    const panel = page.getByTestId("day-panel");
    await expect(panel).toContainText("Public holiday");
    await expect(panel).toContainText("Republic Day");
    await expect(panel).toContainText("Not a working day for you.");
    await shot(page, testInfo, "g04-rohan-3-day-panel");
  });

  await test.step("Upcoming list shows the next holidays with a Next badge", async () => {
    await page.goto("/holidays");
    await page.getByRole("radio", { name: "Upcoming" }).click();
    const list = page.getByTestId("holiday-list");
    await expect(list).toBeVisible();
    const upcoming = today.days.find((d) => d.holiday && d.date >= today.local_today);
    if (upcoming) await expect(list.getByTestId(`list-${upcoming.date}`)).toContainText("Next");
    await shot(page, testInfo, "g04-rohan-4-upcoming");
  });
});

test("Goal 4: Layla (Beta UAE, Fri-Sat weekend) sees weeks from Sunday with Friday and Saturday highlighted", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, "beta", "layla");

  const now = new Date().getFullYear();
  const mine = await myCalendar(page, now);
  expect(mine.timezone).toBe("Asia/Dubai");
  expect(mine.weekend).toEqual([4, 5]);
  expect(mine.week_start).toBe(6);

  await test.step("weekend columns are Friday and Saturday; weeks start on Sunday", async () => {
    await openYear(page, now);
    await expectYearLayout(page, now, 6);
    const headers = page.getByTestId(`month-${now}-01`).getByTestId("weekday-header");
    await expect(headers.first()).toHaveAttribute("aria-label", "Sunday");
    const weekend = headers.and(page.locator('[data-weekend="true"]'));
    await expect(weekend).toHaveCount(2);
    await expect(weekend.nth(0)).toHaveAttribute("aria-label", "Friday");
    await expect(weekend.nth(1)).toHaveAttribute("aria-label", "Saturday");
    await expect(page.getByTestId("weekly-off-line")).toContainText("Friday & Saturday");
    // Every Friday of the year sits in a weekend column (column 5 of a Sunday-first week).
    const friday = mine.days.find((d) => d.date >= mine.local_today && weekdayOf(...(d.date.split("-").map(Number) as [number, number, number])) === 4);
    if (friday) {
      await expect(page.getByTestId(`day-${friday.date}`)).toHaveAttribute("data-col", "5");
      await expect(page.getByTestId(`day-${friday.date}`)).toHaveAttribute("data-weekend", "true");
      await expect(page.getByTestId(`day-${friday.date}`)).toHaveAttribute("data-kind", /weekly-off|public|company|leave/);
    }
    await expect(page.getByTestId(`day-${mine.local_today}`)).toHaveAttribute("data-today", "true");
    await shot(page, testInfo, "g04-layla-1-year-grid");
  });

  await test.step("UAE National Day is a Public holiday on Layla's calendar", async () => {
    const national = mine.days.find((d) => d.holiday?.name === "UAE National Day");
    expect(national?.holiday?.type).toBe("PUBLIC");
    const cell = page.getByTestId(`day-${national!.date}`);
    await expect(cell).toHaveAttribute("data-kind", "public");
    await page.getByTestId(`month-${national!.date.slice(0, 7)}`).scrollIntoViewIfNeeded();
    await shot(page, testInfo, "g04-layla-2-national-day");
  });
});
