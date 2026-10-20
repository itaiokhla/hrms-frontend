import type { Page } from "@playwright/test";

import { NIMBUS, api, expect, formAlert, login, openAs, sidebarLinks, step, test, toast } from "./support/fixtures";

async function openUser(page: Page, name: string) {
  await page.goto("/users");
  await page.getByPlaceholder("Search name or email").fill(name);
  await page.getByRole("row", { name: new RegExp(name) }).first().click();
  return page.getByRole("dialog", { name });
}

test("Building a custom role in the permission matrix", async ({ page }) => {
  await login(page, NIMBUS.admin);
  await step(page, "Ananya creates a 'Shift Coordinator' role", async () => {
    await page.goto("/roles");
    await page.getByRole("button", { name: "New role" }).click();
    const dialog = page.getByRole("dialog", { name: "New role" });
    await dialog.getByLabel("Name").fill("Shift Coordinator");
    await dialog.getByLabel("Description").fill("Keeps the team's attendance accurate");
    await dialog.getByRole("button", { name: "Create role" }).click();
    await toast(page, "Role created");
  });
  await step(page, "She grants attendance permissions for direct reports only", async () => {
    await page.getByRole("button", { name: "View attendance: Direct reports" }).click();
    await page.getByRole("button", { name: "Correct attendance: Direct reports" }).click();
    await expect(page.getByRole("button", { name: "View attendance: Direct reports" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Save changes" }).click();
    await toast(page, "Role saved");
  });
  await step(page, "Scopes a permission doesn't support are simply not offered", async () => {
    // "Create employees" exists only at company scope, so there is no "Direct reports" cell for it.
    await expect(page.getByRole("button", { name: "Create employees: Direct reports" })).toHaveCount(0);
  });
});

test("Roles change access live; HR can't grant power it doesn't hold", async ({ page, browser }, testInfo) => {
  const rahul = await openAs(browser, testInfo, "Rahul (account executive)", NIMBUS.rahul);
  await step(rahul.page, "Rahul starts with self-service only", async () => {
    expect(await sidebarLinks(rahul.page)).not.toContain("Employees");
  });

  await login(page, NIMBUS.hr);
  const drawer = await step(page, "Vikram (HR) opens Rahul's account", () => openUser(page, "Rahul Verma"));

  await step(page, "Administrator and Payroll roles are locked for Vikram; Manager is allowed", async () => {
    await expect(drawer.getByRole("checkbox", { name: /^Company Administrator/ })).toBeDisabled();
    await expect(drawer.getByRole("checkbox", { name: /^Payroll Manager/ })).toBeDisabled();
    await drawer.getByRole("checkbox", { name: /^Manager\b/ }).check();
    await drawer.getByRole("button", { name: "Save roles" }).click();
    await expect(drawer.getByRole("button", { name: "Save roles" })).toBeHidden(); // saved
    await toast(page, "Roles updated");
  });

  await step(rahul.page, "Rahul's next page load already reflects the new role", async () => {
    await rahul.page.reload();
    expect(await sidebarLinks(rahul.page)).toContain("Employees");
  });

  await step(page, "Vikram removes the role again", async () => {
    await drawer.getByRole("checkbox", { name: /^Manager\b/ }).uncheck();
    await drawer.getByRole("button", { name: "Save roles" }).click();
    await expect(drawer.getByRole("button", { name: "Save roles" })).toBeHidden(); // saved
    await toast(page, "Roles updated");
  });

  await step(rahul.page, "Rahul's stale screen can't use the revoked access", async () => {
    await rahul.page.reload();
    expect(await sidebarLinks(rahul.page)).not.toContain("Employees");
    await rahul.page.goto("/employees");
    await expect(rahul.page.getByText("You don't have access to this page")).toBeVisible();
  });
  await rahul.close();

  await step(page, "Vikram cannot change his own roles or an administrator's account", async () => {
    await page.keyboard.press("Escape");
    const self = await openUser(page, "Vikram Shah");
    await expect(self.getByText("You can't change your own roles.")).toBeVisible();
    const users = await api<{ items: { id: number; email: string }[] }>(page, "GET", "/users?limit=200");
    const ananya = users.data.items.find((u) => u.email === NIMBUS.admin)!;
    const result = await api<{ detail: string }>(page, "PUT", `/users/${ananya.id}/status`, { status: "suspended" });
    expect(result.status).toBe(403);
  });
});

test("Suspending an account ends its sessions immediately", async ({ page, browser }, testInfo) => {
  const isha = await openAs(browser, testInfo, "Isha (will be suspended)", NIMBUS.isha);
  await login(page, NIMBUS.hr);
  const drawer = await openUser(page, "Isha Bose");
  await step(page, "Vikram suspends Isha", async () => {
    await drawer.getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("dialog", { name: "Suspend account?" }).getByRole("button", { name: "Suspend" }).click();
    await toast(page, "Account updated");
    await expect(drawer.getByText("Suspended").first()).toBeVisible();
  });
  await step(isha.page, "Isha's open session is thrown out on her very next click", async () => {
    await isha.page.getByRole("link", { name: "Leave" }).click();
    await isha.page.waitForURL(/\/login\?expired=1/);
  });
  await step(isha.page, "She cannot sign back in while suspended", async () => {
    await isha.page.locator("#email").fill(NIMBUS.isha);
    await isha.page.locator("#password").fill("Demo@12345");
    await isha.page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(isha.page)).toContainText("not active");
  });
  await step(page, "Vikram reactivates her", async () => {
    await drawer.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog", { name: "Reactivate account?" }).getByRole("button", { name: "Reactivate" }).click();
    await toast(page, "Account updated");
    await expect(drawer.getByRole("button", { name: "Suspend" })).toBeVisible(); // active again
  });
  await isha.close();
});

test("Access preview, last-administrator protection and company settings", async ({ page }) => {
  await login(page, NIMBUS.admin);
  await step(page, "Arjun's effective access is explained by the same engine the API uses", async () => {
    const drawer = await openUser(page, "Arjun Das");
    await expect(drawer.getByText("Effective access")).toBeVisible();
    const approve = drawer.locator("li").filter({ hasText: "Approve leave" });
    await expect(approve).toContainText("Direct reports");
    await expect(drawer.getByText("Restricted")).toBeVisible();
  });
  await step(page, "Ananya cannot strip her own administrator role", async () => {
    await page.keyboard.press("Escape");
    const self = await openUser(page, "Ananya Rao");
    await expect(self.getByText("You can't change your own roles.")).toBeVisible();
  });
  await step(page, "Ananya updates the late-arrival grace period", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Policies" }).click();
    await page.getByLabel("Late grace period (minutes)").fill("20");
    await page.getByRole("button", { name: "Save" }).first().click();
    await toast(page, "Settings saved");
  });
  await page.context().clearCookies();
  await login(page, NIMBUS.hr);
  await step(page, "Company settings are not part of the HR role", async () => {
    await page.goto("/settings");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
