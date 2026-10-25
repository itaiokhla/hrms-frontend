import type { Page } from "@playwright/test";

import { NIMBUS, SAFFRON, api, expect, inDays, login, openAs, step, test, toast } from "./support/fixtures";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Same format as the app (date-fns "d MMM yyyy"). */
function fmt(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

async function apply(page: Page, type: string, from: string, to: string, reason: string) {
  await page.goto("/leaves");
  await page.getByRole("button", { name: "Apply for leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply for leave" });
  await dialog.getByLabel("Leave type").selectOption({ label: type });
  await dialog.getByLabel("From").fill(from);
  await dialog.getByLabel("To").fill(to);
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Submit request" }).click();
}

/** An approval card, found by who asked and why (independent of the seed date). */
function request(page: Page, employee: string, reason: string) {
  return page.getByRole("article", { name: new RegExp(`^Leave request from ${employee}`) }).filter({ hasText: reason });
}

async function myLeaveDate(page: Page, reason: string): Promise<string> {
  const mine = await api<{ start_date: string; reason: string | null }[]>(page, "GET", "/leaves/my");
  const match = mine.data.find((l) => l.reason === reason);
  if (!match) throw new Error(`No leave with reason ${reason}`);
  return match.start_date;
}

test("Employee → manager approval, with notification", async ({ page, browser }, testInfo) => {
  const arjun = await openAs(browser, testInfo, "Arjun (team lead)", NIMBUS.lead);
  await step(arjun.page, "Arjun opens his approvals and approves Divya's family-function leave", async () => {
    await arjun.page.goto("/leaves?tab=approvals");
    const card = request(arjun.page, "Divya Menon", "Family function");
    await expect(card).toBeVisible();
    await card.getByPlaceholder("Remarks (optional)").fill("Have a great time");
    await card.getByRole("button", { name: "Approve" }).click();
    await toast(arjun.page, "Approved");
  });
  await arjun.close();

  await step(page, "Divya sees it approved, with Arjun named on the approval step", async () => {
    await login(page, NIMBUS.divya);
    await page.goto("/leaves");
    const start = await myLeaveDate(page, "Family function");
    await page.getByRole("button", { name: new RegExp(`Casual · 1 day.*${fmt(start)}`) }).click();
    await expect(page.getByText(/Approved by Arjun Das/)).toBeVisible();
    await expect(page.getByText("“Have a great time”")).toBeVisible();
    await page.getByRole("button", { name: /Notifications \(\d+ unread\)/ }).click();
    await expect(page.getByText("Leave request approved").first()).toBeVisible();
  });
});

test("Self-approval, rejection with a reason, cancellation and guardrails", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.divya);
  await step(page, "Divya requests another day off", async () => {
    await apply(page, "Casual Leave", inDays(30), inDays(30), "Long weekend");
    await toast(page, "Leave requested");
  });

  await step(page, "Divya cannot approve her own request — nothing is offered and the API refuses", async () => {
    await page.goto("/leaves?tab=approvals");
    await expect(page.getByText("Nothing waiting for you")).toBeVisible();
    const mine = await api<{ id: number; start_date: string }[]>(page, "GET", "/leaves/my");
    const pending = mine.data.find((l) => l.start_date === inDays(30))!;
    const result = await api<{ detail: string }>(page, "POST", `/leaves/${pending.id}/approve`, {});
    expect(result.status).toBe(403);
    expect(result.data.detail).toBe("You cannot approve your own leave.");
  });

  const arjun = await openAs(browser, testInfo, "Arjun (team lead)", NIMBUS.lead);
  await step(arjun.page, "Arjun rejects it with a reason", async () => {
    await arjun.page.goto("/leaves?tab=approvals");
    const card = request(arjun.page, "Divya Menon", "Long weekend");
    await card.getByPlaceholder("Remarks (optional)").fill("Release week. Could you pick the week after?");
    await card.getByRole("button", { name: "Reject" }).click();
    await toast(arjun.page, "Rejected");
  });
  await arjun.close();

  await step(page, "Divya sees the rejection and the reason", async () => {
    await page.goto("/leaves");
    await page.getByRole("button", { name: new RegExp(`Casual · 1 day.*${fmt(inDays(30))}`) }).click();
    await expect(page.getByText("Release week. Could you pick the week after?")).toBeVisible();
  });

  await step(page, "Divya books a day and then cancels it herself", async () => {
    await apply(page, "Casual Leave", inDays(31), inDays(31), "Errands");
    await toast(page, "Leave requested");
    await page.getByRole("button", { name: new RegExp(`Casual · 1 day.*${fmt(inDays(31))}`) }).click();
    await page.getByRole("button", { name: "Cancel request" }).click();
    await page.getByRole("dialog", { name: "Cancel this request?" }).getByRole("button", { name: "Cancel request" }).click();
    await toast(page, "Request cancelled");
  });

  await step(page, "Asking for more days than her balance allows is refused", async () => {
    // Payroll v2 counts leave in working days (3.4 §7.1, EC-LV-10), not calendar days: 21 calendar days always
    // hold 15 weekdays, more than the 9 Casual days left whatever weekday the suite runs on.
    await apply(page, "Casual Leave", inDays(40), inDays(60), "Trip");
    await toast(page, /Insufficient Casual Leave balance/);
    await page.keyboard.press("Escape");
  });

  await step(page, "Overlapping an existing booking is refused", async () => {
    const booked = await myLeaveDate(page, "Family function");
    await apply(page, "Sick Leave", booked, booked, "Overlap test");
    await toast(page, "You already have leave booked on some of these dates.");
    await page.keyboard.press("Escape");
  });
});

