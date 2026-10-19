import { ORBIT, PASSWORD, expect, inDays, openAs, sidebarLinks, step, test, toast } from "./support/fixtures";
import type { Page } from "@playwright/test";

async function addEmployee(
  page: Page,
  e: { first: string; last: string; email: string; code: string; title: string; department?: string; manager?: string },
) {
  await page.goto("/employees");
  await page.getByRole("button", { name: "Add employee" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add employee" });
  await dialog.locator("#emp-first_name").fill(e.first);
  await dialog.locator("#emp-last_name").fill(e.last);
  await dialog.locator("#emp-email").fill(e.email);
  await dialog.locator("#emp-employee_code").fill(e.code);
  await dialog.locator("#emp-position").fill(e.title);
  if (e.department) await dialog.locator("#emp-dept").selectOption({ label: e.department });
  if (e.manager) {
    await dialog.locator("#emp-manager").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill(e.manager);
    await dialog.getByRole("option", { name: new RegExp(e.manager) }).click();
  }
  await dialog.getByRole("button", { name: "Add employee" }).click();
  await toast(page, "Employee added");
}

async function invite(page: Page, employee: string, email: string, role: RegExp): Promise<string> {
  await page.goto("/users");
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite user" });
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Employee record").click();
  await dialog.getByPlaceholder("Type a name, code or email").fill(employee);
  await dialog.getByRole("option", { name: new RegExp(employee) }).click();
  await dialog.getByRole("checkbox", { name: role }).check();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  const ready = page.getByRole("dialog", { name: "Invitation ready" });
  await expect(ready).toBeVisible();
  const link = await ready.getByRole("textbox", { name: "Invitation link" }).inputValue(); // not "Copy invitation link"
  await ready.getByRole("button", { name: "Done" }).click();
  return link;
}

async function acceptInvite(page: Page, link: string, company: string) {
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByText(company)).toBeVisible();
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.getByRole("button", { name: "Activate account" }).click();
  await page.waitForURL(/\/dashboard/);
}

test("Orbit Logistics signs up and onboards its team entirely in the browser", async ({ page, browser }, testInfo) => {
  await step(page, "Orbit Logistics creates its own workspace (no company selector anywhere)", async () => {
    await page.goto("/signup");
    await page.locator("#company").fill(ORBIT.name);
    await page.locator("#name").fill("Daniel D'Souza");
    await page.locator("#email").fill(ORBIT.admin);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill(PASSWORD);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.waitForURL(/\/dashboard\?welcome=1/);
    await expect(page.getByText(`Welcome to ${ORBIT.name}!`)).toBeVisible();
    await expect(page.locator("aside").getByText(ORBIT.name)).toBeVisible(); // the sidebar carries their own name
  });

  await step(page, "The founder is Company Administrator with every menu", async () => {
    expect(await sidebarLinks(page)).toEqual([
      "Dashboard", "Attendance", "Leave", "Holidays", "Payslips", "Assets", "Employees", "Organization",
      "Payroll", "Face kiosk", "Reports", "Users", "Roles & access", "Audit log", "Company settings",
    ]);
  });

  await step(page, "Admin adds an Operations department", async () => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Departments & shifts" }).click();
    await page.getByRole("button", { name: "Add" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New department" });
    await dialog.getByLabel("Name").fill("Operations");
    await dialog.getByRole("button", { name: "Save" }).click();
    await toast(page, "Department saved");
  });

  await step(page, "Admin adds Fatima, then Joseph and Aman reporting to her", async () => {
    await addEmployee(page, { first: "Fatima", last: "Khan", email: ORBIT.ops, code: "ORB-002", title: "Operations Manager", department: "Operations", manager: "Daniel D'Souza" });
    await addEmployee(page, { first: "Joseph", last: "Mathew", email: ORBIT.joseph, code: "ORB-003", title: "Delivery Associate", department: "Operations", manager: "Fatima Khan" });
    await addEmployee(page, { first: "Aman", last: "Verma", email: ORBIT.aman, code: "ORB-004", title: "Delivery Associate", department: "Operations", manager: "Fatima Khan" });
    await page.goto("/employees");
    await expect(page.locator("tbody tr")).toHaveCount(4);
  });

  await step(page, "The org chart shows Fatima's team", async () => {
    await page.goto("/organization");
    await expect(page.getByRole("button", { name: /^Daniel D'Souza.*1 report/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Fatima Khan.*2 reports/ })).toBeVisible();
    await page.getByRole("button", { name: "Expand Fatima Khan's team" }).click();
    await expect(page.getByRole("button", { name: /^Joseph Mathew/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Aman Verma/ })).toBeVisible();
  });

  const fatimaLink = await step(page, "Admin invites Fatima as a Manager", () => invite(page, "Fatima Khan", ORBIT.ops, /^Manager\b/));
  const fatima = await openAs(browser, testInfo, "Fatima (Orbit manager)");
  await step(fatima.page, "Fatima opens her invitation, sets a password and lands in Orbit", async () => {
    await acceptInvite(fatima.page, fatimaLink, ORBIT.name);
    const links = await sidebarLinks(fatima.page);
    expect(links).toContain("Employees");
    expect(links).not.toContain("Payroll");
    expect(links).not.toContain("Users");
    await fatima.page.goto("/employees");
    await expect(fatima.page.locator("tbody tr")).toHaveCount(3); // herself and her two reports
  });

  const josephLink = await step(page, "Admin invites Joseph as an Employee", () => invite(page, "Joseph Mathew", ORBIT.joseph, /^Employee\b/));
  const joseph = await openAs(browser, testInfo, "Joseph (Orbit employee)");
  await step(joseph.page, "Joseph activates his account and sees only self-service", async () => {
    await acceptInvite(joseph.page, josephLink, ORBIT.name);
    expect(await sidebarLinks(joseph.page)).toEqual(["Dashboard", "Attendance", "Leave", "Holidays", "Payslips", "Assets"]);
  });

  await step(joseph.page, "Joseph applies for a day of casual leave", async () => {
    await joseph.page.goto("/leaves");
    await joseph.page.getByRole("button", { name: "Apply for leave" }).click();
    const dialog = joseph.page.getByRole("dialog", { name: "Apply for leave" });
    await dialog.getByLabel("Leave type").selectOption({ label: "Casual Leave" });
    await dialog.getByLabel("From").fill(inDays(3));
    await dialog.getByLabel("To").fill(inDays(3));
    await dialog.getByLabel("Reason").fill("Sister's wedding");
    await dialog.getByRole("button", { name: "Submit request" }).click();
    await toast(joseph.page, "Leave requested");
  });

  await step(fatima.page, "Fatima sees it in her approvals and approves", async () => {
    await fatima.page.goto("/leaves?tab=approvals");
    await expect(fatima.page.getByText("Joseph Mathew").first()).toBeVisible();
    await fatima.page.getByPlaceholder("Remarks (optional)").first().fill("Congratulations!");
    await fatima.page.getByRole("button", { name: "Approve" }).first().click();
    await toast(fatima.page, "Approved");
    await expect(fatima.page.getByText("Nothing waiting for you")).toBeVisible();
  });

  await step(joseph.page, "Joseph is notified and sees the request approved", async () => {
    await joseph.page.goto("/leaves");
    await expect(joseph.page.getByText("Approved").first()).toBeVisible();
    await joseph.page.getByRole("button", { name: /Notifications \(\d+ unread\)/ }).click();
    await expect(joseph.page.getByText("Leave request approved")).toBeVisible();
  });

  await fatima.close();
  await joseph.close();
});
