import fs from "node:fs";
import path from "node:path";

import { totp } from "../e2e/support/fixtures";
import { HOSTS, api, db, evidencePath, expect, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * Organisation screens (new branch, effective-dated transfer from the employee drawer), MFA with
 * the branded authenticator label, session refresh on a tenant host, and a branded reset email.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();
const G = S.companies.gamma;
const OUTBOX = path.join(__dirname, "..", "..", "hrms-backend", "logs", "outbox", String(G.company_id));

test("Gamma admin adds a branch and transfers an employee with an effective date", async ({ browser }, testInfo) => {
  const admin = await openTenant(browser, testInfo, "gamma-org-admin", HOSTS.gamma);
  try {
    await signIn(admin.page, G.admin, S.password);
    await admin.page.goto("/settings/organization");
    await expect(admin.page.locator('[data-entity="LE01"]')).toContainText("Gamma Health Systems Inc.");
    await admin.page.getByTestId("add-branch").click();
    await admin.page.getByRole("dialog").locator("select").first().selectOption({ label: "Gamma Health Systems Inc. (LE01)" });
    await admin.page.getByTestId("branch-name").fill("Seattle");
    await admin.page.getByTestId("branch-code").fill("SEA");
    await admin.page.getByRole("dialog").locator("select").nth(1).selectOption("US-WA");
    await admin.page.getByTestId("save-branch").click();
    await expect(admin.page.getByText("Branch saved")).toBeVisible();
    await expect(admin.page.locator('[data-branch="SEA"]')).toBeVisible();
    await shot(admin.page, testInfo, "08-gamma-organization-tree");

    // Transfer Gina (Denver) to Seattle from next month.
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    const effective = next.toISOString().slice(0, 10);
    await admin.page.goto("/employees");
    await admin.page.getByText("Gina Patel").first().click();
    await expect(admin.page.getByTestId("placement-timeline")).toContainText("Denver");
    await admin.page.getByTestId("change-placement").click();
    await admin.page.getByTestId("placement-branch").selectOption({ label: "Seattle · LE01" });
    await admin.page.getByTestId("placement-date").fill(effective);
    await admin.page.getByTestId("save-placement").click();
    await expect(admin.page.getByText("Placement changed")).toBeVisible();
    const timeline = admin.page.getByTestId("placement-timeline");
    await expect(timeline).toContainText("Seattle");
    await expect(timeline).toContainText("scheduled");
    await shot(admin.page, testInfo, "08-gamma-placement-timeline");
    const history = (await api(admin.page, "GET", `/employees/${G.people.gina.employee_id}/assignments`)).data as {
      branch: string; effective_from: string; effective_to: string | null; is_future: boolean;
    }[];
    expect(history[0]).toMatchObject({ branch: "Seattle", effective_from: effective, is_future: true });
    expect(history[1].branch).toBe("Denver");
    expect(new Date(history[1].effective_to!).getTime()).toBe(new Date(effective).getTime() - 86_400_000);
    // A change that starts before the current placement is refused.
    const overlap = await api(admin.page, "POST", `/employees/${G.people.gina.employee_id}/assignments`, {
      branch_id: G.branches.nyc.id, effective_from: "2025-01-01",
    });
    expect(overlap.status).toBe(409);
  } finally {
    await admin.close();
  }
});

test("MFA on a tenant host shows the branded authenticator label; session refresh stays on the host", async ({ browser }, testInfo) => {
  const user = await openTenant(browser, testInfo, "gamma-mfa", HOSTS.gamma);
  try {
    await signIn(user.page, G.people.employee.email, S.password);
    const setup = (await api(user.page, "POST", "/auth/mfa/setup")).data as { secret: string; otpauth_uri: string };
    expect(decodeURIComponent(setup.otpauth_uri)).toContain("issuer=PayEase HR (Gamma Health Systems)");
    expect((await api(user.page, "POST", "/auth/mfa/enable", { code: await totp(setup.secret) })).status).toBe(200);
    expect((await api(user.page, "POST", "/auth/refresh")).status).toBe(200); // refresh on the same host
    await user.page.evaluate(() => fetch("/api/v1/auth/logout", { method: "POST" }));

    await user.page.goto("/login");
    await user.page.locator("#email").fill(G.people.employee.email);
    await user.page.locator("#password").fill(S.password);
    await user.page.getByRole("button", { name: /sign in/i }).click();
    await expect(user.page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
    await expect(user.page.getByTestId("brand-product-name")).toHaveText("PayEase HR");
    await shot(user.page, testInfo, "08-gamma-mfa-step");
    await user.page.locator("#code").fill(await totp(setup.secret));
    await user.page.getByRole("button", { name: "Verify and continue" }).click();
    await user.page.waitForURL(/\/dashboard/);
    const sessions = db<{ host: string; revoked: boolean }>("sessions_by_host", { email: G.people.employee.email });
    expect(sessions.at(-1)).toMatchObject({ host: "gamma-health-systems.hrms.localhost", revoked: false });
  } finally {
    await user.close();
  }
});

test("password reset requested on Gamma's host sends a Gamma-branded email; other tenants get nothing", async ({ browser }, testInfo) => {
  const visitor = await openTenant(browser, testInfo, "gamma-reset", HOSTS.gamma);
  try {
    const before = new Set(fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []);
    await visitor.page.goto("/forgot-password");
    await visitor.page.locator('input[type="email"]').fill(G.people.gina.email);
    await visitor.page.getByRole("button", { name: /send|code|reset/i }).click();
    await visitor.page.waitForURL(/\/verify-otp/);
    const created = fs.readdirSync(OUTBOX).filter((f) => !before.has(f) && f.startsWith("auth.password_reset") && f.endsWith(".html"));
    expect(created).toHaveLength(1);
    const html = fs.readFileSync(path.join(OUTBOX, created[0]), "utf8");
    expect(html).toContain("Gamma Health Systems");
    expect(html).toMatch(/Code: \d{6}/);
    for (const other of ["Alpha", "Beta Gulf"]) expect(html).not.toContain(other);
    fs.copyFileSync(path.join(OUTBOX, created[0]), evidencePath("08-gamma-reset-email.html"));

    // The same request for an Alpha user on Gamma's host creates no code and sends nothing.
    const alphaOutbox = path.join(OUTBOX, "..", String(S.companies.alpha.company_id));
    const alphaBefore = fs.existsSync(alphaOutbox) ? fs.readdirSync(alphaOutbox).length : 0;
    const r = await visitor.page.request.post(`${HOSTS.gamma}/api/v1/auth/forgot-password`, { data: { email: S.companies.alpha.people.employee.email } });
    expect(r.status()).toBe(200);
    expect(fs.existsSync(alphaOutbox) ? fs.readdirSync(alphaOutbox).length : 0).toBe(alphaBefore);
  } finally {
    await visitor.close();
  }
});
