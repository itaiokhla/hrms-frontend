import { NIMBUS, SAFFRON, api, expect, login, openAs, step, test, toast } from "./support/fixtures";

const now = new Date();
const MONTH = now.toLocaleString("en", { month: "long" });
const YEAR = now.getFullYear();

interface Row {
  id: number;
  employee_name: string;
  status: string;
}

test("Managers never see payroll, whatever their seniority", async ({ page }) => {
  await login(page, NIMBUS.vp);
  await step(page, "Rohan (VP, 7 people below him) opens Payroll: access denied", async () => {
    await page.goto("/payroll");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    expect((await api(page, "GET", "/payroll")).status).toBe(403);
    expect((await api(page, "GET", "/reports/payroll?year=2026")).status).toBe(403);
  });
});

test("Prepare → approve → pay with separation of duties, then the payslip", async ({ page, browser }, testInfo) => {
  const karan = await openAs(browser, testInfo, "Karan (payroll analyst)", NIMBUS.payroll);
  await step(karan.page, `Karan prepares payroll for ${MONTH} ${YEAR}`, async () => {
    await karan.page.goto("/payroll");
    await karan.page.getByLabel("Month").selectOption({ label: MONTH });
    await karan.page.getByLabel("Year").fill(String(YEAR));
    await karan.page.getByRole("button", { name: "Generate month" }).click();
    await karan.page.getByRole("dialog", { name: new RegExp(`Generate payroll for ${MONTH}`) }).getByRole("button", { name: "Generate" }).click();
    await toast(karan.page, /\d+ generated/);
    await expect(karan.page.getByRole("row", { name: /Divya Menon/ })).toContainText("Draft");
  });

  await step(karan.page, "Karan cannot approve what he prepared: the button is locked and the API agrees", async () => {
    const row = karan.page.getByRole("row", { name: /Divya Menon/ });
    await expect(row.getByRole("button", { name: "Approve" })).toBeDisabled();
    const list = await api<{ items: Row[] }>(karan.page, "GET", `/payroll?year=${YEAR}&month=${now.getMonth() + 1}&limit=200`);
    const divya = list.data.items.find((r) => r.employee_name === "Divya Menon")!;
    const result = await api<{ detail: string }>(karan.page, "POST", `/payroll/${divya.id}/approve`);
    expect(result.status).toBe(403);
    expect(result.data.detail).toContain("Separation of duties");
  });

  const priya = await openAs(browser, testInfo, "Priya (finance controller)", NIMBUS.finance);
  await step(priya.page, "Priya approves Divya's pay", async () => {
    await priya.page.goto("/payroll");
    await priya.page.getByRole("row", { name: /Divya Menon/ }).getByRole("button", { name: "Approve" }).click();
    await toast(priya.page, "Payroll approved");
    await expect(priya.page.getByRole("row", { name: /Divya Menon/ })).toContainText("Approved");
  });
  await step(priya.page, "Priya tries to approve her own pay: refused", async () => {
    await priya.page.getByRole("row", { name: /Priya Nair/ }).getByRole("button", { name: "Approve" }).click();
    await toast(priya.page, "You cannot approve your own pay.");
  });
  await priya.close();

  await step(karan.page, "Karan pays the approved salary", async () => {
    await karan.page.reload();
    await karan.page.getByRole("row", { name: /Divya Menon/ }).getByRole("button", { name: "Pay" }).click();
    await toast(karan.page, "Marked as paid");
    await expect(karan.page.getByRole("row", { name: /Divya Menon/ })).toContainText("Processed");
  });
  const farhanPayroll = (await api<{ items: Row[] }>(karan.page, "GET", `/payroll?year=${YEAR}&month=${now.getMonth() + 1}&limit=200`))
    .data.items.find((r) => r.employee_name === "Farhan Ali")!;
  await karan.close();

  await step(page, "Divya opens her payslips, views this month's and downloads the PDF", async () => {
    await login(page, NIMBUS.divya);
    await page.goto("/payslips");
    await page.getByRole("button", { name: new RegExp(`${MONTH} ${YEAR}`) }).click();
    const slip = page.getByRole("dialog", { name: "Payslip" });
    await expect(slip).toContainText("Divya Menon");
    await expect(slip).toContainText("Net pay");
    const download = page.waitForEvent("download");
    await slip.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(/^payslip-.*\.pdf$/);
  });

  await step(page, "Divya cannot open Farhan's draft payslip by changing the id", async () => {
    expect((await api(page, "GET", `/payroll/${farhanPayroll.id}/slip`)).status).toBe(404);
    expect((await api(page, "GET", `/payroll/${farhanPayroll.id}/slip.pdf`)).status).toBe(404);
  });
});

test("Salary revisions keep history; another company's payroll is invisible", async ({ page }) => {
  await login(page, NIMBUS.finance);
  await step(page, "Priya records a salary revision for Divya from next month", async () => {
    await page.goto("/payroll?tab=structures");
    await page.getByRole("button", { name: "New revision" }).click();
    const dialog = page.getByRole("dialog", { name: "New salary revision" });
    await dialog.getByLabel("Employee").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Divya");
    await dialog.getByRole("option", { name: /Divya Menon/ }).click();
    await dialog.getByLabel("Basic salary").fill("47500");
    await dialog.getByLabel("House rent allowance").fill("19000");
    const next = new Date(YEAR, now.getMonth() + 1, 1);
    await dialog.getByLabel("Effective from").fill(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`);
    await dialog.getByRole("button", { name: "Save revision" }).click();
    await toast(page, "Salary structure saved");
    const rows = page.getByRole("row", { name: /Divya Menon/ });
    await expect(rows).toHaveCount(2); // the old structure is closed, not overwritten
  });
  await step(page, "Until next month her current pay is unchanged", async () => {
    const found = await api<{ items: { id: number }[] }>(page, "GET", "/employees?q=Divya%20Menon");
    const divya = await api<{ base_salary: number }>(page, "GET", `/employees/${found.data.items[0].id}`);
    expect(divya.data.base_salary).toBe(42500); // the ₹47,500 revision starts on the 1st
  });

  await page.context().clearCookies();
  await login(page, SAFFRON.accounts);
  await step(page, "Saffron's accounts manager sees none of Nimbus's payroll", async () => {
    await page.goto("/payroll");
    await expect(page.getByText("No payroll for this month")).toBeVisible();
    const sept = await api<{ total: number }>(page, "GET", "/payroll?year=2026&month=9");
    expect(sept.data.total).toBe(0);
  });
});
