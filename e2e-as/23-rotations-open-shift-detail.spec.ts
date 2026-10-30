/**
 * S2–S5 sub-agent round Chrome checks (IG-AS-160..167) on the time stack 8500/3500, rerun-safe:
 * (a) the Rotations page (A16): Patterns and Assignments tabs, the last automatic publish, New rotation / Assign;
 * (b) the pattern editor page shows the active version;
 * (c) ⋯ End assignment (UA-AS-161): a dedicated pattern E2E-S6-END is assigned to one person from a free day and the
 *     founder ends it in the UI; the row turns Ended;
 * (d) the open-shift detail page for a planner (claims) and for a claimant (their own claim);
 * (e) the roster grid moves focus with the arrow keys (one tab stop);
 * (f) the readiness packs panel (exemptions are listed there once held).
 */
import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

test("(a)–(c) Rotations page, pattern editor and ending an assignment", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "founder");
  const patterns = (await api(page, "GET", "/rotations")).data as any[];
  const seed = patterns.find((p) => p.code === "PUNE-6ON2OFF");
  expect(seed, "seeded rotation").toBeTruthy();

  await test.step("(a) the Rotations page lists the patterns and the assignments", async () => {
    await page.goto("/attendance/rotations");
    await expect(page.getByRole("heading", { name: "Rotations" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("PUNE-6ON2OFF").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /New rotation/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Assign rotation/ })).toBeVisible();
    await shot(page, testInfo, "23a-rotations-patterns");
    await page.getByRole("tab", { name: /Assignments/ }).click();
    await expect(page.getByRole("table", { name: /Rotation assignments/ }).or(page.getByText("Rotation assignments")).first()).toBeVisible();
    await shot(page, testInfo, "23a-rotations-assignments");
    await page.getByRole("button", { name: /Assign rotation/ }).click();
    await expect(page.getByTestId("rotation-assign")).toBeVisible();
    await shot(page, testInfo, "23a-assign-modal");
    await page.keyboard.press("Escape");
  });

  await test.step("(b) the pattern editor shows the active version", async () => {
    await page.goto(`/attendance/rotations/${seed.id}`);
    await expect(page.getByText("PUNE-6ON2OFF").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("version-status").first()).toBeVisible();
    await shot(page, testInfo, "23b-pattern-editor");
  });

  await test.step("(c) the founder ends an assignment; it turns Ended", async () => {
    let pattern = patterns.find((p) => p.code === "E2E-S6-END");
    const active = seed.versions.find((v: any) => v.id === seed.current_version_id);
    if (!pattern) {
      const created = await api(page, "POST", "/rotations", {
        code: "E2E-S6-END", name: "S6 end-assignment check", template_key: seed.template_key,
        version: { token_map: active.token_map } });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const activated = await api(page, "POST", `/rotations/${created.data.id}/versions/1/activate`);
      expect(activated.status, JSON.stringify(activated.data)).toBe(200);
      pattern = ((await api(page, "GET", "/rotations")).data as any[]).find((p) => p.code === "E2E-S6-END");
    }
    const crews = Object.keys(active.crew_rows ?? active.crew_offsets ?? { A: 0 });
    const all = (await api(page, "GET", "/rotation-assignments?limit=500")).data.items as any[];
    // One person, starting the day after anything they already follow (each run ends on its first day).
    let chosen: { id: number; start: string } | null = null;
    for (const person of ["farah", "omar", "anjali", "leena"]) {
      const id = employeeId("alpha", person);
      const mine = all.filter((a) => a.employee_id === id);
      if (mine.some((a) => !a.effective_to)) continue;
      const last = mine.map((a) => a.effective_to as string).sort().pop();
      const start = last && last >= todayIst() ? addDays(last, 1) : todayIst();
      chosen = { id, start };
      break;
    }
    expect(chosen, "a person without an open-ended rotation").toBeTruthy();
    const assigned = await api(page, "POST", "/rotation-assignments", {
      pattern_version_id: pattern.current_version_id, employee_ids: [chosen!.id], crew_code: crews[0], offset_days: 0,
      anchor_date: chosen!.start, effective_from: chosen!.start });
    expect(assigned.status, JSON.stringify(assigned.data)).toBe(201);
    const row = assigned.data.items[0];

    await page.goto(`/attendance/rotations/${pattern.id}?tab=assignments`);
    // The table also renders a mobile card per row: use the visible copy.
    const menu = page.locator(`[data-testid="assignment-menu-${row.id}"]:visible`);
    await expect(menu).toBeVisible({ timeout: 30_000 });
    await shot(page, testInfo, "23c-assignment-active");
    await menu.click();
    await page.getByRole("menuitem", { name: /End assignment/ }).click();
    const modal = page.getByTestId("end-assignment");
    await expect(modal).toBeVisible();
    await page.getByTestId("end-submit").click();  // no reason yet: refused in the form
    await expect(modal.getByText("Give a reason.")).toBeVisible();
    await modal.getByRole("textbox").last().fill("Moves to the day crew (S6 Chrome check)");
    await shot(page, testInfo, "23c-end-modal");
    await page.getByTestId("end-submit").click();
    await expect(page.getByTestId(`assignment-menu-${row.id}`)).toHaveCount(0, { timeout: 30_000 });
    const after = ((await api(page, "GET", "/rotation-assignments?limit=500")).data.items as any[]).find((a) => a.id === row.id);
    expect(after.status).toBe("ENDED");
    expect(after.effective_to).toBe(chosen!.start);
    await shot(page, testInfo, "23c-assignment-ended");
  });
});

