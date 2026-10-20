import type { Page } from "@playwright/test";

import { NIMBUS, ORBIT, PASSWORD, PLATFORM, api, expect, formAlert, login, openAs, step, test, toast } from "./support/fixtures";

async function platformLogin(page: Page) {
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(PLATFORM.email);
  await page.getByLabel("Password").fill(PLATFORM.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/platform$/);
}

function orbitRow(page: Page) {
  return page.getByRole("row", { name: new RegExp(ORBIT.name) });
}

test("Company accounts can't use the platform console", async ({ page }) => {
  await login(page, NIMBUS.admin);
  await step(page, "Even Nimbus's administrator is sent to the platform sign-in", async () => {
    await page.goto("/platform");
    await page.waitForURL(/\/platform\/login/);
    expect((await api(page, "GET", "/platform/companies")).status).toBe(401);
  });
});

test("Operators manage tenants and subscriptions — never HR data", async ({ page, browser }, testInfo) => {
  await step(page, "The platform operator signs in to the console", async () => platformLogin(page));

  await step(page, "All three companies are listed with aggregate counts only", async () => {
    for (const name of [NIMBUS.name, "Saffron Foods", ORBIT.name]) {
      await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    }
    await expect(orbitRow(page).getByRole("cell", { name: "3/3", exact: true })).toBeVisible(); // active/total logins
    await expect(orbitRow(page).getByRole("cell", { name: "4", exact: true })).toBeVisible(); // Daniel, Fatima, Joseph, Aman
  });

  await step(page, "The operator's session cannot read any tenant's HR records", async () => {
    for (const path of ["/employees", "/payroll", "/leaves", "/users", "/audit-logs"]) {
      expect((await api(page, "GET", path)).status, path).toBe(401);
    }
  });

  const joseph = await openAs(browser, testInfo, "Joseph (Orbit employee)", ORBIT.joseph);

  await step(page, "Orbit's subscription lapses (past due)", async () => {
    await orbitRow(page).getByLabel("Subscription").selectOption("past_due");
    await toast(page, `${ORBIT.name} updated`);
    await expect(orbitRow(page).getByLabel("Subscription")).toHaveValue("past_due"); // as reloaded from the server
  });
  await step(joseph.page, "Orbit's users see a clear billing message instead of HR data", async () => {
    await joseph.page.reload();
    await expect(joseph.page.getByRole("heading", { name: "Subscription inactive" })).toBeVisible();
    expect((await api(joseph.page, "GET", "/leaves/my")).status).toBe(402);
  });
  await step(page, "The subscription is reactivated", async () => {
    await orbitRow(page).getByLabel("Subscription").selectOption("active");
    await toast(page, `${ORBIT.name} updated`);
    await expect(orbitRow(page).getByLabel("Subscription")).toHaveValue("active"); // as reloaded from the server
  });
  await step(joseph.page, "Access returns immediately", async () => {
    await joseph.page.reload();
    await expect(joseph.page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });

  await step(page, "The operator suspends the Orbit workspace", async () => {
    await orbitRow(page).getByLabel("Status").selectOption("suspended");
    await toast(page, `${ORBIT.name} updated`);
    await expect(orbitRow(page).getByLabel("Status")).toHaveValue("suspended"); // as reloaded from the server
  });
  await step(joseph.page, "Joseph's session ends and he cannot sign back in", async () => {
    await joseph.page.getByRole("link", { name: "Leave" }).click();
    await joseph.page.waitForURL(/\/login/);
    await joseph.page.goto("/login");
    await joseph.page.locator("#email").fill(ORBIT.joseph);
    await joseph.page.locator("#password").fill(PASSWORD);
    await joseph.page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(joseph.page)).toContainText("workspace is suspended");
  });
  await step(page, "The workspace is restored", async () => {
    await orbitRow(page).getByLabel("Status").selectOption("active");
    await toast(page, `${ORBIT.name} updated`);
    await expect(orbitRow(page).getByLabel("Status")).toHaveValue("active"); // as reloaded from the server
  });
  await step(joseph.page, "Joseph can sign in again", async () => {
    await login(joseph.page, ORBIT.joseph);
  });
  await joseph.close();

  await step(page, "Other tenants were never affected", async () => {
    await expect(page.getByRole("row", { name: new RegExp(NIMBUS.name) }).getByLabel("Status")).toHaveValue("active");
  });
});
