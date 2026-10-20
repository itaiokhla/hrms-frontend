import fs from "node:fs";

import { api, cssVar, db, evidencePath, expect, host, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * Gamma's administrator edits, previews, publishes and rolls back the brand while a colleague is
 * signed in; Alpha and Beta never change; the partner's lock holds; bad input is refused.
 */
const S = secrets();
const G = S.companies.gamma;
const firstPaintTitle = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const tagline = async (request: any, origin: string) => (await (await request.get(`${origin}/api/v1/public/brand`)).json()).tagline;

test("Gamma: draft, preview, publish, live session update and rollback; other companies untouched", async ({ browser, request }, testInfo) => {
  const admin = await openTenant(browser, testInfo, "gamma-brand-admin", host(G));
  const colleague = await openTenant(browser, testInfo, "gamma-colleague", host(G));
  try {
    await signIn(admin.page, G.people.admin.email, S.password);
    await signIn(colleague.page, G.people.emp1.email, S.password);
    const otherTaglines = [await tagline(request, host(S.companies.alpha)), await tagline(request, host(S.companies.beta))];
    const before = await tagline(request, host(G));
    expect(before).toBe(G.brand.tagline);

    await admin.page.goto("/settings/branding");
    await expect(admin.page.getByRole("heading", { name: "Branding & domains" })).toBeVisible();
    await admin.page.locator('[data-field="tagline"]').fill("Gamma — built for remote teams");
    await expect(admin.page.getByTestId("draft-badge")).toContainText("unpublished change");
    // Drafts are invisible to everyone else.
    expect(await tagline(request, host(G))).toBe(before);
    await colleague.page.reload();
    await expect(colleague.page.getByTestId("sidebar-product")).toHaveText("Gamma HR Cloud");

    // Bad input is refused: an SVG logo and a colour that is not a colour.
    await admin.page.getByRole("tab", { name: "Logos" }).click();
    await admin.page.locator('[data-upload="mark"]').setInputFiles({ name: "x.svg", mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    await expect(admin.page.getByText(/SVG images are not accepted/)).toBeVisible();
    expect((await api(admin.page, "PUT", "/branding/draft", { changes: { primary_color: "orange; background:url(x)" } })).status).toBe(400);
    // The partner locks the "Powered by" line: the tenant cannot switch it off.
    await api(admin.page, "PUT", "/branding/draft", { changes: { show_powered_by: false } });
    await admin.page.reload();

    await admin.page.getByTestId("publish-brand").click();
    await expect(admin.page.getByTestId("publish-diff")).toContainText("Tagline");
    await shot(admin.page, testInfo, "05-gamma-publish-diff");
    await admin.page.getByTestId("confirm-publish").click();
    await expect(admin.page.getByText(/Version \d+ is live/)).toBeVisible();
    await expect.poll(() => tagline(request, host(G)), { timeout: 30_000 }).toBe("Gamma — built for remote teams");
    expect((await (await request.get(`${host(G)}/api/v1/public/brand`)).json()).show_powered_by).toBe(true); // lock held
    await colleague.page.reload();
    await expect(colleague.page.getByTestId("sidebar-product")).toHaveText("Gamma HR Cloud");
    const login = await request.get(`${host(G)}/login`);
    expect(await login.text()).toContain("Gamma — built for remote teams"); // first paint
    expect(firstPaintTitle(await login.text())).toBe("Gamma HR Cloud");
    // Alpha and Beta were not touched.
    expect([await tagline(request, host(S.companies.alpha)), await tagline(request, host(S.companies.beta))]).toEqual(otherTaglines);

    // Roll back from History.
    await admin.page.getByRole("tab", { name: "History" }).click();
    const versions = db<{ version: number; status: string }>("brand_versions", { company_id: G.company_id });
    const previous = versions.filter((v) => v.status === "ARCHIVED").at(-1)!;
    await admin.page.getByTestId(`restore-v${previous.version}`).click();
    await admin.page.getByRole("button", { name: "Restore" }).last().click();
    await expect(admin.page.getByText(`Version ${previous.version} restored`)).toBeVisible();
    await expect.poll(() => tagline(request, host(G)), { timeout: 30_000 }).toBe(before);
    await shot(admin.page, testInfo, "05-gamma-history-after-rollback");
    fs.writeFileSync(evidencePath("05-gamma-brand-versions.json"), JSON.stringify(
      db("brand_versions", { company_id: G.company_id }), null, 2));
    expect(await cssVar(admin.page, "--primary")).not.toBe("");
  } finally {
    await admin.close();
    await colleague.close();
  }
});

test("Alpha: a payslip issued before a brand change is reprinted byte for byte afterwards", async ({ browser }, testInfo) => {
  const A = S.companies.alpha;
  const admin = await openTenant(browser, testInfo, "alpha-reprint-admin", host(A));
  try {
    await signIn(admin.page, A.people.admin.email, S.password);
    const slip = A.payroll.emp1.id;
    const first = await admin.page.request.get(`${host(A)}/api/v1/payroll/${slip}/slip.pdf`);
    expect(first.status()).toBe(200);
    const hash = first.headers()["x-document-sha256"];
    expect((await api(admin.page, "PUT", "/branding/draft", { changes: { legal_footer: "Alpha Technologies Pvt Ltd · new footer" } })).status).toBe(200);
    expect((await api(admin.page, "POST", "/branding/publish", {})).status).toBe(200);
    const again = await admin.page.request.get(`${host(A)}/api/v1/payroll/${slip}/slip.pdf`);
    expect(again.headers()["x-document-sha256"]).toBe(hash);
    expect(Buffer.compare(await again.body(), await first.body())).toBe(0);
    fs.writeFileSync(evidencePath("05-alpha-payslip-reprint.pdf"), await again.body());
    await testInfo.attach("05-alpha-payslip-reprint.pdf", { path: evidencePath("05-alpha-payslip-reprint.pdf"), contentType: "application/pdf" });
  } finally {
    await admin.close();
  }
});
