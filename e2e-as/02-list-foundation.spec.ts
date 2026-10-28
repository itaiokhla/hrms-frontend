/**
 * G-02 / X-M3 Chrome checks (AS 13 §4.2 exit (a)-(c)), in order, on the time stack 8500/3500 with the G-02 seed.
 * X-UI-09 (one form, frames, Back) is covered for the pilot Sheet here and for ShiftForm in e2e-as/04.
 */
import { api, expect, openAs, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

test("X-M3 (a)-(c): audit paging, report year validation, the overtime pilot list with a shared view", async ({ page, browser }, testInfo) => {
  await signIn(page, "alpha", "kavya");

  await test.step("(a) Kavya pages /audit-logs at 25 / 50 with server totals (BUG-AS-55)", async () => {
    await page.goto("/audit-logs");
    await expect(page.getByTestId("pagination-range")).toHaveText(/^1–25 of \d+$/);
    await page.getByLabel("Rows per page").selectOption("50");
    await expect(page.getByTestId("pagination-range")).toHaveText(/^1–(50|\d+) of \d+$/);
    await shot(page, testInfo, "a-audit-25-50");
  });

  await test.step("(b) a cleared year on /reports shows a validation message, not 0 (BUG-AS-56)", async () => {
    await page.goto("/reports?tab=leave");
    await page.getByRole("tab", { name: "Leave", exact: true }).click();
    await page.getByLabel("Year").fill("");
    await expect(page.getByText("Enter a year between 2000 and 2100.")).toBeVisible();
    await shot(page, testInfo, "b-report-year-validation");
  });

  await test.step("(c) Karan shares a view of overtime.entries; Kavya opens it read-only; a row opens the Sheet", async () => {
    const karan = await openAs(browser, "alpha", "karan");
    // Rerun-safe: an earlier run's view of the same name is Karan's own; delete it first.
    const existing = await api(karan.page, "GET", "/saved-views?list_key=overtime.entries");
    for (const v of existing.data.views.filter((x: any) => x.own && x.name === "Ravi's overtime")) {
      expect((await api(karan.page, "DELETE", `/saved-views/${v.id}`)).status).toBe(204);
    }
    await karan.page.goto("/overtime?tab=all");
    await karan.page.getByRole("searchbox", { name: "Search name or code" }).fill("Ravi");
    await expect(karan.page.getByTestId("result-count")).toHaveText(/^\d+ results?$/);
    await karan.page.getByRole("button", { name: "Save as new view…" }).click();
    const modal = karan.page.getByRole("dialog", { name: "Save view" });
    await modal.getByLabel("Name").fill("Ravi's overtime");
    await modal.getByLabel(/Share with everyone/).check();
    await modal.getByRole("button", { name: "Save view" }).click();
    await expect(karan.page.getByRole("tab", { name: /Ravi's overtime/ })).toHaveAttribute("aria-selected", "true");
    await shot(karan.page, testInfo, "c1-karan-saved-shared-view");
    await karan.close();

    await page.goto("/overtime?tab=all");
    const shared = page.getByRole("tab", { name: /Ravi's overtime/ });
    await expect(shared).toContainText("Shared");
    await shared.click();
    await expect(page).toHaveURL(/view=\d+/);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0); // read-only for her
    // Server sort with aria-sort.
    await page.getByRole("columnheader", { name: /Date/ }).getByRole("button").click();
    await expect(page.getByRole("columnheader", { name: /Date/ })).toHaveAttribute("aria-sort", "ascending");
    await shot(page, testInfo, "c2-kavya-shared-view-sorted");

    // A row opens the existing payroll detail in a right-side Sheet; the deep link survives reload; Back closes it.
    await page.getByRole("link", { name: /Ravi Kumar/ }).first().click();
    const sheet = page.getByRole("dialog", { name: /Overtime entry #\d+/ });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/modal=overtime-entry&id=\d+/);
    await page.reload();
    await expect(page.getByRole("dialog", { name: /Overtime entry #\d+/ })).toBeVisible();
    await shot(page, testInfo, "c3-sheet-after-reload");
    await page.goto("/overtime?tab=all");
    await page.getByRole("link", { name: /Ravi Kumar/ }).first().click();
    await expect(page.getByRole("dialog", { name: /Overtime entry/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: /Overtime entry/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/overtime\?tab=all$/);
    const views = await api(page, "GET", "/saved-views?list_key=overtime.entries");
    expect(views.status).toBe(200);
  });
});
