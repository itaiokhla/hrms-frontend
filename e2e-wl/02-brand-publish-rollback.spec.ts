import fs from "node:fs";

import { HOSTS, cssVar, db, evidencePath, expect, inspectPdf, makePng, openTenant, secrets, sha256, shot, signIn, test } from "./support";

/**
 * Alpha's administrator edits the brand in Settings › Branding: the draft stays invisible to
 * colleagues, can be previewed in a new tab, is published with a field diff, reaches the very
 * first paint of the next page load (new token, new content-hashed favicon) and can be rolled back.
 * A payslip issued before the change is reprinted byte for byte.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();
const A = S.companies.alpha;

function firstPaint(html: string) {
  return {
    style: html.match(/<style id="brand-tokens">([^<]*)<\/style>/)?.[1] ?? "",
    version: html.match(/data-brand-version="([^"]+)"/)?.[1] ?? "",
    icon: html.match(/<link rel="icon" href="([^"]+)"/)?.[1] ?? "",
  };
}

test("draft → preview → publish → first paint → rollback, with payslips unchanged", async ({ browser, request }, testInfo) => {
  const admin = await openTenant(browser, testInfo, "alpha-brand-admin", HOSTS.alpha);
  const colleague = await openTenant(browser, testInfo, "alpha-colleague", HOSTS.alpha);
  try {
    await signIn(admin.page, A.admin, S.password);
    await signIn(colleague.page, A.people.employee.email, S.password);

    // A payslip issued (approved) before any brand change.
    const payslipId = A.payroll_ids.employee;
    const before = await admin.page.request.get(`${HOSTS.alpha}/api/v1/payroll/${payslipId}/slip.pdf`);
    expect(before.status()).toBe(200);
    const beforeBytes = await before.body();
    fs.writeFileSync(evidencePath("02-payslip-before-rebrand.pdf"), beforeBytes);
    const beforeFirstPaint = firstPaint(await (await request.get(`${HOSTS.alpha}/login`)).text());

    await admin.page.goto("/settings/branding");
    await expect(admin.page.getByRole("heading", { name: "Branding & domains" })).toBeVisible();
    await expect(admin.page.getByTestId("brand-status")).toContainText("Up to date");
    await shot(admin.page, testInfo, "02-branding-page-live");

    // Identity: new tagline.
    await admin.page.locator('[data-field="tagline"]').fill("Alpha — people first");
    // Colours: a new primary colour (auto-saved to the draft).
    await admin.page.getByRole("tab", { name: "Colours" }).click();
    await admin.page.locator('[data-field="primary_color"]').fill("#7C2D12");
    await expect(admin.page.getByTestId("contrast-report")).toContainText("Text on primary button");
    // Logos: a new light logo.
    await admin.page.getByRole("tab", { name: "Logos" }).click();
    await admin.page.locator('[data-upload="logo_light"]').setInputFiles({ name: "alpha-rust.png", mimeType: "image/png", buffer: makePng("Alpha", "#7C2D12") });
    await expect(admin.page.getByText("Image processed and added to the draft")).toBeVisible();
    await expect(admin.page.getByTestId("draft-badge")).toContainText("unpublished change");
    await shot(admin.page, testInfo, "02-draft-with-preview");

    // A bad upload is refused with a specific message and changes nothing.
    await admin.page.locator('[data-upload="mark"]').setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    await expect(admin.page.getByText(/SVG images are not accepted/)).toBeVisible();

    // The colleague still sees the live brand.
    await colleague.page.reload();
    expect(await cssVar(colleague.page, "--primary")).toBe("175 77% 26%");
    const live = await (await request.get(`${HOSTS.alpha}/api/v1/public/brand`)).json();
    expect(live.tagline).toBe("Work, simplified at Alpha");

    // Preview in a new tab (signed, short-lived token; nobody else sees it).
    const [preview] = await Promise.all([admin.context.waitForEvent("page"), admin.page.getByTestId("preview-new-tab").click()]);
    await preview.waitForURL(/\/dashboard/);
    await expect(preview.getByTestId("preview-banner")).toBeVisible();
    const previewPrimary = await cssVar(preview, "--primary");
    expect(previewPrimary).not.toBe("175 77% 26%");
    await shot(preview, testInfo, "02-preview-new-tab");
    await preview.getByRole("link", { name: "Exit preview" }).click();
    await expect(preview.getByTestId("preview-banner")).toHaveCount(0);
    await preview.close();

    // Publish with a field diff.
    await admin.page.getByTestId("publish-brand").click();
    const diff = admin.page.getByTestId("publish-diff");
    await expect(diff).toContainText("Tagline");
    await expect(diff).toContainText("Primary colour");
    await expect(diff).toContainText("Logo (light backgrounds)");
    await shot(admin.page, testInfo, "02-publish-modal-diff");
    await admin.page.getByTestId("confirm-publish").click();
    await expect(admin.page.getByText(/Version \d+ is live/)).toBeVisible();
    expect(await cssVar(admin.page, "--primary")).toBe(previewPrimary); // live swap without reload

    // Next page load: the new brand is in the first HTML byte, favicon has a new content hash.
    await expect.poll(async () => firstPaint(await (await request.get(`${HOSTS.alpha}/login`)).text()).version, { timeout: 45_000 })
      .not.toBe(beforeFirstPaint.version);
    const afterFirstPaint = firstPaint(await (await request.get(`${HOSTS.alpha}/login`)).text());
    expect(afterFirstPaint.style).toContain(`--primary:${previewPrimary}`);
    expect(afterFirstPaint.icon).toMatch(/[0-9a-f]{64}\.png$/);
    await colleague.page.reload();
    expect(await cssVar(colleague.page, "--primary")).toBe(previewPrimary);
    await shot(colleague.page, testInfo, "02-colleague-after-publish");

    // The issued payslip is reprinted byte for byte (EC-WL-09).
    const reprint = await admin.page.request.get(`${HOSTS.alpha}/api/v1/payroll/${payslipId}/slip.pdf`);
    const reprintBytes = await reprint.body();
    expect(sha256(reprintBytes)).toBe(sha256(beforeBytes));
    expect(reprint.headers()["x-document-sha256"]).toBe(sha256(beforeBytes));
    fs.writeFileSync(evidencePath("02-payslip-reprint-after-rebrand.pdf"), reprintBytes);
    const pdf = inspectPdf(evidencePath("02-payslip-reprint-after-rebrand.pdf"), evidencePath("02-payslip-reprint-page1.png"));
    expect(pdf.text).toContain("₹");
    expect(pdf.has_black_square).toBe(false);
    expect(pdf.text).toContain("Alpha Technologies India Private Limited");

    // Rollback: restore the previous version from History.
    await admin.page.getByRole("tab", { name: "History" }).click();
    const versions = db<{ version: number; status: string }>("brand_versions", { company_id: A.company_id });
    const previous = versions.filter((v) => v.status === "ARCHIVED").at(-1)!;
    await admin.page.getByTestId(`restore-v${previous.version}`).click();
    await admin.page.getByRole("button", { name: "Restore" }).last().click();
    await expect(admin.page.getByText(`Version ${previous.version} restored`)).toBeVisible();
    expect(await cssVar(admin.page, "--primary")).toBe("175 77% 26%");
    await expect.poll(async () => firstPaint(await (await request.get(`${HOSTS.alpha}/login`)).text()).style, { timeout: 45_000 })
      .toContain("--primary:175 77% 26%");
    await expect(admin.page.locator('[data-explain="primary_color"]')).toContainText("tenant");
    await shot(admin.page, testInfo, "02-history-after-rollback", true);

    // Audit trail of the brand changes.
    const audit = db<{ action: string; description: string }>("audit_actions", { company_id: A.company_id, module: "Branding" });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ASSET_UPLOADED", "DRAFT", "PUBLISHED", "RESTORED"]));
    await testInfo.attach("branding-audit.json", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
    expect(admin.errors).toEqual([]);
    expect(colleague.errors).toEqual([]);
  } finally {
    await admin.close();
    await colleague.close();
  }
});
