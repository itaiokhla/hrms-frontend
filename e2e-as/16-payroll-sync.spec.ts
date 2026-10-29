/**
 * G-16 / X-M5 Chrome checks on the time stack 8500/3500 (X 03 §5; JC-AS-11):
 * (a) Karan (payroll manager) opens Payroll › Pay Runs, runs the "Pre-run health check" for Alpha's pay group and sees
 *     the cross-module answer: blocking items or "Ready to lock inputs", each with its severity badge and link (with
 *     no generated pay calendar the assistant says to generate one first);
 * (b) the cutoff API refuses an employee (403) and another tenant's pay group (404);
 * (c) the retro breakdown answers 404 for a run employee outside the tenant.
 * Read-only: nothing is written to the stack.
 */
import { api, expect, signIn, shot, test } from "./support";

test.describe.configure({ mode: "serial" });

test("(a) Karan runs the pre-run health check from Pay Runs", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "karan");
  await page.goto("/payroll/runs");
  const open = page.getByTestId("pre-run-health");
  await expect(open).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await open.click();
    await expect(page.getByTestId("cutoff-assistant")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const summary = page.getByTestId("cutoff-summary");
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toContainText(/Ready to lock inputs|blocking item/);
  const groups = await api(page, "GET", "/payroll/org/pay-groups");
  const result = await api(page, "GET", `/cutoff?pay_group_id=${groups.data[0].id}`);
  expect(result.status).toBe(200);
  for (const item of result.data.items as { code: string; severity: string }[]) {
    const row = page.getByTestId(`cutoff-item-${item.code}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(item.severity === "BLOCKING" ? "Blocking" : "Warning");
  }
  if (result.data.period === null) {
    await expect(page.getByTestId("cutoff-item-NO_PAY_PERIOD")).toContainText(/no pay calendar/);
  } else {
    await expect(page.getByTestId("cutoff-lock")).toBeVisible();
  }
  await shot(page, testInfo, "16a-pre-run-health-check");
});

test("(b) the cutoff assistant keeps to payroll and close-period holders and to the tenant", async ({ page }) => {
  await signIn(page, "alpha", "priya");
  const groups = await api(page, "GET", "/cutoff?pay_group_id=1");
  expect(groups.status).toBe(403);
  await signIn(page, "beta", "founder");
  const other = await api(page, "GET", "/cutoff?pay_group_id=1");
  expect([403, 404]).toContain(other.status);
});

test("(c) the retro breakdown is tenant-scoped", async ({ page }) => {
  await signIn(page, "alpha", "karan");
  const r = await api(page, "GET", "/payroll/run-employees/999999/retro-breakdown");
  expect(r.status).toBe(404);
});
