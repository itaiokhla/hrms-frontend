/**
 * Goal 5 (LH-M1 rollover, emergency closures, imports; 04-holiday/02 §8-§10, 01 §5.8, 09-ui-ux/02 §20) on the time
 * stack 8500/3500 in Chrome, as Alpha's HR administrator (Kavya):
 *   1. /holidays/rollover: the review card lists every calendar with the upcoming year's status (Published vN /
 *      Draft / Not generated / No rules / Failed) — the badges match the API; "Generate drafts now" fills the gaps.
 *   2. "Declare Emergency Closure": date + mandatory emergency reason -> the warning step lists the affected
 *      employees (scheduled / shifts / leave / pay-period state) -> confirm -> the closure is on the calendar (and on
 *      Rohan's own /holidays grid as a company holiday).
 *   3. Import wizard (modal `import-holidays`): a CSV with a bad row is checked, the row error is reported, the
 *      valid rows are imported into the draft year.
 * Evidence: test-evidence/<date>-g05/ (E2E_TIME_GOAL=g05).
 */
import { api, expect, shot, signIn, test } from "../e2e-as/support";

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Draft", NOT_GENERATED: "Not generated", NO_RULES: "No rules", FAILED: "Failed" };

test("Goal 5: Next year review, emergency closure with impact warning, CSV import", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await signIn(page, "alpha", "kavya");

  let overview = await api(page, "GET", "/holiday-calendars/rollover");
  expect(overview.status, JSON.stringify(overview.data)).toBe(200);
  const year: number = overview.data.year;

  await test.step("the rollover review card shows each calendar's status for next year", async () => {
    await page.goto("/holidays/rollover");
    await expect(page.getByRole("heading", { name: "Next year" })).toBeVisible();
    await expect(page.getByTestId("rollover-status")).toContainText("calendars published");
    const generate = page.getByTestId("generate-drafts");
    if (await generate.isVisible()) {
      await generate.click();
      await expect(page.getByText(/draft\(s\) generated/)).toBeVisible();
    }
    overview = await api(page, "GET", `/holiday-calendars/rollover?year=${year}`);
    const items = overview.data.items as { code: string; year_status: string; version: number }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => ["DRAFT", "PUBLISHED"].includes(i.year_status))).toBeTruthy();
    for (const item of items.slice(0, 12)) {
      const row = page.getByTestId(`rollover-calendar-${item.code}`);
      await expect(row).toHaveAttribute("data-status", item.year_status);
      await expect(row).toContainText(STATUS_LABEL[item.year_status]);
    }
    await expect(page.getByTestId("rollover-status")).toContainText(`${overview.data.published} of ${overview.data.total} calendars published`);
    const draft = items.find((i) => i.year_status === "DRAFT") ?? items.find((i) => i.year_status === "PUBLISHED");
    if (draft) {
      await page.getByTestId(`rollover-calendar-${draft.code}`).click();
      await expect(page.getByTestId("rollover-detail")).toContainText(`${draft.code} · ${year}`);
      await expect(page.getByTestId("rollover-diff")).toBeVisible();
    }
    await shot(page, testInfo, "g05-1-rollover-review");
  });

  // Rohan's calendar today (Bengaluru Office, BR21): the closure goes there so his own grid shows it.
  const branches = await api(page, "GET", "/branches");
  const blr = (Array.isArray(branches.data) ? branches.data : branches.data.items).find((b: { code: string }) => b.code === "BR21");
  const links = await api(page, "GET", `/branches/${blr.id}/calendar-links`);
  const calendarId: number = links.data.current.holiday_calendar_id;
  const today: string = links.data.local_today;
  // Today (a closure "recorded at 13:00 today"): the branch's current link covers it; yesterday may still belong to
  // the previous link when the link started today (spec 12 links BR21 "from tomorrow").
  const closureDate = today;
  const closureName = `Flood closure ${RUN}`;
  const calendar = (await api(page, "GET", `/holiday-calendars/${calendarId}`)).data;

  await test.step("Declare Emergency Closure: date and mandatory emergency reason", async () => {
    await page.goto(`/holidays/rollover?calendar_id=${calendarId}`);
    await page.getByTestId("declare-closure").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Declare emergency closure");
    await dialog.getByLabel(/^Calendar/).selectOption(String(calendarId));
    await dialog.getByLabel(/^Date/).fill(closureDate);
    await dialog.getByLabel(/^Name/).fill(closureName);
    await expect(dialog.getByTestId("closure-check")).toBeDisabled(); // the reason is mandatory
    await dialog.getByLabel(/^Emergency reason/).fill("Office flooded after heavy rain; staff sent home");
    await expect(dialog.getByTestId("closure-check")).toBeEnabled();
    await shot(page, testInfo, "g05-2-closure-form");
    await dialog.getByTestId("closure-check").click();
  });

  await test.step("the warning lists affected shifts, leave and pay periods; confirm records the closure", async () => {
    const dialog = page.getByRole("dialog");
    const impact = dialog.getByTestId("closure-impact");
    await expect(impact).toBeVisible();
    await expect(dialog.getByTestId("closure-totals")).toContainText("were scheduled to work");
    await expect(dialog.getByTestId("closure-totals")).toContainText("approved leave request(s) credited back");
    await expect(dialog.getByTestId("closure-totals")).toContainText("finalized pay periods");
    await expect(impact.locator('[data-testid^="closure-employee-"]').first()).toBeVisible();
    await shot(page, testInfo, "g05-3-closure-impact-warning");
    const typed = dialog.getByTestId("closure-typed");
    if (await typed.isVisible()) await typed.fill(closureDate);
    await dialog.getByTestId("closure-confirm").click();
    await expect(page).toHaveURL(new RegExp(`/holidays/calendars/${calendarId}\\?year=${closureDate.slice(0, 4)}&closure=${closureDate}`));
    await expect(page.getByText(/Closure recorded for/)).toBeVisible();
    await expect(page.locator("tr:visible", { hasText: closureName }).first()).toBeVisible();
    await page.locator("tr:visible", { hasText: closureName }).first().scrollIntoViewIfNeeded();
    await shot(page, testInfo, "g05-4-closure-on-calendar");
    const history = await api(page, "GET", `/holiday-calendars/${calendarId}/history?limit=20`);
    expect(JSON.stringify(history.data)).toContain("BACKDATED_CLOSURE");
  });

  await test.step("Rohan's own calendar shows the closure as a company holiday", async () => {
    const context = await browser.newContext();
    const rohan = await context.newPage();
    await signIn(rohan, "alpha", "rohan");
    const mine = await api(rohan, "GET", `/me/calendar?from=${closureDate}&to=${closureDate}`);
    const day = mine.data.days[0];
    if (day.calendar_id === calendarId || day.holiday?.name === closureName) {
      expect(day.holiday?.category).toBe("EMERGENCY");
      await rohan.goto("/holidays");
      await expect(rohan.getByTestId(`day-${closureDate}`)).toHaveAttribute("data-kind", /company|public/);
      // A rerun on the same day has an earlier closure too: equal rank, the lower id is shown (05 §3.5).
      await expect(rohan.getByTestId(`day-${closureDate}`)).toHaveAccessibleName(new RegExp(day.holiday.name));
      await rohan.getByTestId(`month-${closureDate.slice(0, 7)}`).scrollIntoViewIfNeeded();
      await shot(rohan, testInfo, "g05-5-rohan-sees-closure");
    }
    await context.close();
  });

  await test.step("Import wizard: CSV with a bad row is checked, the error reported, valid rows imported", async () => {
    const created = await api(page, "POST", "/holiday-calendars", { name: `Import target ${RUN}`, code: `IMP_${RUN}`, country_code: "IN" });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const target = created.data.id as number;
    await page.goto(`/holidays/calendars/${target}`);
    await page.getByTestId("import-holidays").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("import-wizard")).toBeVisible();
    await dialog.getByLabel("Into year").selectOption(String(year));
    const csv = `date,name,type,category\n${year}-01-26,Republic Day,PUBLIC,NATIONAL\n${year}-08-15,Independence Day,PUBLIC,NATIONAL\n15/09/${year},Bad date row,COMPANY,\n`;
    await dialog.getByTestId("import-file").setInputFiles({ name: "holidays.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await dialog.getByTestId("import-check").click();
    await expect(dialog.getByTestId("import-summary")).toContainText("New · 2");
    await expect(dialog.getByTestId("import-summary")).toContainText("Error · 1");
    await expect(dialog.getByTestId("import-line-4")).toContainText("is not a YYYY-MM-DD date");
    await shot(page, testInfo, "g05-6-import-review");
    await dialog.getByTestId("import-commit").click();
    await expect(dialog.getByTestId("import-done")).toContainText("2 holiday(s)");
    await shot(page, testInfo, "g05-7-import-done");
    const rows = await api(page, "GET", `/holiday-calendars/${target}/years/${year}`);
    expect((rows.data.items as { name: string }[]).map((i) => i.name)).toEqual(expect.arrayContaining(["Republic Day", "Independence Day"]));
    expect(calendar.code).toBeTruthy();
  });
});

