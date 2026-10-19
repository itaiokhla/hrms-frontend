import type { Page } from "@playwright/test";

import { NIMBUS, SAFFRON, api, expect, login, openAs, step, test, toast } from "./support/fixtures";

async function assignTo(page: Page, name: string) {
  const drawer = page.getByRole("dialog", { name: "HP EliteBook 840" });
  await drawer.locator("button[aria-haspopup=listbox]").click();
  await drawer.getByPlaceholder("Type a name, code or email").fill(name);
  await drawer.getByRole("option", { name: new RegExp(name) }).click();
}

test("Asset lifecycle: inventory → assign → acknowledge → transfer → recover", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.hr);
  await step(page, "Vikram adds a new laptop to inventory", async () => {
    await page.goto("/assets");
    await page.getByRole("button", { name: "Add asset" }).click();
    const dialog = page.getByRole("dialog", { name: "Add asset" });
    await dialog.getByLabel("Asset tag").fill("LAP-005");
    await dialog.getByLabel("Name").fill("HP EliteBook 840");
    await dialog.getByLabel("Category").fill("Laptop");
    await dialog.getByLabel("Serial number").fill("5CG3341XYZ");
    await dialog.getByRole("button", { name: "Save" }).click();
    await toast(page, "Asset saved");
    await expect(page.getByRole("row", { name: /LAP-005/ })).toContainText("In stock");
  });

  await step(page, "Vikram assigns it to Meera", async () => {
    await page.getByRole("row", { name: /LAP-005/ }).click();
    await assignTo(page, "Meera Pillai");
    await page.getByRole("dialog", { name: "HP EliteBook 840" }).getByRole("button", { name: "Assign" }).click();
    await toast(page, "Asset assigned");
  });

  const meera = await openAs(browser, testInfo, "Meera", NIMBUS.meera);
  await step(meera.page, "Meera sees the laptop under My assets and acknowledges receipt", async () => {
    await meera.page.goto("/assets");
    await expect(meera.page.getByText("HP EliteBook 840")).toBeVisible();
    await meera.page.getByRole("button", { name: "Acknowledge receipt" }).click();
    await toast(meera.page, "Receipt acknowledged");
  });
  await step(meera.page, "Meera has no inventory view and cannot touch other assets", async () => {
    await expect(meera.page.getByRole("tab", { name: "Inventory" })).toHaveCount(0);
    expect((await api(meera.page, "POST", "/assets", { asset_tag: "X", name: "X", category: "X" })).status).toBe(403);
  });
  await meera.close();

  await step(page, "The laptop is transferred to Nikhil, then recovered into stock", async () => {
    await page.reload();
    await page.getByRole("row", { name: /LAP-005/ }).click();
    await assignTo(page, "Nikhil Jain");
    const drawer = page.getByRole("dialog", { name: "HP EliteBook 840" });
    await drawer.getByRole("button", { name: "Transfer" }).click();
    await toast(page, "Asset transferred");
    await drawer.getByLabel("Return condition").selectOption("good");
    await drawer.getByRole("button", { name: "Recover" }).click();
    await toast(page, "Asset returned");
    await expect(drawer.getByText("Meera Pillai")).toBeVisible();
    await expect(drawer.getByText("Nikhil Jain")).toBeVisible();
  });

  const divya = await openAs(browser, testInfo, "Divya", NIMBUS.divya);
  await step(divya.page, "Divya only ever sees her own MacBook", async () => {
    await divya.page.goto("/assets");
    await expect(divya.page.getByText("MacBook Pro 14")).toBeVisible();
    await expect(divya.page.getByText("HP EliteBook 840")).toHaveCount(0);
    const list = await api<{ total: number }>(divya.page, "GET", "/assets");
    expect(list.data.total).toBe(1);
  });
  await divya.close();
});

test("Holiday calendars are per company and per location", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.divya);
  await step(page, "Divya (Pune) sees company-wide holidays but not Bengaluru's or Mumbai's", async () => {
    await page.goto("/holidays");
    await expect(page.getByText("Diwali")).toBeVisible();
    await expect(page.getByText("Karnataka Rajyotsava")).toHaveCount(0);
    await expect(page.getByText("Ganesh Chaturthi")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add holiday" })).toHaveCount(0);
  });

  const meera = await openAs(browser, testInfo, "Meera (Bengaluru)", NIMBUS.meera);
  await step(meera.page, "Meera (Bengaluru) also gets Karnataka Rajyotsava", async () => {
    await meera.page.goto("/holidays");
    await expect(meera.page.getByText("Karnataka Rajyotsava")).toBeVisible();
  });
  await meera.close();

  const vikram = await openAs(browser, testInfo, "Vikram (HR)", NIMBUS.hr);
  await step(vikram.page, "Vikram adds a company-wide holiday", async () => {
    await vikram.page.goto("/holidays");
    await vikram.page.getByRole("button", { name: "Add holiday" }).click();
    const dialog = vikram.page.getByRole("dialog", { name: "Add holiday" });
    await dialog.getByLabel("Name").fill("Nimbus Foundation Day");
    await dialog.getByLabel("Date").fill(`${new Date().getFullYear()}-12-12`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await toast(vikram.page, "Holiday saved");
    await expect(vikram.page.getByText("Nimbus Foundation Day")).toBeVisible();
  });
  await vikram.close();

  await page.context().clearCookies();
  await login(page, SAFFRON.ramesh);
  await step(page, "Saffron's employees see Saffron's calendar only", async () => {
    await page.goto("/holidays");
    await expect(page.getByText("Pongal")).toBeVisible();
    await expect(page.getByText("Nimbus Foundation Day")).toHaveCount(0);
    await expect(page.getByText("Karnataka Rajyotsava")).toHaveCount(0);
  });
});
