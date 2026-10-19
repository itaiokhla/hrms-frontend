import { NIMBUS, SAFFRON, api, expect, inDays, login, openAs, step, test } from "./support/fixtures";

test("Dashboards adapt to each person's scope", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.admin);
  await step(page, "Ananya's dashboard covers the whole company, including payroll", async () => {
    await expect(page.getByText(`Here's what's happening across ${NIMBUS.name} today.`)).toBeVisible();
    await expect(page.getByText("Active employees")).toBeVisible();
    await expect(page.getByText(/^Payroll ·/)).toBeVisible();
  });

  const sneha = await openAs(browser, testInfo, "Sneha (manager)", NIMBUS.manager);
  await step(sneha.page, "Sneha's dashboard covers only her team, without payroll", async () => {
    await expect(sneha.page.getByText("Here's what's happening with your team today.")).toBeVisible();
    await expect(sneha.page.getByText("People in your team")).toBeVisible();
    await expect(sneha.page.getByText(/^Payroll ·/)).toHaveCount(0);
  });
  await sneha.close();

  const divya = await openAs(browser, testInfo, "Divya (employee)", NIMBUS.divya);
  await step(divya.page, "Divya's dashboard is about her own day", async () => {
    await expect(divya.page.getByText("Here's your day at a glance.")).toBeVisible();
    await expect(divya.page.getByText("My day")).toBeVisible();
  });
  await divya.close();
});

test("Reports and exports only aggregate what the viewer may see", async ({ page }) => {
  await login(page, NIMBUS.manager);
  await step(page, "Sneha's attendance report contains only her reporting tree", async () => {
    await page.goto("/reports");
    await page.getByLabel("From").fill(inDays(-14)); // the seeded attendance window, whatever the day of the month
    await expect(page.getByText(/^[1-9]\d* records$/)).toBeVisible(); // loaded (it reads "0 records" while loading)
    const names = new Set((await page.locator("tbody tr td:first-child").allInnerTexts()).map((t) => t.trim()));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(["Sneha Iyer", "Arjun Das", "Divya Menon", "Farhan Ali", "Meera Pillai", "Sameer Khan"]).toContain(name);
    }
    await expect(page.getByRole("button", { name: "Excel" })).toHaveCount(0); // managers can read, not export
    await expect(page.getByRole("tab", { name: "Payroll" })).toHaveCount(0);
  });

  await page.context().clearCookies();
  await login(page, NIMBUS.admin);
  await step(page, "Ananya sees the whole company and can export to Excel", async () => {
    await page.goto("/reports");
    await page.getByLabel("From").fill(inDays(-14));
    await expect(page.getByText(/^[1-9]\d* records$/)).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Tara Kapoor"); // outside Sneha's tree, inside Ananya's
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Excel" }).click();
    expect((await download).suggestedFilename()).toMatch(/^attendance_.*\.xlsx$/);
  });

  await step(page, "The payroll report is available to those with company payroll access", async () => {
    await page.getByRole("tab", { name: "Payroll" }).click();
    await expect(page.getByText("Net").first()).toBeVisible();
  });
});

test("The audit trail records sensitive actions per company", async ({ page }) => {
  await login(page, NIMBUS.auditor);
  await step(page, "Neha (auditor) reviews payroll and leave events", async () => {
    await page.goto("/audit-logs");
    await page.getByLabel("Module").selectOption("Payroll");
    await expect(page.getByRole("row", { name: /Approved payroll/ }).first()).toBeVisible();
    await page.getByLabel("Module").selectOption("Leave");
    await expect(page.getByRole("row", { name: /Approved step/ }).first()).toBeVisible();
  });
  await step(page, "Audit entries are read-only: there is no way to edit or delete them", async () => {
    expect((await api(page, "DELETE", "/audit-logs")).status).toBe(405);
    await expect(page.getByRole("button", { name: /Delete|Edit/ })).toHaveCount(0);
  });

  await page.context().clearCookies();
  await login(page, SAFFRON.admin);
  await step(page, "Saffron's audit log contains none of Nimbus's events", async () => {
    await page.goto("/audit-logs");
    const logs = await api<{ logs: { actor_email: string | null; description: string }[] }>(page, "GET", "/audit-logs?limit=200");
    expect(logs.data.logs.length).toBeGreaterThan(0);
    for (const log of logs.data.logs) {
      expect(log.actor_email ?? "").not.toContain("nimbustech.io");
      expect(log.description).not.toContain("Nimbus");
    }
  });
});
