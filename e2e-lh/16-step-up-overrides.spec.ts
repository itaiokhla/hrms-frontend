/**
 * LH-SEC-02 (07 §5.2: override, activate plan version, publish holiday year) on the time stack 8500/3500 in Chrome,
 * for Alpha with the tenant switches `leave.override.requires_step_up` and `leave.plan_activation.requires_step_up`
 * turned on (both default off; restored at the end):
 *   1. Rohan applies for a day of casual leave (it waits for his manager Arjun).
 *   2. Kavya (HR admin, company-wide approver) approves it from her inbox: the card says "Company-wide override",
 *      Approve opens "Confirm it's you"; with the e-mailed code the override is recorded.
 *   3. The founder activates a new Leave pay version in Settings › Payroll › Leave pay: Activate opens
 *      "Confirm it's you" first; after the code the version is active.
 * Holiday-year publish (the third catalogue row) is covered by specs 12/13 (completeStepUpIfAsked).
 * Evidence: test-evidence/<date>-g05/ (E2E_TIME_GOAL=g05).
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, test, toast } from "../e2e-as/support";
import { completeStepUpIfAsked } from "./step-up";

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const SWITCHES = ["leave.override.requires_step_up", "leave.plan_activation.requires_step_up"];

async function setSwitches(page: Page, value: boolean) {
  const current = await api(page, "GET", "/payroll/settings/values");
  expect(current.status, JSON.stringify(current.data)).toBe(200);
  const items = current.data.items as { key: string; row_version?: number }[];
  const changes = SWITCHES.map((key) => ({
    key,
    value,
    row_version: items.find((i) => i.key === key)?.row_version ?? 0, // 0 = never set at this scope
    reason: `LH-SEC-02 e2e ${RUN}`,
  }));
  const r = await api(page, "PUT", "/payroll/settings/values", { changes });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
}

test("LH-SEC-02: leave override and leave-plan activation ask 'Confirm it's you' when the tenant requires it", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await signIn(page, "alpha", "founder");
  await setSwitches(page, true);
  try {
    let leaveId = 0;
    await test.step("Rohan applies for a day of casual leave (waits for his manager)", async () => {
      const rohan = await openAs(browser, "alpha", "rohan");
      let r = { status: 0, data: {} as any };
      for (let offset = 0; offset < 40; offset++) {
        const day = new Date("2027-02-01T00:00:00Z");
        day.setUTCDate(day.getUTCDate() + offset);
        if ([0, 6].includes(day.getUTCDay())) continue;
        const iso = day.toISOString().slice(0, 10);
        r = await api(rohan.page, "POST", "/leaves/apply", { leave_type: "casual", start_date: iso, end_date: iso, reason: `Override check ${RUN}` });
        if (r.status === 200) break;
      }
      await rohan.close();
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      leaveId = r.data.id;
    });

    await test.step("Kavya overrides from her inbox: 'Confirm it's you' first, then the approval is recorded", async () => {
      const kavya = await openAs(browser, "alpha", "kavya");
      await kavya.page.goto("/leaves?tab=approvals");
      const card = kavya.page.getByRole("article").filter({ hasText: `Override check ${RUN}` }).first();
      await expect(card).toContainText("Company-wide override");
      await shot(kavya.page, testInfo, "g05-sec02-1-override-card");
      await card.getByRole("button", { name: "Approve" }).click();
      const dialog = kavya.page.getByRole("dialog", { name: /confirm it's you/i });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await shot(kavya.page, testInfo, "g05-sec02-2-override-step-up");
      expect(await completeStepUpIfAsked(kavya.page, "alpha", "kavya")).toBe(true);
      await toast(kavya.page, "Approved");
      const after = await api(kavya.page, "GET", `/leaves?status=approved&employee_id=${employeeId("alpha", "rohan")}&limit=200`);
      expect(after.status, JSON.stringify(after.data)).toBe(200);
      expect((after.data.items as { id: number }[]).some((l) => l.id === leaveId), "the override is recorded as approved").toBe(true);
      await shot(kavya.page, testInfo, "g05-sec02-3-override-approved");
      await kavya.close();
    });

    await test.step("the founder activates a Leave pay version: 'Confirm it's you' first, then it is active", async () => {
      const policies = await api(page, "GET", "/payroll/policies?type=LEAVE_PAY_POLICY");
      expect(policies.status, JSON.stringify(policies.data)).toBe(200);
      const policy = (policies.data as { id: number; draft_versions: number[] }[])[0];
      let version = [...policy.draft_versions].sort((a, b) => b - a)[0];
      if (!version) {
        const created = await api(page, "POST", `/payroll/policies/${policy.id}/versions`);
        expect(created.status, JSON.stringify(created.data)).toBe(201);
        version = created.data.version;
      }
      await page.goto("/settings/payroll/leave");
      const row = page.locator(`[data-policy="${policy.id}"]`);
      await row.scrollIntoViewIfNeeded();
      await row.getByRole("button", { name: "Policy actions" }).click();
      // The sticky "Save" bar of the settings page can sit over the menu: choose the item with the keyboard.
      const item = page.getByRole("menuitem", { name: `Activate v${version}…` });
      await item.focus();
      await page.keyboard.press("Enter");
      const modal = page.getByRole("dialog", { name: new RegExp(`Activate version ${version}`) });
      await expect(modal).toBeVisible();
      await modal.getByRole("button", { name: "Activate" }).click();
      const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await shot(page, testInfo, "g05-sec02-4-activation-step-up");
      expect(await completeStepUpIfAsked(page, "alpha", "founder")).toBe(true);
      await toast(page, `Version ${version} activated`);
      const detail = await api(page, "GET", `/payroll/policies/${policy.id}`);
      const activated = (detail.data.versions as { version: number; status: string }[]).find((v) => v.version === version);
      expect(activated?.status).toBe("ACTIVE");
      await shot(page, testInfo, "g05-sec02-5-activation-done");
    });
  } finally {
    await setSwitches(page, false);
  }
});
