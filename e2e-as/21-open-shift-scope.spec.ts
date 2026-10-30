/**
 * Shift module S3 (G-15 / AS-M6; 03-shifts/03 §6.3, §12.3; SP-AS-045; FU-AS-49 / -50) on the time stack:
 *
 * (a) Kiran (Roster planner) posts a tenant-wide open shift at a branch where Imran does not work. On My schedule › Open shifts
 *     Imran does not see it by default (only shifts he can claim); "Show shifts I can't take" lists it with its
 *     reason and no Claim button.
 * (b) Kiran edits it through PATCH /open-shifts/{id}: a stale row_version is refused (409 ROW_VERSION_CONFLICT), the
 *     count and the note change, an expiry later than the current one is refused (422); then he cancels it.
 *
 * Rerun-safe: the open shift is cancelled at the end; earlier leftovers on the date are cancelled first.
 */
import { api, employeeId, expect, openAs, shot, test } from "./support";

const ahead = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

test("(a)+(b) an open shift Imran cannot take is hidden until he asks; Kiran edits and cancels it", async ({ browser }, testInfo) => {
  const kiran = await openAs(browser, "alpha", "kiran");
  const imran = await openAs(browser, "alpha", "imran");
  const imranId = employeeId("alpha", "imran");
  const branches = (await api(kiran.page, "GET", "/branches")).data as { id: number; name: string }[];
  const placement = await api(kiran.page, "GET", `/employees/${imranId}`);
  const home = placement.data?.branch_id ?? branches.find((b) => /pune plant/i.test(b.name))?.id;
  const elsewhere = branches.find((b) => b.id !== home);
  test.skip(!elsewhere, "Alpha has only one branch");
  // A tenant-wide shift: a branch- or entity-owned one is refused at another branch (422 SHIFT_SCOPE, IG-AS-138).
  const shifts = await api(kiran.page, "GET", "/shifts?limit=100&status=ACTIVE");
  type ShiftRow = { id: number; code: string; branch_id: number | null; legal_entity_id: number | null };
  const shift = (shifts.data.items as ShiftRow[]).find((s) => s.branch_id === null && s.legal_entity_id === null);
  test.skip(!shift, "Alpha has no tenant-wide shift");
  const day = ahead(24);
  const stale = await api(kiran.page, "GET", `/open-shifts?from=${day}&to=${day}&status=OPEN`);
  for (const s of stale.data.items as { id: number }[]) await api(kiran.page, "POST", `/open-shifts/${s.id}/cancel`);

  const posted = await api(kiran.page, "POST", "/open-shifts", {
    branch_id: elsewhere!.id, shift_date: day, shift_id: shift!.id, required_count: 1, approval_required: true,
  });
  expect(posted.status, JSON.stringify(posted.data)).toBe(201);
  const id = posted.data.id as number;

  // (a) Imran's board: hidden by default, listed with its reason once he asks.
  await imran.page.goto("/rosters/my-schedule?tab=open");
  await expect(imran.page.getByTestId("open-shifts")).toBeVisible({ timeout: 30_000 });
  await expect(imran.page.getByTestId("open-shifts-show-all")).toBeVisible();
  await expect(imran.page.getByTestId(`open-shift-${id}`)).toHaveCount(0);
  await shot(imran.page, testInfo, "21a-board-default");
  // The checkbox follows the URL (eligible_only=false), which updates after the click: wait for it, don't .check().
  await imran.page.getByTestId("open-shifts-show-all").click();
  await expect(imran.page.getByTestId("open-shifts-show-all")).toBeChecked({ timeout: 20_000 });
  const card = imran.page.getByTestId(`open-shift-${id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId(`claim-${id}`)).toHaveCount(0);
  await shot(imran.page, testInfo, "21a-board-show-all");
  const direct = await api(imran.page, "POST", `/open-shifts/${id}/claim`, {});
  expect(direct.status).toBe(422);
  expect(direct.data.code).toBe("NOT_ELIGIBLE");

  // (b) Kiran edits through PATCH, then cancels.
  const version = posted.data.row_version as number;
  const conflict = await api(kiran.page, "PATCH", `/open-shifts/${id}`, { row_version: version + 9, required_count: 2 });
  expect(conflict.status).toBe(409);
  expect(conflict.data.code).toBe("ROW_VERSION_CONFLICT");
  const edited = await api(kiran.page, "PATCH", `/open-shifts/${id}`, { row_version: version, required_count: 2, note: "Two people" });
  expect(edited.status, JSON.stringify(edited.data)).toBe(200);
  expect(edited.data).toMatchObject({ required_count: 2, note: "Two people", status: "OPEN" });
  const later = new Date(new Date(edited.data.expires_at).getTime() + 3_600_000).toISOString();
  const refused = await api(kiran.page, "PATCH", `/open-shifts/${id}`, { row_version: edited.data.row_version, expires_at: later });
  expect(refused.status).toBe(422);
  await kiran.page.goto("/attendance/shift-requests?tab=open");
  await expect(kiran.page.getByTestId(`open-shift-${id}`).first()).toBeVisible({ timeout: 30_000 });
  await shot(kiran.page, testInfo, "21b-planner-board-edited");
  const cancelled = await api(kiran.page, "POST", `/open-shifts/${id}/cancel`);
  expect(cancelled.data.status).toBe("CANCELLED");
  await Promise.all([kiran.close(), imran.close()]);
});

test("(c) the Open shifts page (A14) serves claimants and planners", async ({ browser }, testInfo) => {
  const imran = await openAs(browser, "alpha", "imran");
  const kiran = await openAs(browser, "alpha", "kiran");
  for (const [who, person] of [["imran", imran], ["kiran", kiran]] as const) {
    await person.page.goto("/attendance/open-shifts");
    await expect(person.page.getByRole("heading", { name: "Open shifts" })).toBeVisible({ timeout: 30_000 });
    await expect(person.page.getByTestId("open-shifts")).toBeVisible({ timeout: 30_000 });
    await expect(person.page.getByTestId("open-shifts-show-all")).toBeVisible();
    await shot(person.page, testInfo, `21c-open-shifts-${who}`);
  }
  await expect(kiran.page.getByTestId("open-shift-post")).toBeVisible();  // planners post
  await expect(imran.page.getByTestId("open-shift-post")).toHaveCount(0);  // claimants do not
  await Promise.all([kiran.close(), imran.close()]);
});

test("(d) Ramesh claims on the Open shifts page; Kavya approves; the open shift is FILLED", async ({ browser }, testInfo) => {
  const kiran = await openAs(browser, "alpha", "kiran");
  const ramesh = await openAs(browser, "alpha", "ramesh");
  const rameshId = employeeId("alpha", "ramesh");
  // Rerun-safe: every run leaves Ramesh a PICKUP, and six of them inside seven days break the 48 h rolling week
  // (BLOCK). Take a day 8–29 days ahead (the board lists 30 days) with no roster entry three days either side, so
  // any week around it holds at most four other entries. (Rules run on published entries ⊕ the change, 03 §4.3;
  // his daily placement shift is not an entry.)
  const schedule = await api(ramesh.page, "GET", `/me/schedule?from=${ahead(5)}&to=${ahead(32)}`);
  const busy = new Set((schedule.data.days as { date: string; entries: unknown[] }[])
    .filter((d) => d.entries.length > 0).map((d) => d.date));
  const day = Array.from({ length: 22 }, (_, i) => 8 + i)
    .find((n) => [-3, -2, -1, 0, 1, 2, 3].every((k) => !busy.has(ahead(n + k))));
  test.skip(day === undefined, "Ramesh has no free week around any day 8–29 days ahead");
  const shiftDate = ahead(day!);
  const branches = (await api(kiran.page, "GET", "/branches")).data as { id: number; name: string }[];
  const home = branches.find((b) => /pune plant/i.test(b.name))!.id;  // Ramesh's branch in the seed (as in 19 f)
  const shifts = (await api(kiran.page, "GET", "/shifts?limit=100&status=ACTIVE")).data.items as
    { id: number; branch_id: number | null; legal_entity_id: number | null }[];
  const shift = shifts.find((s) => s.branch_id === null && s.legal_entity_id === null)!;
  const stale = await api(kiran.page, "GET", `/open-shifts?from=${shiftDate}&to=${shiftDate}&status=OPEN`);
  for (const s of stale.data.items as { id: number }[]) await api(kiran.page, "POST", `/open-shifts/${s.id}/cancel`);
  const posted = await api(kiran.page, "POST", "/open-shifts", {
    branch_id: home, shift_date: shiftDate, shift_id: shift.id, required_count: 1, approval_required: true,
  });
  expect(posted.status, JSON.stringify(posted.data)).toBe(201);
  const id = posted.data.id as number;

  await ramesh.page.goto("/attendance/open-shifts");
  await expect(ramesh.page.getByTestId(`claim-${id}`)).toBeVisible({ timeout: 30_000 });
  const answer = ramesh.page.waitForResponse((r) => r.url().includes(`/open-shifts/${id}/claim`));
  await ramesh.page.getByTestId(`claim-${id}`).click();
  const first = await answer;
  if (first.status() === 422) {  // WARN-only results: confirm them in the dialog
    const body = await first.json();
    expect(body.code, JSON.stringify(body)).toBe("WARNINGS_UNACKNOWLEDGED");
    const again = ramesh.page.waitForResponse((r) => r.url().includes(`/open-shifts/${id}/claim`));
    await ramesh.page.getByTestId("warnings-confirm").click();
    expect((await again).status()).toBe(201);
  }
  await expect(ramesh.page.getByText(/Claim sent for approval/).first()).toBeVisible({ timeout: 20_000 });
  await shot(ramesh.page, testInfo, "21d-ramesh-claimed");

  const kavya = await openAs(browser, "alpha", "kavya");
  const pending = (await api(kavya.page, "GET", "/shift-requests?box=approvals")).data.items
    .find((r: { open_shift_id: number | null; requester_employee_id: number }) => r.open_shift_id === id && r.requester_employee_id === rameshId);
  expect(pending, "Ramesh's claim waits for approval").toBeTruthy();
  await kavya.page.goto("/attendance/shift-requests");
  await expect(kavya.page.getByTestId(`approve-${pending.id}`)).toBeVisible({ timeout: 30_000 });
  const decided = kavya.page.waitForResponse((r) => r.url().includes(`/shift-requests/${pending.id}/approve`));
  await kavya.page.getByTestId(`approve-${pending.id}`).click();
  if ((await decided).status() === 422) await kavya.page.getByTestId("warnings-confirm").click();
  await expect(kavya.page.getByText(/Approved/).first()).toBeVisible({ timeout: 30_000 });
  const after = await api(kavya.page, "GET", `/open-shifts/${id}`);
  expect(after.data).toMatchObject({ status: "FILLED", filled_count: 1 });
  const mine = await api(ramesh.page, "GET", `/me/schedule?from=${shiftDate}&to=${shiftDate}`);
  expect(mine.data.days[0].entries[0]).toMatchObject({ kind: "WORK", source: "PICKUP" });
  await shot(kavya.page, testInfo, "21d-approved");
  await Promise.all([kiran.close(), ramesh.close(), kavya.close()]);
});

test("(e) Kavya switches the planner-cannot-publish rule on and back off (AS-ROS-11)", async ({ browser }, testInfo) => {
  const kavya = await openAs(browser, "alpha", "kavya");
  const toggle = async (on: boolean) => {
    await kavya.page.goto("/settings/attendance/shift-requests");
    await expect(kavya.page.getByTestId("shift-request-settings")).toBeVisible({ timeout: 30_000 });
    const sod = kavya.page.getByTestId("srs-sod");
    if (((await sod.getAttribute("aria-checked")) === "true") !== on) await sod.click();
    await kavya.page.getByTestId("srs-save").click();
    await expect(kavya.page.getByText("Shift request settings saved").first()).toBeVisible({ timeout: 30_000 });
  };
  try {
    await toggle(true);  // Alpha has more than one Publish schedules holder (V-AS-05 passes)
    expect((await api(kavya.page, "GET", "/shift-requests/settings")).data.planner_cannot_publish).toBe(true);
    await shot(kavya.page, testInfo, "21e-sod-on");
  } finally {
    await toggle(false);  // other specs publish as the planner who drafted
  }
  expect((await api(kavya.page, "GET", "/shift-requests/settings")).data.planner_cannot_publish).toBe(false);
  await kavya.close();
});

test("(f) an employee opening a roster period sees only their own row and no drafts (IG-AS-144)", async ({ browser }) => {
  const kiran = await openAs(browser, "alpha", "kiran");
  const imran = await openAs(browser, "alpha", "imran");
  const imranId = employeeId("alpha", "imran");
  const periods = (await api(kiran.page, "GET", "/rosters?limit=200")).data.items as { id: number }[];
  let checked = 0;
  for (const period of periods) {
    const planner = (await api(kiran.page, "GET", `/rosters/${period.id}`)).data;
    if (!(planner.employees as { id: number }[]).some((e) => e.id === imranId) || planner.employees.length < 2) continue;
    const own = await api(imran.page, "GET", `/rosters/${period.id}`);
    expect(own.status).toBe(200);
    expect((own.data.employees as { id: number }[]).map((e) => e.id)).toEqual([imranId]);
    expect((own.data.entries as { employee_id: number }[]).every((e) => e.employee_id === imranId)).toBe(true);
    expect(own.data.drafts).toEqual([]);
    checked += 1;
    break;
  }
  test.skip(checked === 0, "no roster period with Imran and a colleague");
  await Promise.all([kiran.close(), imran.close()]);
});