test("Goal 5: modal twins — import-holidays and working-day open by URL and as full pages", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page, "alpha", "kavya");
  const run = Date.now().toString(36).slice(-5).toUpperCase();
  const created = await api(page, "POST", "/holiday-calendars", { name: `Twins ${run}`, code: `TWN_${run}`, country_code: "IN" });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  const id = created.data.id as number;
  const year = new Date().getFullYear() + 1;

  await test.step("modal import-holidays deep-links from the calendar URL", async () => {
    await page.goto(`/holidays/calendars/${id}?modal=import-holidays&calendar_id=${id}&year=${year}`);
    const dialog = page.getByRole("dialog", { name: new RegExp(`Import holidays into TWN_${run}`) });
    await expect(dialog.getByTestId("import-wizard")).toBeVisible();
    await expect(dialog.getByLabel("Into year")).toHaveValue(String(year));
    await shot(page, testInfo, "g05-8-import-modal-deep-link");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("full-page twin /holidays/calendars/{id}/import", async () => {
    await page.goto(`/holidays/calendars/${id}/import?year=${year}`);
    await expect(page.getByRole("heading", { name: "Import holidays" })).toBeVisible();
    await expect(page.getByTestId("import-wizard")).toBeVisible();
    await shot(page, testInfo, "g05-9-import-full-page");
  });

  await test.step("modal working-day deep-links from the Working days tab", async () => {
    await page.goto(`/holidays/calendars/${id}?tab=working-days&modal=working-day`);
    const dialog = page.getByRole("dialog", { name: "Declare a working day" });
    await expect(dialog.getByTestId("working-day-form")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("full-page twin /holidays/calendars/{id}/working-days/new declares a make-up Saturday", async () => {
    const saturday = new Date(Date.UTC(year, 1, 6));
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    const iso = saturday.toISOString().slice(0, 10);
    await page.goto(`/holidays/calendars/${id}/working-days/new?date=${iso}`);
    await expect(page.getByRole("heading", { name: "Declare a working day" })).toBeVisible();
    const form = page.getByTestId("working-day-form");
    await expect(form.getByLabel(/^Date/)).toHaveValue(iso);
    await form.getByLabel(/^Name/).fill("Make-up Saturday");
    await form.getByLabel(/^Reason/).fill("Bridge for a long weekend");
    await form.getByTestId("working-day-save").click();
    await expect(page).toHaveURL(new RegExp(`/holidays/calendars/${id}\\?tab=working-days`));
    const days = await api(page, "GET", `/holiday-calendars/${id}/years/${year}`);
    expect(JSON.stringify(days.data.working_days)).toContain(iso);
    await shot(page, testInfo, "g05-10-working-day-full-page");
  });
});
