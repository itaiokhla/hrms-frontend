/**
 * G-01 / LH-M0 baseline on the time stack (LH 13 §4.1 exit 6; LH 14 WI-0.3 DoD): today's apply -> approve -> cancel,
 * the holiday list and the employee menu for Alpha (IN), Beta (AE) and Gamma (US), and a notification whose text
 * names no leave type (LH BUG-30). Kept green unchanged through LH-M9 except deliberate string changes.
 */
import { api, expect, openAs, shot, signIn, test, toast, type CompanyKey } from "../e2e-as/support";

test.describe.configure({ mode: "serial" });

// Employee, manager, a future working day for a one-day casual leave, and a holiday the list must show.
const CASES: Record<CompanyKey, { employee: string; manager: string; day: string; holiday: string }> = {
  alpha: { employee: "rohan", manager: "arjun", day: "2026-12-14", holiday: "Christmas" },
  beta: { employee: "layla", manager: "yusuf", day: "2026-12-14", holiday: "UAE National Day" },
  gamma: { employee: "jordan", manager: "emily", day: "2026-12-14", holiday: "Christmas" },
};

for (const key of Object.keys(CASES) as CompanyKey[]) {
  test(`LH-M0 baseline ${key}: apply -> approve -> cancel, holidays, employee menu`, async ({ page, browser }, testInfo) => {
    const c = CASES[key];
    await signIn(page, key, c.employee);

    await test.step("the employee menu has Leave and Holidays", async () => {
      await page.goto("/dashboard");
      const nav = page.getByRole("navigation").first();
      await expect(nav.getByRole("link", { name: "Leave" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Holidays" })).toBeVisible();
      await shot(page, testInfo, `lh-${key}-1-menu`);
    });

    await test.step("the holiday list shows the company's holidays", async () => {
      await page.goto("/holidays");
      await expect(page.getByText(c.holiday).first()).toBeVisible();
      await shot(page, testInfo, `lh-${key}-2-holidays`);
    });

    let leaveId = 0;
    await test.step("apply for one day of casual leave", async () => {
      // The first free working day from c.day (a rerun on the same seed finds the earlier days booked).
      let r = { status: 0, data: {} as any };
      for (const offset of [0, 1, 2, 3, 4, 7, 8, 9]) {
        const day = new Date(`${c.day}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() + offset);
        const iso = day.toISOString().slice(0, 10);
        r = await api(page, "POST", "/leaves/apply", { leave_type: "casual", start_date: iso, end_date: iso, reason: "G-01 baseline" });
        if (r.status !== 409) break;
      }
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      leaveId = r.data.id;
      await page.goto("/leaves");
      await expect(page.getByText(/Casual/).first()).toBeVisible();
    });

    await test.step("the manager approves; the notification names no leave type (BUG-30)", async () => {
      const manager = await openAs(browser, key, c.manager);
      await manager.page.goto("/leaves?tab=approvals");
      const card = manager.page.getByRole("article").filter({ hasText: "G-01 baseline" }).first();
      await card.getByRole("button", { name: "Approve" }).click();
      await toast(manager.page, "Approved");
      await manager.close();
      const notes = await api(page, "GET", "/notifications");
      const items = (notes.data.notifications ?? []) as { title: string; message: string }[]; // GET /notifications shape
      const approved = items.find((n) => n.title === "Leave request approved");
      expect(approved, "the approval notification").toBeTruthy();
      expect(`${approved!.title} ${approved!.message}`.toLowerCase()).not.toContain("casual");
      await page.goto("/dashboard");
      await shot(page, testInfo, `lh-${key}-3-notification`);
    });

    await test.step("the employee cancels the approved leave (a cancellation request)", async () => {
      const r = await api(page, "POST", `/leaves/${leaveId}/cancel`, { reason: "G-01 baseline cancel" });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      expect(r.data.cancellation_status ?? r.data.status).toMatch(/pending|cancelled/);
      await page.goto("/leaves");
      await shot(page, testInfo, `lh-${key}-4-cancel`);
    });
  });
}