test("(d) the open-shift detail page for a planner and a claimant", async ({ browser }, testInfo) => {
  const kiran = await openAs(browser, "alpha", "kiran");
  const ramesh = await openAs(browser, "alpha", "ramesh");
  for (const [who, person] of [["planner-kiran", kiran], ["claimant-ramesh", ramesh]] as const) {
    const list = await api(person.page, "GET", "/open-shifts?limit=50");
    expect(list.status, JSON.stringify(list.data)).toBe(200);
    const item = (list.data.items ?? list.data)[0];
    test.skip(!item, `no open shift visible to ${who}`);
    await person.page.goto(`/attendance/open-shifts/${item.id}`);
    await expect(person.page.getByTestId("open-shift-detail")).toBeVisible({ timeout: 30_000 });
    await expect(person.page.getByTestId("open-shift-status")).toBeVisible();
    if (who.startsWith("planner")) await expect(person.page.getByTestId("open-shift-claims")).toBeVisible();
    else await expect(person.page.getByTestId("open-shift-claims")).toHaveCount(0);  // claimants never see others' claims
    await shot(person.page, testInfo, `23d-open-shift-detail-${who}`);
  }
  await Promise.all([kiran.close(), ramesh.close()]);
});

test("(e) the roster grid moves focus with the arrow keys", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kiran");
  const period = ((await api(page, "GET", "/rosters?limit=200")).data.items as any[]).find((p) => p.code === "RP-PUNE-PROD-2026-11");
  expect(period, "seeded period").toBeTruthy();
  const ravi = employeeId("alpha", "ravi");
  await page.goto(`/rosters/${period.id}`);
  await expect(page.getByTestId("roster-grid")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId(`cell-${ravi}-2026-11-04`);
  await start.focus();
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("[data-testid^='cell-']")?.getAttribute("data-testid"));
  expect(await focused()).toBe(`cell-${ravi}-2026-11-04`);
  await page.keyboard.press("ArrowRight");
  expect(await focused()).toBe(`cell-${ravi}-2026-11-05`);
  await page.keyboard.press("ArrowLeft");
  expect(await focused()).toBe(`cell-${ravi}-2026-11-04`);
  await shot(page, testInfo, "23e-grid-keyboard-focus");
});

test("(f) the readiness packs panel", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "founder");
  await page.goto("/settings/attendance/readiness?tab=packs");
  await expect(page.getByTestId("packs")).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, "23f-readiness-packs");
});
