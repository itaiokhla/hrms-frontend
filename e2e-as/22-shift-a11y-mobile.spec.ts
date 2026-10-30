/**
 * Shift module S5 (FU-AS-54; owner decision IG-AS-150): an automated accessibility pass and a phone-width check of the
 * shift screens in Chrome.
 *
 * For each page, as the persona who uses it: axe (WCAG 2 A / AA rules) on the page's main content finds no serious
 * or critical violation, and at 390 × 844 the page does not scroll sideways.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, openAs, shot, test, type CompanyKey } from "./support";

const PAGES: { who: string; path: string; ready: string }[] = [
  { who: "imran", path: "/rosters/my-schedule", ready: "main" },
  { who: "imran", path: "/attendance/open-shifts", ready: "[data-testid=open-shifts]" },
  { who: "kiran", path: "/rosters", ready: "main" },
  { who: "kiran", path: "/attendance/shift-requests", ready: "main" },
  { who: "kavya", path: "/attendance/shifts", ready: "main" },
  { who: "kavya", path: "/settings/attendance/shift-requests", ready: "[data-testid=shift-request-settings]" },
];

for (const { who, path, ready } of PAGES) {
  test(`a11y + phone width: ${path} (${who})`, async ({ browser }, testInfo) => {
    const person = await openAs(browser, "alpha" as CompanyKey, who);
    const page = person.page;
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, testInfo, `22-${path.replace(/\//g, "_")}-phone`);
    expect(overflow, `${path} scrolls sideways by ${overflow}px at 390 px`).toBeLessThanOrEqual(1);
    await person.close();
  });
}