test("Multi-step approval: HR gives the final approval for long leave", async ({ page }) => {
  await login(page, NIMBUS.hr);
  await step(page, "Vikram (HR) sees Meera's 4-day request, already approved by her manager", async () => {
    await page.goto("/leaves?tab=approvals");
    const card = request(page, "Meera Pillai", "Vacation in Kerala");
    await expect(card).toContainText("Approved by Sneha Iyer");
    await card.getByRole("button", { name: "Approve" }).click();
    await toast(page, "Approved");
  });
  await step(page, "The request is now fully approved in the company-wide list", async () => {
    await page.getByRole("tab", { name: "Requests" }).click();
    await expect(page.getByRole("row", { name: /Meera Pillai/ }).filter({ hasText: "Earned" })).toContainText("Approved");
  });
});

test("People outside the approval path cannot act; the right manager can", async ({ page, browser }, testInfo) => {
  const rohan = await openAs(browser, testInfo, "Rohan (VP)", NIMBUS.vp);
  const pending = await api<{ items: { id: number; employee_name: string }[] }>(rohan.page, "GET", "/leaves?status=pending");
  const nikhil = pending.data.items.find((l) => l.employee_name === "Nikhil Jain")!;

  await step(page, "Tara (Sales) tries to approve Nikhil's leave through the API: not found", async () => {
    await login(page, NIMBUS.sales);
    expect((await api(page, "POST", `/leaves/${nikhil.id}/approve`, {})).status).toBe(404);
  });
  await step(rohan.page, "Rohan, Nikhil's manager, approves it", async () => {
    await rohan.page.goto("/leaves?tab=approvals");
    await request(rohan.page, "Nikhil Jain", "Dental procedure").getByRole("button", { name: "Approve" }).click();
    await toast(rohan.page, "Approved");
  });
  await rohan.close();
});

test("Saffron's three-step chain: supervisor → department head (→ HR for 5+ days)", async ({ page, browser }, testInfo) => {
  await step(page, "Kavita (HR) reviews the approval chain configured for Saffron", async () => {
    await login(page, SAFFRON.hr);
    await page.goto("/leaves?tab=policy");
    const chain = page.locator("div.rounded-2xl").filter({ has: page.getByRole("heading", { name: "Approval chain" }) });
    await expect(chain.locator("select").first()).toBeVisible();
    const types = await chain.locator("select").evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
    expect(types.slice(0, 3)).toEqual(["primary_manager", "department_head", "role"]);
    const minDays = await chain.locator('input[type="number"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(minDays).toEqual(["", "2", "5"]);
  });

  const lakshmi = await openAs(browser, testInfo, "Lakshmi (shift supervisor)", SAFFRON.supervisor);
  await step(lakshmi.page, "Lakshmi approves Ramesh's 3-day festival leave (step 1)", async () => {
    await lakshmi.page.goto("/leaves?tab=approvals");
    await request(lakshmi.page, "Ramesh Babu", "Village temple festival").getByRole("button", { name: "Approve" }).click();
    await toast(lakshmi.page, "Approved");
  });
  await lakshmi.close();

  const suresh = await openAs(browser, testInfo, "Suresh (plant head)", SAFFRON.plant);
  await step(suresh.page, "Because it is 2+ days, the Production department head approves next (step 2)", async () => {
    await suresh.page.goto("/leaves?tab=approvals");
    const card = request(suresh.page, "Ramesh Babu", "Village temple festival");
    await expect(card).toContainText("Department head");
    await card.getByRole("button", { name: "Approve" }).click();
    await toast(suresh.page, "Approved");
  });
  await suresh.close();

  await step(page, "Ramesh's request is fully approved", async () => {
    await page.context().clearCookies();
    await login(page, SAFFRON.ramesh);
    await page.goto("/leaves");
    await expect(page.getByRole("button", { name: /Casual · 3 days/ })).toContainText("Approved");
  });
});
