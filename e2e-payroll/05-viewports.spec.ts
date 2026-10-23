import { company, expect, login, noHorizontalOverflow, settle, shot, test, writeEvidence, type CompanyKey } from "./support";

/**
 * Key payroll pages at desktop, tablet and mobile widths (Goal 2 §20): the page renders, has a heading,
 * shows no sideways scrolling and no page errors. One company per viewport keeps memory use low.
 */
const VIEWPORTS = {
  desktop: { width: 1400, height: 880 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

const PLAN: [keyof typeof VIEWPORTS, CompanyKey][] = [["desktop", "alpha"], ["tablet", "beta"], ["mobile", "gamma"]];

for (const [vp, key] of PLAN) {
  test(`${vp} (${key}): key payroll pages render without overflow`, async ({ browser }, testInfo) => {
    const runId = company(key).runs.finalized.id;
    const results: Record<string, { overflow: boolean; heading: boolean }> = {};
    const admin = await login(browser, testInfo, key, "admin", { viewport: VIEWPORTS[vp], isMobile: vp === "mobile", label: `admin-${vp}` });
    try {
      for (const path of ["/payroll", "/payroll/runs", `/payroll/runs/${runId}`, "/payroll/payments", "/payroll/bank-details", "/payroll/payslips", "/payroll/reports", "/settings/payroll/general"]) {
        await admin.page.goto(path);
        await settle(admin.page);
        const ok = await noHorizontalOverflow(admin.page);
        const heading = (await admin.page.getByRole("heading").count()) > 0;
        results[`admin ${path}`] = { overflow: !ok, heading };
        await shot(admin.page, testInfo, `vp-${vp}-${key}-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root"}`);
      }
      expect(admin.pageErrors).toEqual([]);
    } finally {
      await admin.close();
    }
    const emp = await login(browser, testInfo, key, "emp1", { viewport: VIEWPORTS[vp], isMobile: vp === "mobile", label: `emp1-${vp}` });
    try {
      for (const path of ["/me/salary", "/me/payslips", "/me/payments", "/me/bank-accounts"]) {
        await emp.page.goto(path);
        await settle(emp.page);
        const ok = await noHorizontalOverflow(emp.page);
        results[`emp1 ${path}`] = { overflow: !ok, heading: (await emp.page.getByRole("heading").count()) > 0 };
        await shot(emp.page, testInfo, `vp-${vp}-${key}-emp-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`);
      }
      expect(emp.pageErrors).toEqual([]);
    } finally {
      await emp.close();
    }
    writeEvidence(`viewport-${vp}-${key}.json`, results);
    const overflowing = Object.entries(results).filter(([, r]) => r.overflow).map(([p]) => p);
    const headless = Object.entries(results).filter(([, r]) => !r.heading).map(([p]) => p);
    expect(overflowing, "pages with sideways scrolling").toEqual([]);
    expect(headless, "pages without a heading").toEqual([]);
  });
}
