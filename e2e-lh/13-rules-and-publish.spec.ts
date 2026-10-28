/**
 * Goal 3 (LH-M1 holiday rules, year generation and publication; 04-holiday/02 §3.8, 04-holiday/01 §6.2, §9.4) on the
 * time stack 8500/3500 in Chrome: Alpha's HR administrator (Kavya) opens "India National 2026", adds the repeating
 * holiday "Republic Day" (FIXED_DATE, month 1, day 26) through the `holiday-rule` modal, checks the 5-year preview,
 * generates the 2027 draft, reviews it in the `publish-year` panel (impact, diff), publishes with a reason and sees
 * 2027 PUBLISHED v1 — the day then counts. Evidence: test-evidence/<date>-g03/ (E2E_TIME_GOAL=g03).
 */
import { api, expect, shot, signIn, test } from "../e2e-as/support";
import { completeStepUpIfAsked } from "./step-up";

test.describe.configure({ mode: "serial" });

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The preview's "Tue 26 Jan 2027" for 26 January of a year. */
function republicDay(year: number): string {
  const weekday = (new Date(Date.UTC(year, 0, 26)).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[weekday]} 26 ${MONTHS[0]} ${year}`;
}

test("Goal 3: Republic Day rule -> 5-year preview -> 2027 draft -> reviewed publication", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, "alpha", "kavya");

  // "India National 2026" (made by spec 12). Rerun-safe: use one without a Republic Day rule and an unpublished 2027,
  // else create a fresh one under the same name.
  const listed = await api(page, "GET", "/holiday-calendars?q=India%20National%202026&limit=50");
  expect(listed.status, JSON.stringify(listed.data)).toBe(200);
  let calendar: { id: number; code: string } | undefined;
  for (const c of listed.data.items as { id: number; code: string; name: string; legal_entity_id: number | null }[]) {
    if (c.name !== "India National 2026" || c.legal_entity_id !== null) continue;
    const rules = await api(page, "GET", `/holiday-calendars/${c.id}/rules?status=ACTIVE`);
    const year = await api(page, "GET", `/holiday-calendars/${c.id}/years/2027`);
    if (!rules.data.items.some((r: { name: string }) => r.name === "Republic Day") && year.data.status === "NONE") {
      calendar = c;
      break;
    }
  }
  if (!calendar) {
    const created = await api(page, "POST", "/holiday-calendars", {
      name: "India National 2026",
      code: `INDIA_NATIONAL_2026_${Date.now().toString(36).toUpperCase().slice(-5)}`,
      country_code: "IN",
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    calendar = created.data;
  }
  const cal = calendar!;
  const thisYear = Number((await api(page, "GET", `/holiday-calendars/${cal.id}/years/2027`)).data.local_today.slice(0, 4));

  await test.step("open India National 2026 and its Rules tab", async () => {
    await page.goto("/holidays/calendars");
    await expect(page.getByRole("heading", { name: "Holiday calendars" })).toBeVisible();
    await page.goto(`/holidays/calendars/${cal.id}`);
    await expect(page.getByRole("heading", { name: "India National 2026" })).toBeVisible();
    await page.getByRole("tab", { name: /Rules/ }).click();
    await expect(page).toHaveURL(/tab=rules/);
  });

  await test.step("Add Rule: Republic Day, same date every year, 26 January", async () => {
    await page.getByTestId("add-rule").click();
    await expect(page).toHaveURL(/modal=holiday-rule/);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("rule-name").fill("Republic Day");
    await dialog.getByRole("radio", { name: "Same date every year" }).check();
    await dialog.getByRole("combobox", { name: /^Month/ }).selectOption("1");
    await dialog.getByRole("combobox", { name: /^Day/ }).selectOption("26");
    await dialog.getByRole("combobox", { name: /^Type/ }).selectOption("PUBLIC");
    await dialog.getByRole("combobox", { name: /^Category/ }).selectOption("NATIONAL");
  });

  await test.step("RulePreviewList shows 26 January for the next 5 years", async () => {
    const dialog = page.getByRole("dialog");
    for (let y = thisYear; y < thisYear + 5; y++) {
      await expect(dialog.getByTestId(`preview-year-${y}`)).toContainText(republicDay(y));
    }
    await expect(dialog.getByTestId(`preview-year-${thisYear + 5}`)).toHaveCount(0);
    await dialog.getByTestId("rule-preview").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "g03-rules-1-preview");
    await dialog.getByTestId("rule-save").click();
    await expect(dialog).toBeHidden();
    const rule = page.getByTestId("rule-Republic Day");
    await expect(rule).toContainText("Every 26 Jan");
    await expect(rule).toContainText(`${thisYear}–open`);
  });

  await test.step("Generate 2027 Draft and review the generated occurrence", async () => {
    await page.getByTestId("year-bar").getByRole("combobox", { name: "Year" }).selectOption("2027");
    await expect(page.getByTestId("year-status")).toHaveText("Not started");
    await page.getByTestId("generate-year").click();
    await expect(page.getByTestId("year-status")).toHaveText("Draft");
    await page.getByRole("tab", { name: /Holidays/ }).click();
    const row = page.getByRole("row", { name: /Republic Day/ });
    await expect(row).toContainText("Confirmed");
    await expect(row).toContainText("rule");
    await shot(page, testInfo, "g03-rules-2-draft-2027");
  });

  await test.step("PublishYearPanel: impact and diff, then Publish with a change reason", async () => {
    await page.getByTestId("publish-year").click();
    await expect(page).toHaveURL(/modal=publish-year/);
    const dialog = page.getByRole("dialog");
    const panel = dialog.getByTestId("publish-year-panel");
    await expect(panel.getByTestId("impact-holidays")).toHaveText(/^1/);
    await expect(panel.getByTestId("impact-diff")).toContainText(`${republicDay(2027)}Republic Day`);
    await panel.getByTestId("publish-reason").fill("Annual national holiday list for 2027");
    for (const ack of await panel.locator('[data-testid^="ack-"]').all()) await ack.check();
    await shot(page, testInfo, "g03-rules-3-publish-panel");
    await panel.getByTestId("publish-confirm").click();
    // LH-SEC-02: "Confirm it's you" opens before the publication is committed (e-mailed code), then it is retried.
    expect(await completeStepUpIfAsked(page, "alpha", "kavya")).toBe(true);
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("year-status")).toHaveText("Published v1");
    await shot(page, testInfo, "g03-rules-4-published");
  });

  await test.step("the publication is in the history and the year is published v1 with the reason", async () => {
    const year = await api(page, "GET", `/holiday-calendars/${cal.id}/years/2027`);
    expect([year.data.status, year.data.version]).toEqual(["PUBLISHED", 1]);
    expect(year.data.items.find((i: { name: string }) => i.name === "Republic Day")).toMatchObject({ date: "2027-01-26", source: "RULE", status: "CONFIRMED" });
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("history-years")).toContainText("Published v1");
    await expect(page.getByTestId("history-events")).toContainText("Annual national holiday list for 2027");
    await shot(page, testInfo, "g03-rules-5-history");
  });
});
