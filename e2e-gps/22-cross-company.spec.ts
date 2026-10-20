import { formAlert, step, toast } from "../e2e/support/fixtures";

import { actor, call, db, evidence, expect, PLACES, samples, secrets, shot, test } from "./support";

/**
 * Beta Retail and Gamma Health run on their own policies, and no company,
 * manager or employee can reach attendance or location data it is not entitled to.
 */
test("Beta and Gamma follow their own policies; cross-company and cross-team access is denied without leaks", async ({ browser }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const s = secrets();
  const { alpha: A, beta: B, gamma: G } = s.companies;

  // Real Alpha record ids, looked up the legitimate way (as Alpha's own administrator).
  const alphaAdmin = await actor(browser, testInfo, "Alpha admin (ids)", A.emails.admin);
  const alphaRows = (await call(alphaAdmin.page, "GET", `/attendance?start_date=${s.history_day}&end_date=${s.history_day}`)).data.items as
    { id: number; employee_name: string }[];
  const alphaId = (first: string) => alphaRows.find((r) => r.employee_name.startsWith(first))!.id;
  const alphaSample = db<{ id: number }>("company_sample_ids", { company_id: A.company_id })[0]?.id;
  expect(alphaSample, "Alpha location samples from the earlier journeys").toBeDefined();

  /* ------------------------------------------------------------- Beta */
  const betaAdmin = await actor(browser, testInfo, "Beta admin", B.emails.admin);
  await step(betaAdmin.page, "Beta's settings: optional location, checks every 60 minutes", async () => {
    await betaAdmin.page.goto("/settings");
    await betaAdmin.page.getByRole("tab", { name: "Attendance & location" }).click();
    const panel = betaAdmin.page.getByTestId("attendance-policy");
    await expect(panel.getByLabel("Every (minutes)")).toHaveValue("60");
    await expect(panel.getByLabel("Punch in and punch out")).toHaveValue("OPTIONAL");
    await shot(betaAdmin, testInfo, "beta policy");
  });

  const bela = await actor(browser, testInfo, "Bela (Beta employee)", B.emails.e1, { geolocation: PLACES.betaStore });
  const card = bela.page.getByTestId("attendance-card");
  await step(bela.page, "Bela punches in using only the keyboard; Beta needs no face, the location is optional", async () => {
    await bela.page.goto("/attendance");
    const punch = card.getByRole("button", { name: "Punch in" });
    await punch.focus();
    await bela.page.keyboard.press("Enter");
    const dialog = bela.page.getByRole("dialog", { name: "Punch in" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await expect(dialog.getByText("Location (optional)")).toBeVisible();
    await dialog.getByLabel("I understand").focus();
    await bela.page.keyboard.press("Space");
    await dialog.getByRole("button", { name: "Punch in" }).focus();
    await bela.page.keyboard.press("Enter");
    await toast(bela.page, "Punched in. Have a great day!");
    await expect(card).toHaveAttribute("data-state", "WORKING");
  });
  const belaSession: number = (await call(bela.page, "GET", "/attendance/me/today")).data.record.id;
  await step(betaAdmin.page, "Beta's admin changes the interval mid-shift; Bela's running shift follows it immediately", async () => {
    expect(db("session", { id: belaSession })[0]).toMatchObject({ tracking_interval_minutes: 60, company_id: B.company_id });
    const panel = betaAdmin.page.getByTestId("attendance-policy");
    await panel.getByLabel("Every (minutes)").fill("30");
    await panel.getByRole("button", { name: "Save attendance policy" }).click();
    await toast(betaAdmin.page, /Attendance policy saved/);
    expect(db("session", { id: belaSession })[0]).toMatchObject({ tracking_interval_minutes: 30 });
    await bela.page.reload();
    await expect(bela.page.getByTestId("tracking-headline")).toContainText("Next location check");
    const status = await call(bela.page, "GET", "/attendance/me/tracking");
    expect(status.data.interval_minutes).toBe(30);
  });
  await step(bela.page, "A Beta employee cannot upload into Alpha's shift, whatever id she sends", async () => {
    const foreign = await call(bela.page, "POST", "/attendance/me/location-samples", {
      idempotency_key: "beta-into-alpha", attendance_id: alphaId("Esha"), client_sent_at: new Date().toISOString(),
      location: { status: "CAPTURED", latitude: 19.076, longitude: 72.8777, accuracy_m: 15, captured_at: new Date().toISOString(), attempts: 1 },
    });
    expect(foreign.status).toBe(409);
    expect(foreign.data.code).toBe("SESSION_NOT_ACTIVE");
    const forged = await call(bela.page, "POST", "/attendance/me/location-samples", {
      idempotency_key: "forged-owner-fields", attendance_id: belaSession, company_id: A.company_id, employee_id: A.ids.e1,
      client_sent_at: new Date().toISOString(),
      location: { status: "CAPTURED", latitude: 19.076, longitude: 72.8777, accuracy_m: 15, captured_at: new Date().toISOString(), attempts: 1 },
    });
    expect(forged.status).toBe(422);
  });

  /* ------------------------------------------------------------- cross-company probes */
  await step(betaAdmin.page, "Beta's admin probes Alpha's records by id and by deep link: denied, nothing revealed", async () => {
    const probes: [string, string, unknown?][] = [
      ["GET", `/attendance/sessions/${alphaId("Esha")}?include_locations=true`],
      ["GET", `/attendance/statistics?employee_id=${A.ids.e1}&month=10&year=2026`],
      ["POST", "/attendance/manual", { employee_id: A.ids.e1, date: s.history_day, check_in_time: new Date().toISOString() }],
      ["POST", `/attendance/location-review/${alphaSample}`, { decision: "ACKNOWLEDGED" }],
      ["GET", `/employees/${A.ids.e1}`],
    ];
    const results = [];
    for (const [method, path, body] of probes) {
      const r = await call(betaAdmin.page, method, path, body);
      results.push({ method, path, status: r.status, body: r.data });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(JSON.stringify(r.data)).not.toContain("Alpha");
    }
    const hours = await call(betaAdmin.page, "GET", `/attendance/hours?start_date=${s.history_day}&end_date=${s.history_day}&employee_id=${A.ids.e1}`);
    expect(hours.data.employees).toEqual([]);
    const report = await call(betaAdmin.page, "GET", `/reports/attendance?start_date=${s.history_day}&end_date=${s.history_day}`);
    expect(report.data.records.every((r: { employee_name: string }) => r.employee_name.includes("Beta-"))).toBe(true);
    await evidence(testInfo, "Beta admin probes into Alpha", results);
    await betaAdmin.page.goto("/attendance");
    await betaAdmin.page.getByRole("tab", { name: "Team" }).click();
    await betaAdmin.page.getByLabel("From", { exact: true }).fill(s.history_day);
    await expect(betaAdmin.page.getByText("Alpha-Emp1")).toHaveCount(0);
    // Alpha's policy is untouched by Beta's change.
    expect((await call(alphaAdmin.page, "GET", "/attendance/policy")).data.settings.trackingIntervalMinutes).not.toBe(30);
  });

  const manoj = await actor(browser, testInfo, "Manoj (Manager A1)", A.emails.m1);
  await step(manoj.page, "Manager A1: his nested team is visible, location details only for direct reports, the sibling team not at all", async () => {
    const rows = await call(manoj.page, "GET", `/attendance?start_date=${s.history_day}&end_date=${s.history_day}`);
    const names = rows.data.items.map((r: { employee_name: string }) => r.employee_name);
    expect(names.some((n: string) => n.startsWith("Ezra"))).toBe(true);
    expect(names.some((n: string) => n.startsWith("Emil"))).toBe(false);
    const ezra = rows.data.items.find((r: { employee_name: string }) => r.employee_name.startsWith("Ezra"));
    const nested = await call(manoj.page, "GET", `/attendance/sessions/${ezra.id}?include_locations=true`);
    expect(nested.status).toBe(200);
    expect(nested.data.location_access).toBe(false);
    expect(nested.data.samples).toBeNull();
    const sibling = await call(manoj.page, "GET", `/attendance/sessions/${alphaId("Emil")}`);
    expect(sibling.status).toBe(404);
    await manoj.page.goto("/attendance");
    await manoj.page.getByRole("tab", { name: "Team" }).click();
    await manoj.page.getByLabel("From", { exact: true }).fill(s.history_day);
    await manoj.page.getByRole("row", { name: /Ezra Alpha-Emp4/ }).click();
    await expect(manoj.page.getByTestId("location-restricted")).toBeVisible();
    await shot(manoj, testInfo, "nested report: location restricted");
    for (const path of ["/payroll", "/reports/payroll?year=2026"]) {
      expect((await call(manoj.page, "GET", path)).status, path).toBe(403); // no payroll through attendance access
    }
  });

  const esha = await actor(browser, testInfo, "Esha (Alpha employee)", A.emails.e1);
  await step(esha.page, "An employee cannot open a colleague's shift or location", async () => {
    const r = await call(esha.page, "GET", `/attendance/sessions/${alphaId("Eli")}?include_locations=true`);
    expect(r.status).toBe(404);
    expect((await call(esha.page, "GET", "/attendance/location-review")).status).toBe(403);
  });

  /* ------------------------------------------------------------- Gamma */
  const gia = await actor(browser, testInfo, "Gia (Gamma employee, phone)", G.emails.e1, {
    geolocation: PLACES.gammaClinic, viewport: { width: 390, height: 844 }, isMobile: true,
  });
  await step(gia.page, "Gamma collects no location: one-tap punch-in on a phone, no location UI, nothing stored", async () => {
    await gia.page.goto("/attendance");
    const gCard = gia.page.getByTestId("attendance-card");
    await gCard.getByRole("button", { name: "Punch in" }).click();
    await toast(gia.page, "Punched in. Have a great day!");
    await expect(gCard).toHaveAttribute("data-state", "WORKING");
    await expect(gia.page.getByTestId("location-panel")).toHaveCount(0);
    await expect(gia.page.getByTestId("tracking-indicator")).toHaveCount(0);
    const overflow = await gia.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const giaSession = (await call(gia.page, "GET", "/attendance/me/today")).data.record.id;
    expect(samples(giaSession)).toEqual([]);
    expect(db<{ samples: number }>("company_samples", { company_id: G.company_id })[0].samples).toBe(0);
    await shot(gia, testInfo, "gamma phone");
  });
  await step(gia.page, "Gamma allows one paid lunch: the second lunch is not offered", async () => {
    const gCard = gia.page.getByTestId("attendance-card");
    await gCard.getByRole("button", { name: "Start lunch" }).click();
    await toast(gia.page, "Lunch started. Enjoy your break!");
    await gCard.getByRole("button", { name: "End lunch" }).click();
    await toast(gia.page, "Lunch ended. Welcome back!");
    await expect(gCard.getByRole("button")).toHaveText(["Punch out"]);
  });

  const suspended = await actor(browser, testInfo, "Gamma suspended user", null);
  await step(suspended.page, "A suspended Gamma account cannot sign in", async () => {
    await suspended.page.goto("/login");
    await suspended.page.locator("#email").fill(G.emails.suspended);
    await suspended.page.locator("#password").fill(s.password);
    await suspended.page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(suspended.page)).toBeVisible();
    await expect(suspended.page).toHaveURL(/\/login/);
  });

  await step(bela.page, "API responses are never cached by the browser", async () => {
    const response = await bela.page.request.get("/api/v1/attendance/me/today");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const page = await bela.page.request.get("/attendance");
    expect(page.headers()["permissions-policy"]).toContain("geolocation=(self)");
  });

  for (const a of [suspended, gia, esha, manoj, bela, betaAdmin, alphaAdmin]) await a.close();
});
