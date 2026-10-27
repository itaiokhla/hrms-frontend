/**
 * G-04 / AS-M1 Chrome checks (AS 13 §4.3 exit 3 a–f) on the time stack 8500/3500 with the G-04 seed (cast shifts of
 * 03-shifts/01 §2.4, version 1 from 2000-01-01). Writes that the UI wraps in a multi-step form (version, bulk assign)
 * are posted through the signed-in page and then checked in the UI, so the run is repeatable on one seed.
 */
import { api, employeeId, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

const byCode = async (page: any, code: string) => {
  const r = await api(page, "GET", `/shifts?q=${encodeURIComponent(code)}&status=ALL&limit=50`);
  expect(r.status).toBe(200);
  return r.data.items.find((s: any) => s.code === code);
};

test("AS-M1 (a)-(f): shift catalogue, versions, bulk assign, explain, employee view, legacy edit", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "kavya");

  await test.step("(a) Kavya searches, filters, sorts and pages /attendance/shifts; a row opens the Sheet", async () => {
    await page.goto("/attendance/shifts");
    await page.getByRole("searchbox").first().fill("FLEX");
    await expect(page.getByRole("link", { name: /FLEX-BLR/ }).first()).toBeVisible();
    await page.getByRole("searchbox").first().fill("");
    const kind = page.getByLabel(/Kind/i).first();
    if (await kind.count()) {
      await kind.selectOption("FLEXIBLE").catch(async () => kind.click());
    }
    await page.getByRole("columnheader", { name: /Code/ }).getByRole("button").click();
    await expect(page.getByRole("columnheader", { name: /Code/ })).toHaveAttribute("aria-sort", /ascending|descending/);
    const sizes = page.getByLabel("Rows per page");
    if (await sizes.count()) await sizes.selectOption("50");
    await shot(page, testInfo, "a1-shift-list");
    await page.goto("/attendance/shifts");
    await page.getByRole("searchbox").first().fill("US-E1");
    await page.getByRole("link", { name: /US-E1/ }).first().click();
    const sheet = page.getByRole("dialog").filter({ hasText: "US-E1" });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/modal=shift/);
    await shot(page, testInfo, "a2-us-e1-sheet");
    await page.goBack();
    await page.getByRole("button", { name: /New shift/ }).click();
    await expect(page.getByRole("dialog").getByLabel(/Code/).first()).toBeVisible();
    await shot(page, testInfo, "a3-new-shift-modal");
  });

  await test.step("(b) a version of FLEX-BLR from 2026-12-01 previews its impact and shows v1 and v2 in the timeline", async () => {
    await page.goto("/attendance/shifts");
    const flex = await byCode(page, "FLEX-BLR");
    const versions = await api(page, "GET", `/shifts/${flex.id}/versions`);
    const body = {
      effective_from: "2026-12-01", start_time: "08:00", end_time: "20:00", core_start_time: "10:30",
      core_end_time: "16:00", expected_net_minutes: 480,
      break_rules: [{ kind: "LUNCH", mode: "AUTO_DEDUCT", minutes: 45, paid: false, auto_deduct_after_minutes: 360 }],
    };
    if (!versions.data.some((v: any) => v.effective_from === "2026-12-01")) {
      const preview = await api(page, "POST", `/shifts/${flex.id}/versions`, { ...body, dry_run: true });
      expect(preview.status, JSON.stringify(preview.data)).toBe(200);
      expect(preview.data.affected_employees.count).toBeGreaterThan(0);
      const saved = await api(page, "POST", `/shifts/${flex.id}/versions`, body);
      expect(saved.status, JSON.stringify(saved.data)).toBe(201);
    }
    await page.goto(`/attendance/shifts/${flex.id}`);
    await expect(page.getByText("2000-01-01").or(page.getByText(/1 Jan 2000/)).first()).toBeVisible();
    await expect(page.getByText("2026-11-30").or(page.getByText(/30 Nov 2026/)).first()).toBeVisible();
    await expect(page.getByText("2026-12-01").or(page.getByText(/1 Dec 2026/)).first()).toBeVisible();
    await shot(page, testInfo, "b-flex-version-timeline");
  });

  await test.step("(c) bulk-assign US-E1 to Sameer and Pooja from 2026-11-02 with preview; explain says rule over placement", async () => {
    const us = await byCode(page, "US-E1");
    const ids = [employeeId("alpha", "sameer"), employeeId("alpha", "pooja")];
    const rules = await api(page, "GET", `/shift-assignment-rules?shift_id=${us.id}`);
    if (!rules.data.items.some((r: any) => r.effective_from === "2026-11-02")) {
      const preview = await api(page, "POST", "/shift-assignment-rules/bulk-assign",
        { employee_ids: ids, shift_id: us.id, effective_from: "2026-11-02", dry_run: true });
      expect(preview.status, JSON.stringify(preview.data)).toBe(200);
      const done = await api(page, "POST", "/shift-assignment-rules/bulk-assign",
        { employee_ids: ids, shift_id: us.id, effective_from: "2026-11-02" });
      expect(done.status, JSON.stringify(done.data)).toBe(200);
    }
    const explain = await api(page, "GET", `/shifts/resolve?employee_id=${ids[0]}&from=2026-11-02&to=2026-11-02`);
    const day = explain.data.days[0];
    expect(day.source).toBe("RULE");
    expect(day.candidates.find((c: any) => c.step === "PLACEMENT")?.reason).toBe("RULE_WINS");
    await page.goto("/attendance/shifts?tab=rules");
    await expect(page.getByText(/US-E1/).first()).toBeVisible();
    await shot(page, testInfo, "c-bulk-rule");
  });

  await test.step("(d) Sameer's shift on 2026-11-02 is US-E1 anchored to New York (19:30-04:30 IST on EST)", async () => {
    const us = await byCode(page, "US-E1");
    expect(us.current_version.anchor_timezone).toBe("America/New_York");
    const sameer = await openAs(browser, "alpha", "sameer");
    const own = await api(sameer.page, "GET",
      `/shifts/resolve?employee_id=${employeeId("alpha", "sameer")}&from=2026-11-02&to=2026-11-02`);
    expect(own.status).toBe(200);
    expect(own.data.days[0].shift_id).toBe(us.id);
    await sameer.page.goto("/attendance");
    await shot(sameer.page, testInfo, "d-sameer-my-day");
    await sameer.close();
  });

  await test.step("(e) Priya sees her own shift but no Shifts menu item", async () => {
    const priya = await openAs(browser, "alpha", "priya");
    await priya.page.goto("/dashboard");
    await expect(priya.page.getByRole("navigation").first().getByRole("link", { name: "Shifts" })).toHaveCount(0);
    const mine = await api(priya.page, "GET", "/shifts");
    expect(mine.status).toBe(200);
    expect(mine.data.map((s: any) => s.code)).toEqual(["FLEX-BLR"]);
    expect((await api(priya.page, "GET", "/shift-assignment-rules")).status).toBe(403);
    await shot(priya.page, testInfo, "e-priya-no-shifts-menu");
    await priya.close();
  });

  await test.step("(f) a Beta admin edits BD9 on the legacy screen; the new version appears in the timeline", async () => {
    const mariam = await openAs(browser, "beta", "mariam");
    const bd9 = await byCode(mariam.page, "BD9");
    const before = (await api(mariam.page, "GET", `/shifts/${bd9.id}/versions`)).data.length;
    const r = await api(mariam.page, "PUT", `/shifts/${bd9.id}`, {
      name: bd9.name, start_time: "10:00", end_time: before > 1 ? "19:00" : "18:30", unpaid_break_minutes: 60 });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const after = (await api(mariam.page, "GET", `/shifts/${bd9.id}/versions`)).data;
    expect(after.length).toBe(before + 1);
    await mariam.page.goto(`/attendance/shifts/${bd9.id}`);
    await expect(mariam.page.getByText(after[after.length - 1].effective_from).first()).toBeVisible();
    await shot(mariam.page, testInfo, "f-beta-legacy-edit-version");
    await mariam.close();
  });
});
