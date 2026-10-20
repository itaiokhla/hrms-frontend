import fs from "node:fs";
import path from "node:path";

import { HOSTS, db, evidencePath, expect, openTenant, secrets, shot, signIn, test } from "./support";

/**
 * Beta's custom domain (verified through the DNS fixture, TLS simulated): domain status UI,
 * sign-in handoff from the platform address with a single-use code, redirect of other addresses
 * to the primary one, and branded invitation emails whose links use the verified domain.
 */
test.describe.configure({ mode: "serial" });

const S = secrets();
const B = S.companies.beta;
const OUTBOX = path.join(__dirname, "..", "..", "hrms-backend", "logs", "outbox", String(B.company_id));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36 WL-E2E";

test("domain status, enforced handoff, replay refused, redirect to the primary address", async ({ browser }, testInfo) => {
  const admin = await openTenant(browser, testInfo, "beta-domain-admin", HOSTS.beta);
  try {
    await signIn(admin.page, B.admin, S.password);
    await admin.page.goto("/settings/branding?tab=domains");
    const custom = admin.page.locator('[data-domain="people.betagulf.localhost"]');
    await expect(custom.locator('[data-status="ACTIVE"]')).toBeVisible();
    await expect(custom).toContainText("Primary");
    await expect(custom).toContainText("(simulated)");
    await expect(admin.page.locator('[data-domain="beta-gulf-trading.hrms.localhost"]')).toContainText("Platform address");
    await expect(admin.page.getByText(/Development mode: DNS records come from a local fixture/)).toBeVisible();
    await shot(admin.page, testInfo, "04-beta-domains");

    // Hostname validation in the wizard.
    await admin.page.getByTestId("add-domain").click();
    await admin.page.getByTestId("domain-hostname").fill("x.hrms.localhost");
    await admin.page.getByTestId("domain-continue").click();
    await expect(admin.page.getByText("That address belongs to the platform. Use your own domain.")).toBeVisible();
    await admin.page.getByTestId("domain-hostname").fill("people.betagulf.localhost");
    await admin.page.getByTestId("domain-continue").click();
    await expect(admin.page.getByText("That domain is already connected to a workspace.")).toBeVisible();
    await shot(admin.page, testInfo, "04-domain-wizard-validation");
    await admin.page.keyboard.press("Escape");

    // Enforce the custom domain at sign-in.
    await admin.page.getByRole("switch", { name: "Enforce the custom domain at sign-in" }).click();
    await expect.poll(() => db<{ enforce_custom_domain: boolean }>("domain", { hostname: "people.betagulf.localhost" })[0].enforce_custom_domain).toBe(true);

    // A Beta user signs in on the platform address and lands on Beta's domain.
    const traveller = await openTenant(browser, testInfo, "beta-handoff", HOSTS.platform, { userAgent: UA });
    let handoffUrl = "";
    traveller.page.on("response", async (r) => {
      if (r.url().endsWith("/api/v1/auth/login") && r.status() === 200) handoffUrl = (await r.json()).handoff_url ?? "";
    });
    await traveller.page.goto("/login");
    await traveller.page.locator("#email").fill(B.people.hr.email);
    await traveller.page.locator("#password").fill(S.password);
    await traveller.page.getByRole("button", { name: /sign in/i }).click();
    await traveller.page.waitForURL(`${HOSTS.beta}/dashboard`, { timeout: 30_000 });
    expect(handoffUrl).toMatch(/^http:\/\/people\.betagulf\.localhost:\d+\/auth\/handoff#code=/);
    expect(await traveller.page.evaluate(() => location.hash)).toBe("");
    expect((await traveller.context.cookies(HOSTS.platform)).filter((c) => c.name === "hrms_access")).toEqual([]);
    expect((await traveller.context.cookies(HOSTS.beta)).map((c) => c.name)).toContain("hrms_access");
    await expect(traveller.page.getByTestId("sidebar-product")).toHaveText("PayEase HR");
    await shot(traveller.page, testInfo, "04-handoff-landed-on-custom-domain");
    await traveller.close();

    // Replaying the same one-time link fails.
    const replay = await openTenant(browser, testInfo, "beta-handoff-replay", HOSTS.beta, { userAgent: UA });
    await replay.page.goto(handoffUrl);
    await expect(replay.page.getByRole("heading", { name: "Sign-in link expired" })).toBeVisible();
    await shot(replay.page, testInfo, "04-handoff-replay-refused");
    await replay.close();

    // Redirect other addresses to the primary one.
    await admin.page.getByRole("switch", { name: "Redirect other addresses to the primary" }).click();
    await expect.poll(() => db<{ redirect_to_primary: boolean }>("domain", { hostname: "people.betagulf.localhost" })[0].redirect_to_primary).toBe(true);
    const visitor = await openTenant(browser, testInfo, "beta-subdomain-visitor", HOSTS.betaSubdomain);
    await expect.poll(async () => {
      await visitor.page.goto(`${HOSTS.betaSubdomain}/login`);
      return visitor.page.url();
    }, { timeout: 45_000 }).toBe(`${HOSTS.beta}/login`);
    await visitor.close();

    // Turn both rules off again for the remaining tests.
    await admin.page.getByRole("switch", { name: "Redirect other addresses to the primary" }).click();
    await admin.page.getByRole("switch", { name: "Enforce the custom domain at sign-in" }).click();
    await expect.poll(() => {
      const row = db<{ enforce_custom_domain: boolean; redirect_to_primary: boolean }>("domain", { hostname: "people.betagulf.localhost" })[0];
      return row.enforce_custom_domain || row.redirect_to_primary;
    }).toBe(false);
    const audit = db<{ action: string; description: string }>("audit_actions", { company_id: B.company_id, module: "Domains" });
    await testInfo.attach("domain-audit.json", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ADDED", "STATUS", "PRIMARY", "SETTINGS"]));
  } finally {
    await admin.close();
  }
});

test("branded invitation email uses Beta's verified domain; email wording is sandboxed", async ({ browser }, testInfo) => {
  const admin = await openTenant(browser, testInfo, "beta-email-admin", HOSTS.beta);
  try {
    await signIn(admin.page, B.admin, S.password);
    const before = new Set(fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []);
    const invite = await admin.page.evaluate(async () => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))!.split("=")[1]);
      const res = await fetch("/api/v1/users/invite", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ email: "new.joiner@beta-gulf.example", full_name: "New Joiner", role_ids: [] }),
      });
      return res.json();
    });
    expect(invite.invite_url).toMatch(/^http:\/\/people\.betagulf\.localhost:3200\/accept-invite\?token=/);
    const created = fs.readdirSync(OUTBOX).filter((f) => !before.has(f) && f.startsWith("auth.invite-new.joiner"));
    const htmlFile = created.find((f) => f.endsWith(".html"))!;
    const emlFile = created.find((f) => f.endsWith(".eml"))!;
    const html = fs.readFileSync(path.join(OUTBOX, htmlFile), "utf8");
    const eml = fs.readFileSync(path.join(OUTBOX, emlFile), "utf8");
    expect(eml).toMatch(/^From: Beta Gulf Trading </m);
    expect(eml).toMatch(/^Reply-To: hr@beta-gulf.example/m);
    expect(html).toContain("http://people.betagulf.localhost:3200/accept-invite?token=");
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("Powered by"); // hidden and locked by the partner
    for (const other of ["Alpha", "Gamma"]) expect(html).not.toContain(other);
    fs.copyFileSync(path.join(OUTBOX, htmlFile), evidencePath("04-beta-invitation-email.html"));
    await admin.page.goto(`file://${evidencePath("04-beta-invitation-email.html").replace(/\\/g, "/")}`);
    await shot(admin.page, testInfo, "04-beta-invitation-email");

    // The invitation link opens Beta's branded acceptance page on the custom domain.
    const joiner = await openTenant(browser, testInfo, "beta-joiner", HOSTS.beta);
    await joiner.page.goto(invite.invite_url);
    await expect(joiner.page.getByTestId("brand-product-name")).toHaveText("PayEase HR");
    await expect(joiner.page.locator("html")).toHaveAttribute("dir", "rtl");
    await shot(joiner.page, testInfo, "04-beta-accept-invite");
    // The same link on another tenant's host is refused.
    await joiner.page.goto(invite.invite_url.replace(HOSTS.beta, HOSTS.alpha));
    await expect(joiner.page.getByText(/invalid or has expired/i)).toBeVisible();
    await joiner.close();

    // Email wording editor: unknown placeholders and template logic are refused.
    await admin.page.goto("/settings/branding?tab=email");
    await admin.page.getByTestId("email-subject").fill("Welcome {{ employee.salary }}");
    await admin.page.getByTestId("email-save").click();
    await expect(admin.page.getByRole("alert").filter({ hasText: /Unknown placeholder/ })).toBeVisible();
    await admin.page.getByTestId("email-subject").fill("{% for x in company %}x{% endfor %}");
    await admin.page.getByTestId("email-save").click();
    await expect(admin.page.getByRole("alert").filter({ hasText: /not valid/ })).toBeVisible();
    await admin.page.getByTestId("email-subject").fill("Welcome to {{ company.name }}, {{ recipient.first_name }}");
    await admin.page.getByTestId("email-save").click();
    await expect(admin.page.getByText("Email wording saved")).toBeVisible();
    await expect(admin.page.getByTestId("email-preview-subject")).toHaveText("Welcome to Beta Gulf Trading, Alex");
    await shot(admin.page, testInfo, "04-beta-email-editor", true);
  } finally {
    await admin.close();
  }
});
