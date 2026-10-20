import { NIKHIL_NEW_PASSWORD, NIMBUS, PASSWORD, api, expect, formAlert, lastDevEmail, login, openAs, step, test, toast, totp } from "./support/fixtures";

test("Login is a single page with no company selector and generic errors", async ({ page }) => {
  await step(page, "The login form asks only for email and password", async () => {
    await page.goto("/login");
    // The form renders on the client; wait for it so the absence checks below mean something.
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("form select")).toHaveCount(0);
    await expect(page.getByLabel(/company/i)).toHaveCount(0);
  });

  await step(page, "A wrong password and an unknown email produce the same message", async () => {
    const attempt = async (email: string) => {
      await page.locator("#email").fill(email);
      const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Sign in" }).click();
      const res = await response;
      await expect(formAlert(page)).toHaveText("Invalid email or password.");
      return { status: res.status(), body: await res.json() };
    };
    await page.locator("#password").fill("WrongPass123");
    const wrongPassword = await attempt(NIMBUS.divya);
    const unknownEmail = await attempt("nobody@nimbustech.io");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail).toEqual(wrongPassword); // identical status and body: nothing to enumerate
  });

  await step(page, "Signing in routes the user to their own company automatically", async () => {
    await page.locator("#email").fill(NIMBUS.divya);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator("aside").getByText(NIMBUS.name)).toBeVisible(); // the sidebar carries their own name
  });

  await step(page, "Session tokens are HttpOnly: JavaScript cannot read them", async () => {
    const cookies = await page.evaluate(() => document.cookie);
    expect(cookies).not.toContain("hrms_access");
    expect(cookies).toContain("hrms_csrf");
    // The refresh cookie is scoped to /api/v1/auth, so document.cookie can't show it either
    // way: check the flags themselves.
    const jar = await page.context().cookies();
    const flag = (name: string) => jar.find((c) => c.name === name)?.httpOnly;
    expect(flag("hrms_access")).toBe(true);
    expect(flag("hrms_refresh")).toBe(true);
    expect(flag("hrms_csrf")).toBe(false); // read by the app for the double-submit header
  });

  await step(page, "A forged request without the CSRF header is rejected", async () => {
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: "x", new_password: "Hijack12345" }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("CSRF_FAILED");
  });
});

test("Forgot password: emailed code, single-use reset, no account enumeration", async ({ page }) => {
  await step(page, "Nikhil requests a reset code", async () => {
    await page.goto("/forgot-password");
    await page.locator("#email").fill(NIMBUS.nikhil);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForURL(/\/verify-otp/);
  });

  const code = await lastDevEmail(NIMBUS.nikhil, "code");

  await step(page, "A wrong code is refused", async () => {
    const wrong = code === "000000" ? "111111" : "000000";
    for (const [i, d] of wrong.split("").entries()) await page.getByLabel(`Digit ${i + 1}`).fill(d);
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(formAlert(page)).toContainText("Invalid or expired code");
  });

  await step(page, "The emailed code unlocks a one-time reset", async () => {
    for (const [i, d] of code.split("").entries()) await page.getByLabel(`Digit ${i + 1}`).fill(d);
    await page.getByRole("button", { name: "Verify code" }).click();
    await page.waitForURL(/\/reset-password/);
    await page.locator("#password").fill(NIKHIL_NEW_PASSWORD);
    await page.locator("#confirm").fill(NIKHIL_NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(/\/login\?reset=1/);
    await expect(page.getByText("Password updated.")).toBeVisible();
  });

  await step(page, "The old password stops working; the new one signs in", async () => {
    await page.locator("#email").fill(NIMBUS.nikhil);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(page)).toHaveText("Invalid email or password.");
    await login(page, NIMBUS.nikhil, NIKHIL_NEW_PASSWORD);
  });

  await step(page, "Requesting a code for an unknown email looks identical", async () => {
    const known = await api(page, "POST", "/auth/forgot-password", { email: NIMBUS.isha });
    const unknown = await api(page, "POST", "/auth/forgot-password", { email: "ghost@nimbustech.io" });
    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);
  });
});

test("Two-factor sign-in and remote session sign-out", async ({ page, browser }, testInfo) => {
  let secret = "";
  let enableCode = "";
  let mfaOn = false;
  try {
    await step(page, "Tara turns on two-factor authentication", async () => {
      await login(page, NIMBUS.sales);
      await page.goto("/account");
      await page.getByRole("tab", { name: "Security" }).click();
      await page.getByRole("button", { name: "Set up two-factor" }).click();
      secret = (await page.locator("code").first().innerText()).trim();
      enableCode = await totp(secret);
      await page.getByLabel("Verification code").fill(enableCode);
      await page.getByRole("button", { name: "Enable" }).click();
      await toast(page, "Two-factor authentication is on");
      mfaOn = true;
    });

    const laptop = await openAs(browser, testInfo, "Tara's second device");
    await step(laptop.page, "Signing in elsewhere asks for the code, and an already-used code is refused", async () => {
      await laptop.page.goto("/login");
      await laptop.page.locator("#email").fill(NIMBUS.sales);
      await laptop.page.locator("#password").fill(PASSWORD);
      await laptop.page.getByRole("button", { name: "Sign in" }).click();
      await expect(laptop.page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
      await laptop.page.locator("#code").fill(enableCode); // replaying the code that switched MFA on
      await laptop.page.getByRole("button", { name: "Verify and continue" }).click();
      await expect(formAlert(laptop.page)).toContainText("Invalid verification code");
      await laptop.page.locator("#code").fill(await totp(secret)); // the authenticator's next code
      await laptop.page.getByRole("button", { name: "Verify and continue" }).click();
      await laptop.page.waitForURL(/\/dashboard/);
    });

    await step(page, "Tara signs her other devices out from her account page", async () => {
      await page.goto("/account");
      await page.getByRole("tab", { name: "Security" }).click();
      const buttons = page.getByRole("listitem").getByRole("button", { name: "Sign out" });
      await expect(buttons.first()).toBeVisible();
      for (let remaining = await buttons.count(); remaining > 0; remaining--) {
        await buttons.first().click();
        await expect(buttons).toHaveCount(remaining - 1);
      }
      await expect(page.getByText("This device")).toBeVisible();
    });

    await step(laptop.page, "The revoked device is sent back to sign-in on its next action", async () => {
      await laptop.page.getByRole("link", { name: "Leave" }).click();
      await laptop.page.waitForURL(/\/login\?expired=1/);
      await expect(laptop.page.getByText("Your session ended")).toBeVisible();
    });
    await laptop.close();

    await step(page, "Tara turns two-factor off again (password + current code)", async () => {
      await page.getByRole("button", { name: "Turn off" }).click();
      const dialog = page.getByRole("dialog", { name: "Turn off two-factor?" });
      await dialog.getByLabel("Password").fill(PASSWORD);
      await dialog.getByLabel("Current code").fill(await totp(secret));
      await dialog.getByRole("button", { name: "Turn off" }).click();
      await toast(page, "Two-factor authentication is off");
      mfaOn = false;
    });
  } finally {
    // Never leave Tara behind two-factor for the specs that follow, even if a step above failed.
    if (mfaOn) await api(page, "POST", "/auth/mfa/disable", { password: PASSWORD, code: await totp(secret) });
  }
});
