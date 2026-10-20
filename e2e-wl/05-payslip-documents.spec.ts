import { HOSTS, db, evidencePath, expect, inspectPdf, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * Each company's employee downloads their own payslip from the Payslips page in Chrome. The PDF is
 * checked by an independent library: employer legal entity, currency glyphs (₹, $, AED), non-Latin
 * names, branding, and no WinAnsi fallback squares.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();

const CASES: { key: "alpha" | "beta" | "gamma"; host: string; person: string; employer: string; expects: (string | RegExp)[]; currency: string }[] = [
  { key: "alpha", host: HOSTS.alpha, person: "employee", employer: "Alpha Technologies India Private Limited",
    expects: ["₹", "CIN: U72200KA2019PTC123456", "Alpha Technologies India Private Limited · CIN U72200KA2019PTC123456"], currency: "INR" },
  { key: "beta", host: HOSTS.beta, person: "employee", employer: "Beta Gulf Trading LLC",
    // Shaped Arabic is extracted as contextual presentation forms (U+FE70-U+FEFE); isolated, unshaped
    // letters would not be. The name is also checked visually in the rendered page image.
    expects: ["AED 9,500.00", "Trade licence: DED-778899", /[\uFE70-\uFEFE]{3}/], currency: "AED" },
  { key: "gamma", host: HOSTS.gamma, person: "employee", employer: "Gamma Health Systems Inc.",
    expects: ["$6,200.00", "EIN: 12-3456789"], currency: "USD" },
];

for (const c of CASES) {
  test(`${c.key}: employee downloads a branded, immutable payslip in ${c.currency}`, async ({ browser }, testInfo) => {
    const company = S.companies[c.key];
    const employee = await openTenant(browser, testInfo, `${c.key}-payslip-employee`, c.host);
    try {
      await signIn(employee.page, company.people[c.person].email, S.password);
      await employee.page.goto("/payslips");
      await employee.page.getByRole("button").filter({ hasText: /Gross/ }).first().click();
      await shot(employee.page, testInfo, `05-${c.key}-payslip-view`);
      const [download] = await Promise.all([
        employee.page.waitForEvent("download"),
        employee.page.getByRole("button", { name: /Download PDF/i }).click(),
      ]);
      const file = evidencePath(`05-${c.key}-payslip.pdf`);
      await download.saveAs(file);
      const pdf = inspectPdf(file, evidencePath(`05-${c.key}-payslip-page1.png`));
      await testInfo.attach(`05-${c.key}-payslip.pdf`, { path: file, contentType: "application/pdf" });
      await testInfo.attach(`05-${c.key}-payslip-page1.png`, { path: evidencePath(`05-${c.key}-payslip-page1.png`), contentType: "image/png" });
      expect(pdf.has_black_square).toBe(false);
      expect(pdf.text).toContain(c.employer);
      for (const fragment of c.expects) {
        if (fragment instanceof RegExp) expect(pdf.text).toMatch(fragment);
        else expect(pdf.text, fragment).toContain(fragment);
      }
      expect(pdf.fonts.some((f) => f.includes("NotoSans"))).toBe(true);
      for (const other of CASES.filter((x) => x.key !== c.key)) expect(pdf.text).not.toContain(other.employer);
      const issued = db<{ sha256: string; employer: string }>("issued_document", { source_id: company.payroll_ids[c.person] })
        .filter((d) => d.employer === c.employer);
      expect(issued).toHaveLength(1);
      expect(issued[0].sha256).toBe(pdf.sha256); // the bytes downloaded are the bytes issued
    } finally {
      await employee.close();
    }
  });
}
