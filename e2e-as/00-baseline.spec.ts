/**
 * G-01 / AS-M0 Chrome checks (AS 13 §4.1 exit 4 (a)-(f)), run in that order on the time stack 8500/3500 against
 * the G-01 seed. Each check is one step with a screenshot in test-evidence/<date>-g01/.
 */
import { account, api, employeeId, expect, openAs, shot, signIn, test, toast } from "./support";

test.describe.configure({ mode: "serial" });

test("AS-M0 (a)-(f): punches, overnight manual entry, paged history, settings, OT offsets, unpaid break (LH-REL-14 attendance guard)", async ({ page, browser }, testInfo) => {
  // (a) runs without the camera step: the face step itself is e2e/06 (unchanged). The company administrator
  // (settings:manage) turns it off for Alpha.
  const admin = await openAs(browser, "alpha", "founder");
  const policy = await api(admin.page, "PATCH", "/attendance/policy", { requireFaceForSelfCheckIn: false });
  expect(policy.status).toBe(200);
  await admin.close();
  await signIn(page, "alpha", "kavya");

  await test.step("(a) Priya Shah punches in and out on /attendance with today's toasts", async () => {
    const priya = await openAs(browser, "alpha", "priya");
    await priya.page.goto("/attendance");
    // One session per day: a rerun on the same seed and day finds her punched out already (the first run did it).
    const state = (await api<{ attendance_state: string }>(priya.page, "GET", "/attendance/me/today")).data.attendance_state;
    if (state === "PUNCHED_OUT") {
      testInfo.annotations.push({ type: "rerun", description: "Priya already punched in and out today on this seed" });
      await shot(priya.page, testInfo, "a-priya-done-for-today");
      await priya.close();
      return;
    }
    const punchIn = priya.page.getByRole("button", { name: "Punch in" });
    if (state === "NOT_PUNCHED_IN") {
      await punchIn.click();
      const notice = priya.page.getByRole("dialog");
      if (await notice.getByRole("button", { name: /punch in/i }).isVisible().catch(() => false)) {
        await notice.getByRole("button", { name: /punch in/i }).click();
      }
      await toast(priya.page, "Punched in. Have a great day!");
      await shot(priya.page, testInfo, "a1-priya-punched-in");
      await priya.page.waitForTimeout(62_000); // a session lasts at least one minute (attendance_service.MIN_SESSION)
      await priya.page.reload();
    }
    await priya.page.getByRole("button", { name: "Punch out" }).click();
    const confirm = priya.page.getByRole("dialog");
    if (await confirm.getByRole("button", { name: /punch out/i }).isVisible().catch(() => false)) {
      await confirm.getByRole("button", { name: /punch out/i }).click();
    }
    await toast(priya.page, /Punched out/);
    await shot(priya.page, testInfo, "a-priya-punch-in-out");
    await priya.close();
  });

  await test.step("(b) Kavya records Sameer's night 2026-10-26 18:30 -> 03:30 IST; an absence carries no hours", async () => {
    await page.goto("/attendance");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: "Record manually" }).click();
    const dialog = page.getByRole("dialog", { name: "Record attendance" });
    await dialog.getByLabel("Employee").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Sameer");
    await dialog.getByRole("option", { name: /Sameer Khan/ }).click();
    await dialog.getByLabel("Date").fill("2026-10-26");
    await dialog.getByLabel("Check in").fill("18:30");
    await dialog.getByLabel("Check out").fill("03:30");
    await expect(dialog.getByText("Ends the next day (+1 day)")).toBeVisible();
    await expect(dialog.getByTestId("manual-zone-note")).toContainText("work time zone");
    await shot(page, testInfo, "b1-overnight-hint");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);  // closed after the save (a toast from an earlier save may still show)
    await toast(page, "Attendance recorded");
    const rows = await api(page, "GET", `/attendance?start_date=2026-10-26&end_date=2026-10-26&employee_id=${employeeId("alpha", "sameer")}`);
    const night = rows.data.items[0];
    expect(new Date(night.check_in_time).toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(new Date(night.check_out_time).toISOString()).toBe("2026-10-26T22:00:00.000Z");

    await page.getByRole("button", { name: "Record manually" }).click();
    await dialog.getByLabel("Employee").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Pooja");
    await dialog.getByRole("option", { name: /Pooja Kulkarni/ }).click();
    await dialog.getByLabel("Date").fill("2026-10-23");
    await dialog.getByLabel("Status").selectOption("absent");
    await expect(dialog.getByLabel("Check in")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);  // closed after the save (a toast from an earlier save may still show)
    await toast(page, "Attendance recorded");
    const absent = await api(page, "GET", `/attendance?start_date=2026-10-23&end_date=2026-10-23&employee_id=${employeeId("alpha", "pooja")}`);
    expect(absent.data.items[0].status).toBe("absent");
    expect(absent.data.items[0].hours.net_seconds ?? 0).toBe(0);
    await shot(page, testInfo, "b2-absent-no-hours");
  });

  await test.step("(c) the history list pages at 25 / 50 with a total; an inverted range shows INVALID_RANGE", async () => {
    await page.getByLabel("From", { exact: true }).fill("2026-10-01");
    await page.getByLabel("To", { exact: true }).fill("2026-10-31");
    await expect(page.getByTestId("pagination-range")).toHaveText(/^1–25 of \d+$/);
    const total = Number((await page.getByTestId("pagination-range").textContent())?.split(" of ")[1]);
    expect(total).toBeGreaterThan(25); // more than one page at 25
    await page.getByLabel("Rows per page").selectOption("50");
    await expect(page.getByTestId("pagination-range")).toHaveText(`1–${Math.min(50, total)} of ${total}`);
    await shot(page, testInfo, "c1-history-paged");
    await page.getByLabel("From", { exact: true }).fill("2026-10-31");
    await page.getByLabel("To", { exact: true }).fill("2026-10-01");
    await expect(page.getByText("The end date is before the start date.")).toBeVisible();
    await shot(page, testInfo, "c2-invalid-range");
  });

  await test.step("(d) the attendance settings no longer show the dead settings", async () => {
    // Company settings need settings:manage: the company administrator opens them.
    const owner = await openAs(browser, "alpha", "founder");
    await owner.page.goto("/settings");
    await owner.page.getByRole("tab", { name: "Policies" }).click();
    await expect(owner.page.getByText("Late grace period (minutes)")).toBeVisible();
    await expect(owner.page.getByText("Kiosk auto-scan")).toHaveCount(0);
    await shot(owner.page, testInfo, "d-settings-attendance");
    await owner.close();
  });

  await test.step("(e) Emily Clark saves Carlos Diaz's OT 22:00-06:00 New York time without a naive-time error", async () => {
    const emily = await openAs(browser, "gamma", "emily");
    await emily.page.goto("/overtime?modal=overtime-request");
    const form = emily.page.getByRole("dialog", { name: "Request overtime" });
    await form.getByRole("switch", { name: /someone in my team/i }).click();
    await form.getByLabel("Find employee").fill("Carlos");
    const option = form.getByRole("option", { name: /Carlos Diaz/ });
    await expect(option).toHaveCount(1);
    const carlos = (await option.textContent())?.trim() ?? "";
    await form.locator("select", { has: emily.page.locator("option", { hasText: "Carlos Diaz" }) }).selectOption({ label: carlos });
    // A rerun on the same seed finds the earlier entry: take the first October weekday without one.
    const taken = await api(emily.page, "GET",
      `/overtime/entries?employee_id=${employeeId("gamma", "carlos")}&start=2026-10-01&end=2026-10-31&limit=100`);
    const used = new Set(((taken.data.items ?? taken.data) as { date: string }[]).map((e) => e.date));
    const day = ["2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-23", "2026-10-26"].find((d) => !used.has(d))!;
    await form.getByLabel("Date").fill(day);
    await form.getByLabel("Hours").fill("8");
    await form.getByLabel("From (optional)").fill("22:00");
    await form.getByLabel("To (optional)").fill("06:00");
    await form.getByLabel("Reason").fill("Inventory count (G-01 check e)");
    await form.getByRole("button", { name: "Send request" }).click();
    await toast(emily.page, /Overtime (recorded|request sent)/);
    await expect(emily.page.getByText(/TIMEZONE_REQUIRED|timezone offset/i)).toHaveCount(0);
    await shot(emily.page, testInfo, "e-ot-new-york-offsets");
    await emily.close();
  });

  await test.step("(f) the shift form round-trips the unpaid break", async () => {
    // G-01 wrote the break in place; from AS-M1 (G-04) a legacy edit is a version from the owner's local tomorrow
    // (A-24), so the form keeps today's value and the new version carries the edit.
    const owner = await openAs(browser, "alpha", "founder");
    const page2 = owner.page;
    await page2.goto("/settings");
    await page2.getByRole("tab", { name: "Departments & shifts" }).click();
    await page2.getByRole("cell", { name: /^(GEN|General Shift)$/ }).first().click();
    const dialog = page2.getByRole("dialog", { name: "Edit shift" });
    await expect(dialog.getByLabel("Unpaid break (minutes)")).toHaveValue("60");
    await dialog.getByLabel("Unpaid break (minutes)").fill("45");
    await dialog.getByRole("button", { name: "Save" }).click();
    await toast(page2, "Shift saved");
    const shifts = await api(page2, "GET", "/shifts?q=GEN&status=ALL&limit=50");
    const gen = shifts.data.items.find((s: any) => s.code === "GEN");
    const versions = (await api(page2, "GET", `/shifts/${gen.id}/versions`)).data;
    expect(versions[versions.length - 1].unpaid_break_minutes).toBe(45);
    await shot(page2, testInfo, "f-unpaid-break");
    // A rerun posts the same edit again: tomorrow's scheduled version is replaced, not stacked.
    await owner.close();
  });

  expect(account("alpha", "kavya").email).toContain("kavya");
});
