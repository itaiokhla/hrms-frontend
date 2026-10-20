import { cameraReady, sidebarLinks, step, toast } from "../e2e/support/fixtures";

import { actor, API_ORIGIN, call, db, evidence, expect, periodic, PLACES, runSweep, samples, secrets, shot, test } from "./support";

/**
 * Alpha Logistics: face + required location at punches, lunch, and best-effort
 * periodic checks through route changes, a second website, a frozen tab,
 * same-tab navigation away and two HRMS tabs, ending with punch-out.
 *
 * Positions come from Chrome's geolocation emulation (synthetic): this verifies
 * the software path, not real GPS accuracy.
 */
test("Alpha: a full day with face, location, lunch and honest tracking gaps", async ({ browser }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const s = secrets();
  const A = s.companies.alpha;

  /* ------------------------------------------------------------- policy */
  const admin = await actor(browser, testInfo, "Alpha admin", A.emails.admin);
  const policyPanel = admin.page.getByTestId("attendance-policy");
  await step(admin.page, "Alpha's admin sees Alpha's own attendance policy: 120-minute checks, location required at punches", async () => {
    await admin.page.goto("/settings");
    await admin.page.getByRole("tab", { name: "Attendance & location" }).click();
    await expect(policyPanel.getByLabel("Every (minutes)")).toHaveValue("120");
    await expect(policyPanel.getByLabel("Punch in and punch out")).toHaveValue("REQUIRED");
    await expect(policyPanel.getByLabel("Lunch start and end")).toHaveValue("OPTIONAL");
    await shot(admin, testInfo, "policy 120 min");
  });
  await step(admin.page, "Admin applies the accelerated TEST-ONLY schedule: every 2 minutes, missed after 1 minute", async () => {
    await policyPanel.getByLabel("Every (minutes)").fill("2");
    await policyPanel.getByLabel("Late after (minutes)").fill("1");
    await policyPanel.getByRole("button", { name: "Save attendance policy" }).click();
    await toast(admin.page, /Attendance policy saved/);
    const policy = await call(admin.page, "GET", "/attendance/policy");
    expect(policy.data.settings.trackingIntervalMinutes).toBe(2);
    expect(policy.data.settings.trackingGraceMinutes).toBe(1);
  });

  /* ------------------------------------------------------------- punch in */
  const esha = await actor(browser, testInfo, "Esha (Alpha employee)", A.emails.e1, { geolocation: PLACES.alphaOffice });
  const card = esha.page.getByTestId("attendance-card");
  await step(esha.page, "Esha's menu offers only self-service pages", async () => {
    const links = await sidebarLinks(esha.page);
    expect(links).toContain("Attendance");
    for (const hidden of ["Payroll", "Users", "Company settings", "Employees", "Reports", "Face kiosk"]) expect(links).not.toContain(hidden);
  });
  await step(esha.page, "Punch in: server face check, a fresh location fix and the location notice", async () => {
    await esha.page.goto("/attendance");
    await expect(card).toHaveAttribute("data-state", "NOT_PUNCHED_IN");
    await expect(card.getByRole("button")).toHaveText(["Punch in"]); // only the valid action is offered
    await card.getByRole("button", { name: "Punch in" }).click();
    const dialog = esha.page.getByRole("dialog", { name: "Verify it's you" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await expect(dialog.getByText("Location found (±20 m).")).toBeVisible();
    const submit = dialog.getByRole("button", { name: /Capture & punch in/ });
    await expect(submit).toBeDisabled(); // the notice must be acknowledged first
    await dialog.getByLabel("I understand").check();
    await cameraReady(esha.page);
    await shot(esha, testInfo, "punch-in dialog");
    await submit.click();
    await toast(esha.page, "Punched in. Have a great day!");
    await expect(card).toHaveAttribute("data-state", "WORKING");
    await expect(esha.page.getByTestId("tracking-indicator")).toHaveAttribute("data-state", "ACTIVE");
    await expect(card.getByRole("button")).toHaveText(["Start lunch", "Punch out"]);
  });
  const today = (await call(esha.page, "GET", "/attendance/me/today")).data;
  const sessionId: number = today.record.id;
  await step(esha.page, "Database: one PUNCH_IN event with server time, the exact emulated coordinates, owned by Alpha and Esha", async () => {
    const events = db("events", { id: sessionId });
    expect(events.map((e) => [e.event_type, e.location_status, e.source])).toEqual([["PUNCH_IN", "CAPTURED", "self"]]);
    const [punch] = samples(sessionId);
    expect(punch).toMatchObject({ sample_type: "PUNCH_IN", status: "CAPTURED", latitude: 12.9352, longitude: 77.6245, accuracy_m: 20,
      accuracy_class: "PREFERRED", movement_status: "BASELINE", company_id: A.company_id, employee_id: A.ids.e1 });
    const [session] = db("session", { id: sessionId });
    expect(session).toMatchObject({ tracking_state: "ACTIVE", tracking_interval_minutes: 2, company_id: A.company_id });
    expect(today.record.face_match_score).toBeGreaterThan(0.4); // the real face engine matched the camera to the enrolment
    await evidence(testInfo, "punch-in rows", { events, samples: samples(sessionId), session });
  });

  /* ------------------------------------------------------------- lunch */
  await step(esha.page, "Start lunch: optional location, checks pause, net time stops while lunch time runs", async () => {
    await card.getByRole("button", { name: "Start lunch" }).click();
    const dialog = esha.page.getByRole("dialog", { name: "Start lunch" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await dialog.getByRole("button", { name: "Start lunch" }).click();
    await toast(esha.page, "Lunch started. Enjoy your break!");
    await expect(card).toHaveAttribute("data-state", "ON_LUNCH");
    await expect(esha.page.getByTestId("tracking-indicator")).toHaveAttribute("data-state", "PAUSED");
    const net1 = await esha.page.getByTestId("counter-net").innerText();
    const lunch1 = await esha.page.getByTestId("counter-lunch").innerText();
    await esha.page.waitForTimeout(3_000);
    expect(await esha.page.getByTestId("counter-net").innerText()).toBe(net1);
    expect(await esha.page.getByTestId("counter-lunch").innerText()).not.toBe(lunch1);
    await shot(esha, testInfo, "on lunch");
  });
  await esha.page.waitForTimeout(20_000);
  await step(esha.page, "End lunch: back to WORKING, the next check is due one interval after lunch ends", async () => {
    await card.getByRole("button", { name: "End lunch" }).click();
    const dialog = esha.page.getByRole("dialog", { name: "End lunch" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await dialog.getByRole("button", { name: "End lunch" }).click();
    await toast(esha.page, "Lunch ended. Welcome back!");
    await expect(card).toHaveAttribute("data-state", "WORKING");
    const [lunch] = db<{ started_at: string; ended_at: string; end_reason: string }>("breaks", { id: sessionId });
    expect(lunch.end_reason).toBe("LUNCH_OUT");
    const [session] = db<{ tracking_next_due_at: string }>("session", { id: sessionId });
    expect(Date.parse(session.tracking_next_due_at) - Date.parse(lunch.ended_at)).toBe(2 * 60_000);
  });

  /* ------------------------------------------------------------- route changes */
  await step(esha.page, "Esha moves around HRMS while the check comes due: one controller survives route changes", async () => {
    const nav = esha.page.getByRole("navigation", { name: "Main" });
    for (const label of ["Dashboard", "Leave", "Holidays", "Dashboard"]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(esha.page.getByTestId("tracking-indicator")).toBeVisible();
      await esha.page.waitForTimeout(15_000);
    }
    await expect.poll(() => periodic(sessionId).length, { timeout: 4 * 60_000, intervals: [5_000] }).toBe(1);
    expect(samples(sessionId).filter((x) => x.sample_type === "PERIODIC")).toHaveLength(1); // no duplicate attempts
    await shot(esha, testInfo, "dashboard while tracking");
  });

  /* ------------------------------------------------------------- second website */
  let otherState: unknown;
  await step(esha.page, "Esha's location moves ~5 km and she opens another website in a second tab, HRMS still open", async () => {
    await esha.gps.move(PLACES.alphaFar);
    await (await esha.cdp()).send("Emulation.setFocusEmulationEnabled", { enabled: false });
    const popup = esha.context.waitForEvent("page");
    await esha.page.evaluate((url) => window.open(url, "_blank"), `${API_ORIGIN}/health`);
    const other = await popup;
    await other.waitForLoadState();
    await other.bringToFront();
    otherState = await esha.page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
    await evidence(testInfo, "HRMS tab state while another site is in front", otherState);
    await expect.poll(() => periodic(sessionId).length, { timeout: 4 * 60_000, intervals: [5_000] }).toBe(2);
    const latest = periodic(sessionId).at(-1)!;
    expect(latest).toMatchObject({ latitude: 12.98, movement_status: "SIGNIFICANT_MOVEMENT_REVIEW", review_status: "PENDING" });
    await esha.page.bringToFront();
    await other.close();
  });

  /* ------------------------------------------------------------- suspended tab */
  // Chrome's Page Lifecycle freeze (CDP Page.setWebLifecycleState) does not suspend a page that
  // Playwright keeps visible (an earlier run kept capturing while "frozen"), so suspension is
  // simulated by halting the page's JavaScript in the DevTools debugger: no timer, no request.
  await step(esha.page, "The HRMS tab is suspended past a due check: the scheduled sweep records the slot as MISSED", async () => {
    await esha.gps.move(PLACES.alphaOffice);
    const cdp = await esha.cdp();
    const captured = periodic(sessionId).length;
    await cdp.send("Debugger.enable");
    await cdp.send("Debugger.pause"); // halts at the next statement (the live clock ticks every second)
    const [session] = db<{ tracking_next_due_at: string }>("session", { id: sessionId });
    const graceEnd = Date.parse(session.tracking_next_due_at) + 60_000;
    await admin.page.waitForTimeout(Math.max(0, graceEnd - Date.now()) + 15_000);
    const sweep = runSweep();
    await evidence(testInfo, "sweep while suspended", sweep);
    expect(periodic(sessionId, "MISSED").length).toBeGreaterThanOrEqual(1);
    expect(periodic(sessionId).length).toBe(captured); // nothing was captured while suspended...
    expect(db<{ n: number }>("fabricated")[0].n).toBe(0); // ...and nothing was invented
    await cdp.send("Debugger.resume");
    await cdp.send("Debugger.disable");
    await expect.poll(() => periodic(sessionId).length, { timeout: 90_000, intervals: [3_000] }).toBe(captured + 1);
    expect(periodic(sessionId).at(-1)!.is_recovery).toBe(true); // one current reading on resume, no back-fill
    await esha.page.goto("/attendance");
    await expect(esha.page.getByTestId("missed-count")).toContainText("missed");
    await shot(esha, testInfo, "after suspended tab recovery");
  });

  /* ------------------------------------------------------------- navigation away */
  await step(esha.page, "Same-tab navigation to another site ends tracking in that tab; the gap is recorded, then one reading on return", async () => {
    const before = { captured: periodic(sessionId).length, missed: periodic(sessionId, "MISSED").length };
    await esha.page.goto(`${API_ORIGIN}/health`);
    const [session] = db<{ tracking_next_due_at: string }>("session", { id: sessionId });
    await admin.page.waitForTimeout(Math.max(0, Date.parse(session.tracking_next_due_at) + 60_000 - Date.now()) + 15_000);
    runSweep();
    expect(periodic(sessionId).length).toBe(before.captured);
    expect(periodic(sessionId, "MISSED").length).toBeGreaterThan(before.missed);
    await esha.page.goto("/attendance");
    await expect.poll(() => periodic(sessionId).length, { timeout: 90_000, intervals: [3_000] }).toBe(before.captured + 1);
    expect(periodic(sessionId).at(-1)!.is_recovery).toBe(true);
  });

  /* ------------------------------------------------------------- two tabs */
  await step(esha.page, "Two HRMS tabs open: exactly one reading per scheduled check", async () => {
    const second = await esha.context.newPage();
    await second.goto("/dashboard");
    const before = periodic(sessionId).length;
    const [session] = db<{ tracking_next_due_at: string }>("session", { id: sessionId });
    await admin.page.waitForTimeout(Math.max(0, Date.parse(session.tracking_next_due_at) - Date.now()) + 45_000);
    await expect.poll(() => periodic(sessionId).length, { timeout: 60_000, intervals: [3_000] }).toBe(before + 1);
    await admin.page.waitForTimeout(20_000);
    expect(periodic(sessionId).length).toBe(before + 1);
    const slots = periodic(sessionId).map((x) => x.slot_due_at);
    expect(new Set(slots).size).toBe(slots.length);
    await second.close();
  });

  /* ------------------------------------------------------------- manager */
  const manoj = await actor(browser, testInfo, "Manoj (Manager A1)", A.emails.m1);
  await step(manoj.page, "Manager A1 sees his reporting tree only, then reviews Esha's movement flag on her readings", async () => {
    await manoj.page.goto("/attendance");
    await manoj.page.getByRole("tab", { name: "Team" }).click();
    await manoj.page.getByLabel("From", { exact: true }).fill(s.history_day); // include the HR-recorded day for every Alpha employee
    await expect(manoj.page.getByRole("row", { name: /Esha Alpha-Emp1/ }).first()).toBeVisible();
    await expect(manoj.page.getByRole("row", { name: /Ezra Alpha-Emp4/ })).toBeVisible(); // nested team: in his tree
    await expect(manoj.page.getByRole("row", { name: /Emil Alpha-Emp3/ })).toHaveCount(0); // sibling manager's team
    const review = manoj.page.getByTestId("location-review");
    await expect(review).toContainText("Esha Alpha-Emp1");
    await review.getByRole("button", { name: "Open shift" }).first().click();
    const drawer = manoj.page.getByTestId("session-detail");
    await expect(drawer.getByTestId("samples-table")).toBeVisible();
    await expect(drawer.getByRole("img", { name: /observed location readings/ })).toBeVisible();
    await shot(manoj, testInfo, "manager sees readings (points only)");
    await manoj.page.keyboard.press("Escape");
    await review.getByRole("button", { name: "Reviewed" }).first().click();
    await toast(manoj.page, "Marked as reviewed");
  });

  /* ------------------------------------------------------------- punch out */
  await step(esha.page, "Punch out: face + final location; collection stops", async () => {
    await esha.page.goto("/attendance");
    await card.getByRole("button", { name: "Punch out" }).click();
    const dialog = esha.page.getByRole("dialog", { name: "Verify it's you" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await cameraReady(esha.page);
    await dialog.getByRole("button", { name: /Capture & punch out/ }).click();
    await toast(esha.page, "Punched out. See you tomorrow!");
    await expect(card).toHaveAttribute("data-state", "PUNCHED_OUT");
    await expect(esha.page.getByTestId("tracking-indicator")).toHaveCount(0);
    const [session] = db("session", { id: sessionId });
    expect(session).toMatchObject({ tracking_state: "STOPPED", tracking_stop_reason: "PUNCHED_OUT" });
    expect(db("events", { id: sessionId }).map((e) => e.event_type)).toEqual(["PUNCH_IN", "LUNCH_IN", "LUNCH_OUT", "PUNCH_OUT"]);
    await evidence(testInfo, "final session rows", { session, events: db("events", { id: sessionId }), samples: samples(sessionId) });
    await shot(esha, testInfo, "day complete");
  });
  await step(esha.page, "After punch-out nothing more is collected, and a late upload is refused", async () => {
    const count = samples(sessionId).length;
    await esha.page.waitForTimeout(3.2 * 60_000);
    runSweep();
    expect(samples(sessionId).length).toBe(count);
    const late = await call(esha.page, "POST", "/attendance/me/location-samples", {
      idempotency_key: "late-upload-after-punch-out", attendance_id: sessionId, client_sent_at: new Date().toISOString(),
      location: { status: "CAPTURED", latitude: 12.9352, longitude: 77.6245, accuracy_m: 20, captured_at: new Date().toISOString(), attempts: 1 },
    });
    expect(late.status).toBe(409);
    expect(late.data.code).toBe("SESSION_NOT_ACTIVE");
  });

  /* ------------------------------------------------------------- hours example */
  await step(esha.page, "The HR-recorded day reads 9h gross, 45m lunch, 8h 15m net in the UI, the API and the database", async () => {
    const label = new Date(`${s.history_day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(/^(\w+) /, "$1, ");
    const row = esha.page.getByRole("row", { name: new RegExp(label) });
    await expect(row).toContainText("0h 45m");
    await expect(row).toContainText("8h 15m");
    await row.click();
    const drawer = esha.page.getByTestId("session-detail");
    await expect(drawer.getByTestId("detail-total")).toHaveText("9h 00m");
    await expect(drawer.getByTestId("detail-lunch")).toHaveText("0h 45m");
    await expect(drawer.getByTestId("detail-worked")).toHaveText("8h 15m");
    const history = await call(esha.page, "GET", `/attendance/me/history?start_date=${s.history_day}&end_date=${s.history_day}`);
    expect(history.data.items[0].hours).toMatchObject({ gross_seconds: 32400, lunch_seconds: 2700, net_seconds: 29700 });
    await shot(esha, testInfo, "9h-45m-8h15m");
  });

  await evidence(testInfo, "summary", { otherWebsiteTabState: otherState, samples: samples(sessionId) });
  for (const a of [manoj, esha, admin]) await a.close();
});
