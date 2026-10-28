/**
 * Goal 2 (LH-M1 calendar hierarchy; 04-holiday/01 §3–4, 09-ui-ux/02 §18) on the time stack 8500/3500 in Chrome:
 * Alpha's founder (company admin) creates the tenant-wide "India National 2026" with two holidays and the
 * entity calendar "Bengaluru Tech Park 2026", includes India National (and the branch's current calendar, so Bengaluru
 * keeps its seeded holidays), excludes the regional Guru Nanak Jayanti (LH-HOL-08: the parent keeps it), links the
 * Bengaluru Office branch from tomorrow (LH-HOL-10: today keeps the old calendar), asserts the lineage tree and
 * that a cycle is refused (LH-HOL-05 ORG_CALENDAR_CYCLE). Evidence: test-evidence/<date>-g03/ (E2E_TIME_GOAL=g03).
 */
import { api, expect, shot, signIn, test } from "../e2e-as/support";
import { completeStepUpIfAsked } from "./step-up";

test.describe.configure({ mode: "serial" });

const FESTIVAL = { name: "Guru Nanak Jayanti", date: "2026-11-24" };
const CHRISTMAS = { name: "Christmas Day", date: "2026-12-25" };
const OWN = { name: "Tech Park Foundation Day", date: "2026-12-04" };

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test("Goal 2: India National 2026 → Bengaluru Tech Park 2026, exclusion, branch link and lineage tree", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, "alpha", "founder");

  // Rerun-safe codes (unique per tenant); names stay as the goal states them.
  const existing = await api(page, "GET", "/holiday-calendars?q=INDIA_NATIONAL_2026");
  expect(existing.status, JSON.stringify(existing.data)).toBe(200);
  const suffix = existing.data.items.length ? `_${Date.now().toString(36).toUpperCase().slice(-5)}` : "";
  const NATIONAL = `INDIA_NATIONAL_2026${suffix}`;
  const TECH_PARK = `BLR_TECH_PARK_2026${suffix}`;

  const branches = await api(page, "GET", "/branches");
  const branchList = Array.isArray(branches.data) ? branches.data : branches.data.items;
  const blr = branchList.find((b: { code: string }) => b.code === "BR21");
  expect(blr, "Bengaluru Office (BR21) is seeded").toBeTruthy();
  const before = await api(page, "GET", `/branches/${blr.id}/calendar-links`);
  expect(before.status, JSON.stringify(before.data)).toBe(200);
  const today: string = before.data.local_today;
  expect(today < FESTIVAL.date, `the scenario needs ${FESTIVAL.date} to be ahead (today ${today})`).toBeTruthy();
  const tomorrow = addDays(today, 1);
  const currentId: number | null = before.data.current.holiday_calendar_id;
  const current = currentId ? (await api(page, "GET", `/holiday-calendars/${currentId}`)).data : null;

  const createCalendar = async (name: string, code: string, owner: string | null, region: string) => {
    await page.goto("/holidays/calendars");
    await expect(page.getByRole("heading", { name: "Holiday calendars" })).toBeVisible();
    await page.getByTestId("new-calendar").click();
    await expect(page).toHaveURL(/modal=holiday-calendar/);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByLabel(/^Code/).fill(code);
    if (owner) await dialog.getByLabel(/^Owner/).selectOption({ label: owner });
    await dialog.getByLabel(/^Country/).fill("IN");
    if (region) await dialog.getByLabel(/^State or region/).fill(region);
    await dialog.getByTestId("calendar-save").click();
    await expect(page).toHaveURL(/\/holidays\/calendars\/\d+\?tab=includes/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    return Number(/calendars\/(\d+)/.exec(page.url())![1]);
  };

  const addHoliday = async (h: { name: string; date: string }) => {
    await page.getByRole("tab", { name: /Holidays/ }).click();
    await page.getByTestId("add-occurrence").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Name/).fill(h.name);
    await dialog.getByLabel(/^Date/).fill(h.date);
    await dialog.getByTestId("occurrence-save").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(h.name) })).toBeVisible();
  };

  /** Publish the shown year through the publish-year modal (only published years count, Goal 3). */
  const publishYear = async () => {
    await page.getByTestId("publish-year").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("publish-year-panel")).toBeVisible();
    await expect(dialog.getByTestId("impact-holidays")).toBeVisible();
    for (const ack of await dialog.locator('[data-testid^="ack-"]').all()) await ack.check();
    await dialog.getByTestId("publish-confirm").click();
    await completeStepUpIfAsked(page, "alpha", "founder"); // LH-SEC-02: publishing needs a fresh step-up
    await expect(page.getByTestId("publish-year-panel")).toBeHidden();
    await expect(page.getByTestId("year-status")).toHaveText(/Published v1/);
  };

  let nationalId = 0;
  let techParkId = 0;

  await test.step("create the tenant-wide India National 2026 with two holidays", async () => {
    nationalId = await createCalendar("India National 2026", NATIONAL, null, "");
    await addHoliday(FESTIVAL);
    await addHoliday(CHRISTMAS);
    await expect(page.getByTestId("year-status")).toHaveText("Draft");
    await publishYear();
    await expect(page.getByTestId("flat-summary")).toContainText("2 holidays · 2 own");
    await shot(page, testInfo, "g03-cal-1-india-national");
  });

  await test.step("create Bengaluru Tech Park 2026 for the Indian entity with its own holiday", async () => {
    const entities = await api(page, "GET", "/legal-entities");
    const le11 = (entities.data as { id: number; legal_name: string; code?: string; country_code: string }[]).find((e) => e.country_code === "IN");
    expect(le11, "Alpha has an Indian legal entity").toBeTruthy();
    techParkId = await createCalendar("Bengaluru Tech Park 2026", TECH_PARK, le11!.legal_name, "IN-KA");
    await addHoliday(OWN);
  });

  await test.step("include India National (and the branch's current calendar) in priority order", async () => {
    await page.getByRole("tab", { name: "Includes" }).click();
    const editor = page.getByTestId("includes-editor");
    await editor.getByTestId("include-select").selectOption({ label: `${NATIONAL} — India National 2026` });
    await editor.getByTestId("include-add").click();
    if (current && current.id !== techParkId) {
      await editor.getByTestId("include-select").selectOption({ label: `${current.code} — ${current.name}` });
      await editor.getByTestId("include-add").click();
    }
    await editor.getByTestId("includes-save").click();
    await expect(page.getByTestId(`lineage-node-${NATIONAL}`)).toContainText("priority 1");
    await page.getByRole("tab", { name: /Holidays/ }).click();
    await expect(page.getByRole("row", { name: new RegExp(FESTIVAL.name) })).toContainText(`via ${NATIONAL}`);
  });

  await test.step("LH-HOL-08: exclude the regional festival; the parent keeps it", async () => {
    // DataTable renders the desktop table and the phone cards; click the visible one.
    await page.locator(`[data-testid="exclude-${FESTIVAL.date}"]:visible`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`${NATIONAL} keeps it for everyone else`);
    await dialog.getByLabel(/^Reason/).fill("Not observed at the Bengaluru tech park");
    await dialog.getByRole("button", { name: "Exclude" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(FESTIVAL.name) })).toHaveCount(0);
    await expect(page.getByTestId("excluded-list")).toContainText(FESTIVAL.name);
    // A rerun also includes the previous run's Tech Park calendar (the branch's current one), with its own exclusion.
    await expect(page.getByTestId("flat-summary")).toContainText(current && current.id !== techParkId ? /[1-9]\d* excluded/ : "1 excluded");

    const parent = await api(page, "GET", `/holiday-calendars/${nationalId}/holidays?year=2026`);
    expect(parent.data.items.map((h: { name: string }) => h.name)).toContain(FESTIVAL.name);
    await page.getByRole("tab", { name: /Exclusions/ }).click();
    await expect(page.getByTestId("exclusion-list")).toContainText(FESTIVAL.name);
    await shot(page, testInfo, "g03-cal-2-exclusion");
  });

  await test.step("LH-HOL-05: a tenant-wide calendar cannot include an entity calendar; a cycle is refused", async () => {
    const mismatch = await api(page, "PUT", `/holiday-calendars/${nationalId}/includes`, { includes: [{ included_calendar_id: techParkId, priority: 1 }] });
    expect([mismatch.status, mismatch.data.code], JSON.stringify(mismatch.data)).toEqual([422, "CALENDAR_ENTITY_MISMATCH"]);

    // Cycle between two tenant-wide calendars: IN-KA includes India National, then India National tries to include IN-KA.
    const ka = await api(page, "POST", "/holiday-calendars", { name: "Karnataka State 2026", code: `IN_KA_2026${suffix}`, country_code: "IN", subdivision_code: "IN-KA" });
    expect(ka.status, JSON.stringify(ka.data)).toBe(201);
    const kaIncludes = await api(page, "PUT", `/holiday-calendars/${ka.data.id}/includes`, { includes: [{ included_calendar_id: nationalId, priority: 1 }] });
    expect(kaIncludes.status, JSON.stringify(kaIncludes.data)).toBe(200);
    const cycle = await api(page, "PUT", `/holiday-calendars/${nationalId}/includes`, { includes: [{ included_calendar_id: ka.data.id, priority: 1 }] });
    expect([cycle.status, cycle.data.code], JSON.stringify(cycle.data)).toEqual([400, "ORG_CALENDAR_CYCLE"]);
    expect(cycle.data.detail ?? cycle.data.message).toContain(NATIONAL);
  });

  await test.step("publish Bengaluru Tech Park 2026 (its own holiday counts from now on)", async () => {
    await page.getByRole("tab", { name: /Holidays/ }).click();
    await publishYear();
    await expect(page.getByTestId("flat-summary")).toContainText("1 own");
  });

  await test.step("LH-HOL-10: link the Bengaluru Office branch from tomorrow; today keeps its calendar", async () => {
    await page.getByTestId("assign-calendar").click();
    await expect(page).toHaveURL(/modal=calendar-assignment/);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("assignment-branch").selectOption(String(blr.id));
    await dialog.getByTestId("assignment-from").fill(tomorrow);
    await dialog.getByTestId("assignment-save").click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/tab=assignments/);
    await expect(page.getByTestId("branch-links")).toContainText("Bengaluru Office");

    const after = await api(page, "GET", `/branches/${blr.id}/calendar-links`);
    const items = after.data.items as { holiday_calendar_id: number | null; effective_from: string; effective_to: string | null }[];
    expect(items.find((l) => l.holiday_calendar_id === techParkId)?.effective_from).toBe(tomorrow);
    if (currentId) expect(items.find((l) => l.holiday_calendar_id === currentId && l.effective_to === today)).toBeTruthy();
    expect(after.data.current.holiday_calendar_id).toBe(currentId);
    await shot(page, testInfo, "g03-cal-3-branch-link");
  });

  await test.step("the lineage tree shows Bengaluru Tech Park over India National", async () => {
    await page.getByRole("tab", { name: "Includes" }).click();
    const tree = page.getByTestId("lineage-tree");
    await expect(tree.getByTestId(`lineage-node-${TECH_PARK}`)).toContainText("1 excluded");
    await expect(tree.getByTestId(`lineage-node-${TECH_PARK}`).getByTestId(`lineage-node-${NATIONAL}`)).toContainText("2 own in 2026");
    await shot(page, testInfo, "g03-cal-4-lineage-tree");

    await page.goto("/holidays/calendars");
    await expect(page.getByRole("row", { name: new RegExp(TECH_PARK) })).toBeVisible();
    await shot(page, testInfo, "g03-cal-5-list");
  });
});
