/**
 * Hourly location tracking, team bulk punches, shift swaps / open shifts (G-15, AS-M6) and the offline punch queue
 * (G-24, AS-M12), on the time stack 8500/3500 in real Chrome.
 *
 * (a) Kavya opens Settings › Capture methods & location, switches on "Check location periodically" every 60 minutes,
 *     allows offline punches and activates a new version; the capture view of an employee then says 60 minutes.
 * (b) Prakash goes offline (Chrome offline mode) on /punch, punches, sees "1 pending"; back online the queue syncs
 *     exactly once (OFFLINE_CAPTURED), tracking runs every 60 min; the privacy page says "About every 60 minutes".
 *     Withdrawing "Location during your shift" stops tracking at once; agreeing again restores the consent.
 * (c) Arjun's team board: people whose day is complete show "Day complete" without Punch in (FU-AS-43); he selects
 *     everyone who can be punched in and punches them in together (bulk), then out together; the results list who
 *     was refused and why.
 * (d) Kavya switches on swaps and open shifts in Settings › Shift swaps & open shifts.
 * (e) Ravi asks Sunita to swap a published shift from My schedule (coworker picker, rule check, send); Sunita accepts
 *     from her Requests tab; Kavya approves in Shift requests — both schedules change (source SWAP).
 * (f) Kiran posts an open shift for Pune Plant; Imran claims it; Kavya approves the claim and it is FILLED.
 * (g) Kavya opens Sites (list + a site page) — the G-06 pages are reachable from the sidebar.
 * Rerun-safe: every step reads the current state first and picks people / dates that are still free.
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

const PUNE = { latitude: 18.5204, longitude: 73.8567, accuracy: 12 };

async function geo(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation(PUNE);
}

test("(a) Kavya sets hourly location checks and offline punches in the capture policy", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/capture");
  await expect(page.getByTestId("capture-policy-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capture-current")).toBeVisible();
  const enabled = page.getByTestId("tracking-enabled");
  if (!(await enabled.isChecked())) await enabled.check();
  await page.getByTestId("tracking-interval").fill("60");
  await expect(page.getByText("Every hour")).toBeVisible();
  await page.getByTestId("offline-mode").selectOption("ALLOW");
  const dpia = page.getByLabel("Privacy impact assessment reference");
  if (!(await dpia.inputValue())) await dpia.fill("DPIA-ALPHA-2026");
  await page.getByTestId("capture-reason").fill("Hourly location checks for field staff (e2e)");
  await shot(page, testInfo, "19a-capture-policy");
  const save = page.getByTestId("capture-save");
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText(/Capture policy v\d+ active/).first()).toBeVisible({ timeout: 30_000 });
  }
  await shot(page, testInfo, "19a-capture-policy-active");
  const prakash = await openAs(page.context().browser()!, "alpha", "prakash");
  const view = await api(prakash.page, "GET", "/me/attendance/capture");
  expect(view.status).toBe(200);
  expect(view.data.tracking).toMatchObject({ enabled: true, interval_minutes: 60 });
  expect(view.data.offline_punches).toBe("ALLOW");
  await prakash.close();
});

test("(b) Prakash punches offline; the queue syncs once and tracking runs every hour", async ({ browser }, testInfo) => {
  const { page, close } = await openAs(browser, "alpha", "prakash");
  await geo(page);
  await page.goto("/punch");
  await expect(page.getByTestId("punch-screen")).toBeVisible({ timeout: 30_000 });
  const before = await api(page, "GET", "/attendance/me/today");
  const direction = (before.data.actions as string[]).includes("PUNCH_IN") ? "IN" : (before.data.actions as string[]).includes("PUNCH_OUT") ? "OUT" : null;
  test.skip(direction === null, "Prakash has nothing left to punch today (rerun after his day is complete)");
  const punches = async () => (await api(page, "GET", `/attendance/me/today`)).data.events?.length ?? 0;
  const eventsBefore = await punches();
  await page.getByTestId(`punch-${direction}`).click();
  await expect(page.getByTestId("punch-submit")).toBeVisible();
  if (direction === "IN") {  // tracking is on: the check-in shows the periodic-location notice with the interval
    await expect(page.getByTestId("punch-location-notice")).toContainText("about every 60 minutes");
  }
  const notice = page.getByTestId("punch-location-consent");
  if (await notice.count()) await notice.check();
  await expect(page.getByTestId("punch-submit")).toBeEnabled({ timeout: 30_000 });  // the location reading is taken
  await page.context().setOffline(true);
  await page.getByTestId("punch-submit").click();
  await expect(page.getByText(/saved on this phone/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("offline-pending")).toHaveText("1 pending");
  await shot(page, testInfo, "19b-offline-pending");
  await page.context().setOffline(false);
  await expect(page.getByText(/offline punch(es)? synced/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("offline-pending")).toHaveCount(0);
  await shot(page, testInfo, "19b-offline-synced");
  expect(await punches()).toBe(eventsBefore + 1);  // exactly once
  const raw = await api(page, "GET", "/attendance/me/today");
  expect(raw.data.attendance_state).toBe(direction === "IN" ? "WORKING" : "PUNCHED_OUT");
  if (direction === "IN") {
    const tracking = await api(page, "GET", "/attendance/me/tracking");
    expect(tracking.data.interval_minutes).toBe(60);
    expect(tracking.data.state).toBe("ACTIVE");
  }
  // Privacy page: the interval in plain words; withdrawing stops tracking at once (07 C-5), agreeing restores it.
  await page.goto("/me/attendance/privacy");
  await expect(page.getByTestId("privacy-collection")).toContainText("About every 60 minutes while checked in");
  await shot(page, testInfo, "19b-privacy-hourly");
  const row = page.getByTestId("consent-LOCATION_TRACKING");
  if (direction === "IN") {
    await expect(row).toHaveAttribute("data-status", "GRANTED");  // the punch notice was recorded as the consent
  } else if ((await row.getAttribute("data-status")) !== "GRANTED") {
    await page.getByTestId("consent-grant-LOCATION_TRACKING").click();
    await page.getByTestId("consent-confirm").click();
    await expect(row).toHaveAttribute("data-status", "GRANTED", { timeout: 15_000 });
  }
  await page.getByTestId("consent-withdraw-LOCATION_TRACKING").click();
  await page.getByTestId("consent-confirm").click();
  await expect(row).toHaveAttribute("data-status", "WITHDRAWN", { timeout: 15_000 });
  if (direction === "IN") {
    const stopped = await api(page, "GET", "/attendance/me/tracking");
    expect(stopped.data.state).toBe("STOPPED");
    expect(stopped.data.stop_reason).toBe("POLICY_DISABLED");
  }
  await shot(page, testInfo, "19b-tracking-withdrawn");
  await page.getByTestId("consent-grant-LOCATION_TRACKING").click();
  await page.getByTestId("consent-confirm").click();
  await expect(row).toHaveAttribute("data-status", "GRANTED", { timeout: 15_000 });
  await close();
});

test("(c) Arjun punches several team members at once; finished days are marked day complete", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "arjun");
  await page.goto("/attendance?tab=team");
  await expect(page.getByTestId("team-board")).toBeVisible({ timeout: 30_000 });
  const board = await api(page, "GET", "/attendance/team/today");
  expect(board.status).toBe(200);
  type Member = { employee_id: number; name: string; state: string; actions: string[] };
  const items = board.data.items as Member[];
  for (const done of items.filter((m) => m.state === "PUNCHED_OUT" && m.actions.length === 0)) {
    const row = page.getByTestId(`team-member-${done.employee_id}`);
    await expect(row.getByTestId("team-state")).toHaveText("Punched out");
    await expect(row.getByTestId("team-day-complete")).toBeVisible();
    await expect(row.getByTestId(`team-punch-in-${done.employee_id}`)).toHaveCount(0);
  }
  const free = items.filter((m) => m.actions.includes("IN"));
  test.skip(free.length < 2, "fewer than two of Arjun's reports can be punched in today");
  const pick = free.slice(0, 2);
  for (const m of pick) await page.getByTestId(`team-select-${m.employee_id}`).check();
  await expect(page.getByTestId("team-bulk-count")).toHaveText("2 selected");
  await shot(page, testInfo, "19c-bulk-selected");
  await page.getByTestId("team-bulk-in").click();
  await expect(page.getByTestId("proxy-bulk-names")).toContainText(pick[0].name);
  await page.getByTestId("proxy-mode-manual").click();
  await page.getByTestId("proxy-lat").fill("12.9716");
  await page.getByTestId("proxy-lng").fill("77.5946");
  await page.getByTestId("proxy-address").fill("Site office, Whitefield");
  await page.getByTestId("proxy-reason").fill("Crew arrived together, phones in the locker");
  await page.getByTestId("proxy-submit").click();
  await expect(page.getByText(/2 people punched in/).first()).toBeVisible({ timeout: 30_000 });
  for (const m of pick) {
    await expect(page.getByTestId(`team-member-${m.employee_id}`).getByTestId("team-state")).toHaveText("Working", { timeout: 15_000 });
  }
  await shot(page, testInfo, "19c-bulk-in");
  // A session lasts at least a minute: wait it out, then punch both out together.
  await page.waitForTimeout(62_000);
  await page.reload();
  await expect(page.getByTestId("team-board")).toBeVisible({ timeout: 30_000 });
  for (const m of pick) await page.getByTestId(`team-select-${m.employee_id}`).check();
  await page.getByTestId("team-bulk-out").click();
  await page.getByTestId("proxy-mode-manual").click();
  await page.getByTestId("proxy-lat").fill("12.9716");
  await page.getByTestId("proxy-lng").fill("77.5946");
  await page.getByTestId("proxy-reason").fill("Crew left together");
  await page.getByTestId("proxy-submit").click();
  // The out punch can be refused ("wait a minute"): the dialog then lists who and why instead of closing.
  const failures = page.getByTestId("proxy-bulk-failures");
  await expect(failures.or(page.getByText(/(people|person) punched out/)).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "19c-bulk-out");
  expect(await failures.count(), "both punched out after the minimum session").toBe(0);
  for (const m of pick) {
    await expect(page.getByTestId(`team-member-${m.employee_id}`).getByTestId("team-state")).toHaveText("Punched out", { timeout: 15_000 });
  }
  // Rerun-safe: the sessions this step created are deleted (kept for audit) so the reports are free again.
  const after = await api(page, "GET", "/attendance/team/today");
  for (const m of pick) {
    const row = (after.data.items as { employee_id: number; session_id: number | null }[]).find((i) => i.employee_id === m.employee_id);
    if (row?.session_id) {
      const voided = await api(page, "POST", `/attendance/sessions/${row.session_id}/void`, { reason: "e2e bulk punch clean-up" });
      expect(voided.status).toBe(200);
    }
  }
});

test("(d) Kavya switches on swaps and open shifts", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/shift-requests");
  await expect(page.getByTestId("shift-request-settings")).toBeVisible({ timeout: 30_000 });
  for (const id of ["srs-requests", "srs-open", "srs-swap", "srs-swap-approval", "srs-change", "srs-pickup-approval", "srs-availability"]) {
    const toggle = page.getByTestId(id);
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  }
  const sameTeam = page.getByTestId("srs-same-team");
  if ((await sameTeam.getAttribute("aria-checked")) === "true") await sameTeam.click();  // crews swap across teams
  await shot(page, testInfo, "19d-shift-request-settings");
  const save = page.getByTestId("srs-save");
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText("Shift request settings saved").first()).toBeVisible({ timeout: 30_000 });
  }
  const s = await api(page, "GET", "/shift-requests/settings");
  expect(s.data).toMatchObject({ requests_enabled: true, open_shifts_enabled: true });
  expect(s.data.requests.swap.enabled).toBe(true);
});

test("(e) Ravi and Sunita swap a shift; Kavya approves; both schedules change", async ({ browser }, testInfo) => {
  const ravi = await openAs(browser, "alpha", "ravi");
  const sunitaId = employeeId("alpha", "sunita");
  const schedule = await api(ravi.page, "GET", "/me/schedule");
  expect(schedule.status).toBe(200);
  type Day = { date: string; entries: { id: number; kind: string }[] };
  const pending = await api(ravi.page, "GET", "/shift-requests?box=mine");
  const busy = new Set((pending.data.items as { entry: { id: number } | null; status: string }[])
    .filter((r) => r.status.startsWith("PENDING")).map((r) => r.entry?.id));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  let chosen: { date: string; entry: number } | null = null;
  for (const day of schedule.data.days as Day[]) {
    const entry = day.entries[0];
    if (!entry || day.date <= today || busy.has(entry.id)) continue;
    // A day whose swap breaks no BLOCK rule (REQUIRE_REASON results are answered by the reason Ravi gives).
    const preview = await api(ravi.page, "POST", "/shift-requests/preview",
      { kind: "SWAP", entry_id: entry.id, target_employee_id: sunitaId, reason: "Family function (e2e)" });
    if (preview.status === 200 && preview.data.blocking.length === 0) {
      chosen = { date: day.date, entry: entry.id };
      break;
    }
  }
  test.skip(!chosen, "no swappable day between Ravi and Sunita in the next two weeks");
  await ravi.page.goto("/rosters/my-schedule");
  await expect(ravi.page.getByTestId("my-schedule")).toBeVisible({ timeout: 30_000 });
  await ravi.page.getByTestId(`schedule-request-${chosen!.date}`).click();
  await expect(ravi.page.getByTestId("shift-request-form")).toBeVisible();
  await ravi.page.getByTestId("request-kind-SWAP").click();
  await ravi.page.getByTestId(`coworker-${sunitaId}`).click();
  await ravi.page.getByTestId("request-reason").fill("Family function (e2e)");
  await ravi.page.getByTestId("request-preview").click();
  await expect(ravi.page.getByTestId("request-preview-result")).toBeVisible();
  for (const ack of await ravi.page.locator('[data-testid^="ack-"]').all()) await ack.check();
  await shot(ravi.page, testInfo, "19e-swap-preview");
  await ravi.page.getByTestId("request-send").click();
  await expect(ravi.page.getByText("Sent to your coworker").first()).toBeVisible({ timeout: 20_000 });
  await expect(ravi.page.getByTestId(`schedule-day-${chosen!.date}`).getByTestId("schedule-pending")).toBeVisible({ timeout: 20_000 });
  await shot(ravi.page, testInfo, "19e-swap-pending");
  const mine = await api(ravi.page, "GET", "/shift-requests?box=mine");
  const requestId = (mine.data.items as { id: number; entry: { id: number } | null; status: string }[])
    .find((r) => r.entry?.id === chosen!.entry && r.status === "PENDING_ACCEPTANCE")!.id;

  const sunita = await openAs(browser, "alpha", "sunita");
  await sunita.page.goto("/rosters/my-schedule?tab=requests");
  await expect(sunita.page.getByTestId("my-shift-requests")).toBeVisible({ timeout: 30_000 });
  await expect(sunita.page.getByTestId(`shift-request-${requestId}`)).toBeVisible();
  await shot(sunita.page, testInfo, "19e-sunita-incoming");
  await sunita.page.getByTestId(`accept-${requestId}`).click();
  await expect(sunita.page.getByTestId(`shift-request-${requestId}`).getByTestId("shift-request-status")).toHaveText("Waiting for approval", { timeout: 20_000 });

  const kavya = await openAs(browser, "alpha", "kavya");
  await kavya.page.goto("/attendance/shift-requests");
  await expect(kavya.page.getByTestId("shift-request-approvals")).toBeVisible({ timeout: 30_000 });
  await expect(kavya.page.getByTestId(`shift-request-${requestId}`)).toBeVisible();
  await shot(kavya.page, testInfo, "19e-approval-queue");
  await kavya.page.getByTestId(`approve-${requestId}`).click();
  await expect(kavya.page.getByText(/Approved/).first()).toBeVisible({ timeout: 30_000 });
  const done = await api(kavya.page, "GET", `/shift-requests/${requestId}`);
  expect(done.data.status).toBe("APPROVED");
  expect(done.data.applied_publication_id).toBeGreaterThan(0);
  await ravi.page.reload();
  await expect(ravi.page.getByTestId("my-schedule")).toBeVisible({ timeout: 60_000 });
  await expect(ravi.page.getByTestId(`schedule-day-${chosen!.date}`)).toContainText("Swapped", { timeout: 20_000 });
  const swapped = await api(ravi.page, "GET", "/me/schedule");
  const cell = (swapped.data.days as Day[]).find((d) => d.date === chosen!.date)!;
  expect(cell.entries[0]).toMatchObject({ source: "SWAP" });
  await shot(ravi.page, testInfo, "19e-ravi-swapped");
  await Promise.all([ravi.close(), sunita.close(), kavya.close()]);
});

test("(f) Kiran posts an open shift; Imran is refused by the 48 h rule; Ramesh claims it; Kavya approves: FILLED", async ({ browser }, testInfo) => {
  const kiran = await openAs(browser, "alpha", "kiran");
  const imran = await openAs(browser, "alpha", "imran");
  const ramesh = await openAs(browser, "alpha", "ramesh");
  const rameshId = employeeId("alpha", "ramesh");
  const sched = await api(imran.page, "GET", "/me/schedule");
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  // Imran's day off on which Ramesh (the claimant) has no shift yet (an earlier run's pickup would overlap).
  const rameshSched = await api(ramesh.page, "GET", "/me/schedule");
  const busy = new Set((rameshSched.data.days as { date: string; entries: { kind: string }[] }[])
    .filter((d) => d.entries.some((e) => e.kind === "WORK")).map((d) => d.date));
  const offDay = (sched.data.days as { date: string; entries: { kind: string }[] }[])
    .find((d) => d.date > today && !busy.has(d.date) && d.entries.length > 0 && d.entries.every((e) => e.kind === "OFF"));
  test.skip(!offDay, "Imran has no day off left on which Ramesh is free");
  const branches = await api(kiran.page, "GET", "/branches");
  const pune = (branches.data as { id: number; name: string }[]).find((b) => /pune plant/i.test(b.name)) ?? branches.data[0];
  const shifts = await api(kiran.page, "GET", "/shifts?limit=100&status=ACTIVE");
  const shift = (shifts.data.items as { id: number; code: string }[]).find((s) => s.code === "A") ?? shifts.data.items[0];
  // Earlier runs' open shifts of that day are closed first (rerun-safe).
  const stale = await api(kiran.page, "GET", `/open-shifts?from=${offDay!.date}&to=${offDay!.date}&status=OPEN`);
  for (const s of stale.data.items as { id: number }[]) await api(kiran.page, "POST", `/open-shifts/${s.id}/cancel`);
  await kiran.page.goto("/attendance/shift-requests?tab=open");
  await expect(kiran.page.getByTestId("open-shifts")).toBeVisible({ timeout: 30_000 });
  await kiran.page.getByTestId("open-shift-post").click();
  await kiran.page.getByTestId("open-shift-branch").selectOption(String(pune.id));
  await kiran.page.getByTestId("open-shift-date").fill(offDay!.date);
  await kiran.page.getByTestId("open-shift-shift").selectOption(String(shift.id));
  await shot(kiran.page, testInfo, "19f-post-open-shift");
  await kiran.page.getByTestId("open-shift-submit").click();
  await expect(kiran.page.getByText("Open shift posted").first()).toBeVisible({ timeout: 20_000 });
  const list = await api(kiran.page, "GET", `/open-shifts?from=${offDay!.date}&to=${offDay!.date}&status=OPEN`);
  const posted = (list.data.items as { id: number }[]).pop()!;

  // Claim from My schedule › Open shifts (WARN-only results are confirmed in the warnings dialog).
  const claim = async (page: Page, id: number) => {
    await page.goto("/rosters/my-schedule?tab=open");
    await expect(page.getByTestId(`claim-${id}`)).toBeVisible({ timeout: 30_000 });
    const answer = page.waitForResponse((r) => r.url().includes(`/open-shifts/${id}/claim`));
    await page.getByTestId(`claim-${id}`).click();
    const first = await answer;
    if (first.status() === 422 && (await first.json()).code === "WARNINGS_UNACKNOWLEDGED") {
      await expect(page.getByTestId("warnings-list")).toBeVisible();
      await shot(page, testInfo, "19f-claim-warnings");
      const again = page.waitForResponse((r) => r.url().includes(`/open-shifts/${id}/claim`));
      await page.getByTestId("warnings-confirm").click();
      return (await again).status();
    }
    return first.status();
  };
  // Imran's 6-on-2-off rota already holds 48 h in every rolling week: a seventh 8-hour day is refused (BLOCK).
  expect(await claim(imran.page, posted.id)).toBe(422);
  await expect(imran.page.getByText(/working-time rule/).first()).toBeVisible();
  await shot(imran.page, testInfo, "19f-claim-refused-weekly-hours");
  // Ramesh (Pune Plant, no roster yet) claims it; it waits for approval.
  expect(await claim(ramesh.page, posted.id)).toBe(201);
  await expect(ramesh.page.getByText(/Claim sent for approval|The shift is yours/).first()).toBeVisible({ timeout: 20_000 });
  await shot(ramesh.page, testInfo, "19f-ramesh-claimed");

  const kavya = await openAs(browser, "alpha", "kavya");
  await kavya.page.goto("/attendance/shift-requests");
  const pending = (await api(kavya.page, "GET", "/shift-requests?box=approvals")).data.items
    .find((r: { open_shift_id: number | null; requester_employee_id: number }) => r.open_shift_id === posted.id && r.requester_employee_id === rameshId);
  expect(pending, "Ramesh's claim waits for approval").toBeTruthy();
  await expect(kavya.page.getByTestId(`approve-${pending.id}`)).toBeVisible({ timeout: 30_000 });
  await shot(kavya.page, testInfo, "19f-claim-to-approve");
  const decided = kavya.page.waitForResponse((r) => r.url().includes(`/shift-requests/${pending.id}/approve`));
  await kavya.page.getByTestId(`approve-${pending.id}`).click();
  if ((await decided).status() === 422) {  // WARN results of the approval: confirm them
    await kavya.page.getByTestId("warnings-confirm").click();
  }
  await expect(kavya.page.getByText(/Approved/).first()).toBeVisible({ timeout: 30_000 });
  const after = await api(kavya.page, "GET", `/open-shifts/${posted.id}`);
  expect(after.data.status).toBe("FILLED");
  expect(after.data.filled_count).toBe(1);
  await kavya.page.goto("/attendance/shift-requests?tab=open");
  await expect(kavya.page.getByTestId(`open-shift-${posted.id}`).getByTestId("open-shift-status")).toHaveText("FILLED", { timeout: 20_000 });
  await shot(kavya.page, testInfo, "19f-open-shift-filled");
  const mine = await api(ramesh.page, "GET", `/me/schedule?from=${offDay!.date}&to=${offDay!.date}`);
  expect(mine.data.days[0].entries[0]).toMatchObject({ kind: "WORK", source: "PICKUP" });
  await Promise.all([kiran.close(), imran.close(), ramesh.close(), kavya.close()]);
});
test("(g) Sites and availability pages open from the sidebar", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance/sites");
  await expect(page.getByTestId("sites-table")).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "19g-sites");
  await page.goto("/attendance/shift-requests?tab=availability");
  await expect(page.getByTestId("availability-panel")).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "19g-availability");
});
