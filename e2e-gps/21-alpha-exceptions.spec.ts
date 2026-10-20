import { cameraReady, step, toast } from "../e2e/support/fixtures";

import { actor, call, db, evidence, expect, PLACES, samples, secrets, setLocationPermission, shot, test } from "./support";

/**
 * Alpha Logistics, the unhappy paths: a browser that blocks location, an
 * approximate laptop fix, a dropped connection and a role revoked mid-shift.
 */
test("Alpha: blocked location needs a reviewed exception; approximate fixes, offline retries and revocation are handled honestly", async ({ browser }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const s = secrets();
  const A = s.companies.alpha;

  const eli = await actor(browser, testInfo, "Eli (Alpha employee)", A.emails.e2, { geolocation: PLACES.alphaOffice });
  const card = eli.page.getByTestId("attendance-card");
  await step(eli.page, "Eli's Chrome blocks location for HRMS: the page says so plainly", async () => {
    await eli.page.goto("/attendance");
    await setLocationPermission(browser, eli, "denied");
    await eli.page.reload();
    await expect(eli.page.getByRole("alert").filter({ hasText: "Location is blocked for this site" })).toBeVisible();
  });

  await step(eli.page, "Punch-in is refused without a location, and allowed only with a written reason for review", async () => {
    await card.getByRole("button", { name: "Punch in" }).click();
    const dialog = eli.page.getByRole("dialog", { name: "Verify it's you" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "PERMISSION_DENIED");
    await expect(dialog.getByText(/Location permission is blocked/)).toBeVisible();
    await dialog.getByLabel("I understand").check();
    const submit = dialog.getByRole("button", { name: /Capture & punch in/ });
    await expect(submit).toBeDisabled(); // face match alone never replaces a required location
    await dialog.getByLabel(/Continue without a usable location/).check();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Phone location is broken; IT ticket 4411");
    await cameraReady(eli.page);
    await shot(eli, testInfo, "exception requested");
    await submit.click();
    await toast(eli.page, "Punched in. Have a great day!");
    await expect(card).toHaveAttribute("data-state", "WORKING");
  });
  const sessionId: number = (await call(eli.page, "GET", "/attendance/me/today")).data.record.id;
  await step(eli.page, "Database: the punch is recorded as a location EXCEPTION, with no position invented", async () => {
    expect(db("events", { id: sessionId }).map((e) => [e.event_type, e.location_status])).toEqual([["PUNCH_IN", "EXCEPTION"]]);
    expect(samples(sessionId)).toEqual([expect.objectContaining({
      sample_type: "PUNCH_IN", status: "PERMISSION_DENIED", latitude: null, longitude: null,
      exception_reason: "Phone location is broken; IT ticket 4411", review_status: "PENDING",
    })]);
  });

  const manoj = await actor(browser, testInfo, "Manoj (Manager A1)", A.emails.m1);
  await step(manoj.page, "Manager A1 opens Eli's shift and approves the exception", async () => {
    await manoj.page.goto("/attendance");
    await manoj.page.getByRole("tab", { name: "Team" }).click();
    const review = manoj.page.getByTestId("location-review");
    const item = review.getByRole("listitem").filter({ hasText: "Eli Alpha-Emp2" });
    await expect(item).toContainText("IT ticket 4411");
    await item.getByRole("button", { name: "Open shift" }).click();
    await expect(manoj.page.getByTestId("session-detail")).toContainText("Location exception");
    await manoj.page.keyboard.press("Escape");
    await item.getByRole("button", { name: "Approve" }).click();
    await toast(manoj.page, "Exception approved");
    expect(samples(sessionId)[0].review_status).toBe("APPROVED");
  });

  await step(eli.page, "Location allowed again, but the laptop only knows its position to about ±3 km", async () => {
    await setLocationPermission(browser, eli, "granted");
    await eli.gps.move(PLACES.alphaWifiGuess);
    await card.getByRole("button", { name: "Start lunch" }).click();
    const dialog = eli.page.getByRole("dialog", { name: "Start lunch" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await expect(dialog.getByText(/approximate \(about ±3000 m\)/)).toBeVisible();
    await dialog.getByRole("button", { name: "Start lunch" }).click();
    await toast(eli.page, "Lunch started. Enjoy your break!");
    const lunchSample = samples(sessionId).find((x) => x.sample_type === "LUNCH_IN")!;
    expect(lunchSample).toMatchObject({ status: "CAPTURED", accuracy_m: 3000, accuracy_class: "LOW" });
  });

  await step(eli.page, "Offline: ending lunch fails without being recorded, then succeeds exactly once on retry", async () => {
    await eli.gps.move(PLACES.alphaOffice);
    await card.getByRole("button", { name: "End lunch" }).click();
    const dialog = eli.page.getByRole("dialog", { name: "End lunch" });
    await expect(dialog.getByTestId("dialog-location")).toHaveAttribute("data-status", "CAPTURED");
    await eli.setOffline(true);
    await dialog.getByRole("button", { name: "End lunch" }).click();
    await expect(dialog.getByRole("alert")).toContainText("You're offline");
    expect(db("events", { id: sessionId }).map((e) => e.event_type)).toEqual(["PUNCH_IN", "LUNCH_IN"]);
    await shot(eli, testInfo, "offline retry message");
    await eli.setOffline(false);
    await dialog.getByRole("button", { name: "End lunch" }).click();
    await toast(eli.page, "Lunch ended. Welcome back!");
    expect(db("events", { id: sessionId }).map((e) => e.event_type)).toEqual(["PUNCH_IN", "LUNCH_IN", "LUNCH_OUT"]);
  });

  const admin = await actor(browser, testInfo, "Alpha admin", A.emails.admin);
  await step(admin.page, "The admin replaces Eli's Employee role with Auditor mid-shift", async () => {
    await admin.page.goto("/users");
    await admin.page.getByPlaceholder("Search name or email").fill("Eli");
    await admin.page.locator("tbody tr").filter({ hasText: A.emails.e2 }).click();
    const drawer = admin.page.getByRole("dialog");
    await drawer.getByLabel(/^Employee/).uncheck();
    await drawer.getByLabel(/^Auditor/).check();
    await drawer.getByRole("button", { name: "Save roles" }).click();
    await toast(admin.page, /Roles updated/);
    expect(db("session", { id: sessionId })[0]).toMatchObject({ tracking_state: "STOPPED", tracking_stop_reason: "PERMISSION_REVOKED" });
  });

  await step(eli.page, "Eli's open tab stops collecting; uploads are refused and her menu changes", async () => {
    const upload = await call(eli.page, "POST", "/attendance/me/location-samples", {
      idempotency_key: "after-role-revocation", attendance_id: sessionId, client_sent_at: new Date().toISOString(),
      location: { status: "CAPTURED", latitude: 12.9352, longitude: 77.6245, accuracy_m: 20, captured_at: new Date().toISOString(), attempts: 1 },
    });
    expect(upload.status).toBe(403);
    await eli.page.reload();
    await expect(eli.page.getByTestId("tracking-indicator")).toHaveCount(0);
    await expect(eli.page.getByRole("button", { name: "Punch out" })).toHaveCount(0); // no self-service attendance any more
    await shot(eli, testInfo, "after role change");
  });

  const hana = await actor(browser, testInfo, "Hana (Alpha HR)", A.emails.hr);
  await step(hana.page, "HR's attendance report shows the canonical lunch and net hours", async () => {
    await hana.page.goto("/reports");
    await hana.page.getByLabel("From", { exact: true }).fill(s.history_day);
    await hana.page.getByLabel("To", { exact: true }).fill(s.history_day);
    // The table may still show the previous range while it refetches, so match the date as well.
    const day = new Date(`${s.history_day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    for (const name of ["Esha Alpha-Emp1", "Eli Alpha-Emp2"]) {
      const row = hana.page.getByRole("row", { name: new RegExp(`${name} ${day}`) });
      await expect(row).toContainText("0h 45m");
      await expect(row).toContainText("8h 15m");
    }
    const report = await call(hana.page, "GET", `/reports/attendance?start_date=${s.history_day}&end_date=${s.history_day}`);
    const sum = report.data.records.reduce((total: number, r: { net_seconds: number }) => total + r.net_seconds, 0);
    expect(report.data.summary.total_net_seconds).toBe(sum);
    await evidence(testInfo, "HR report summary", report.data.summary);
    const download = hana.page.waitForEvent("download");
    await hana.page.getByRole("button", { name: "Excel" }).click();
    expect((await download).suggestedFilename()).toMatch(/^attendance_.*\.xlsx$/);
  });

  await step(admin.page, "The audit log records who viewed and reviewed location data", async () => {
    await admin.page.goto("/audit-logs");
    await admin.page.getByLabel("Module").selectOption("Location");
    await expect(admin.page.getByText(/Viewed location readings of Eli Alpha-Emp2/).first()).toBeVisible();
    await expect(admin.page.getByText(/Approved location exception of Eli Alpha-Emp2/).first()).toBeVisible();
    await shot(admin, testInfo, "location audit trail");
  });

  for (const a of [hana, admin, manoj, eli]) await a.close();
});
