import path from "node:path";

import { FIXTURES, NIMBUS, SAFFRON, api, cameraReady, expect, inDays, login, openAs, openEmployee, step, test, toast } from "./support/fixtures";

test("Face enrolment, face-verified self check-in and the shared kiosk", async ({ page, browser }, testInfo) => {
  await login(page, NIMBUS.hr);

  await step(page, "Vikram (HR) enrols Divya's face from a clear photo", async () => {
    await openEmployee(page, "Divya Menon");
    const drawer = page.getByRole("dialog", { name: "Divya Menon" });
    await drawer.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "face-enrol.jpg"));
    await toast(page, "Face enrolled for attendance");
    await expect(drawer.getByText("Face enrolled").first()).toBeVisible();
  });

  await step(page, "A photo without a detectable face is rejected", async () => {
    await page.keyboard.press("Escape");
    await openEmployee(page, "Rahul Verma");
    await page.getByRole("dialog", { name: "Rahul Verma" }).locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "no-face.jpg"));
    await toast(page, /No face detected/);
  });

  const divya = await openAs(browser, testInfo, "Divya (webcam check-in)", NIMBUS.divya);
  await step(divya.page, "Divya checks in: Nimbus requires a face match, so the camera opens", async () => {
    await divya.page.goto("/attendance");
    await divya.page.getByRole("button", { name: "Check in" }).click();
    const camera = divya.page.getByRole("dialog", { name: "Verify it's you" });
    await cameraReady(divya.page);
    await camera.getByRole("button", { name: /Capture & check in/ }).click();
    await toast(divya.page, "Checked in. Have a great day!");
    await expect(divya.page.getByText(/Working since/)).toBeVisible();
  });

  const rahul = await openAs(browser, testInfo, "Rahul (not enrolled)", NIMBUS.rahul);
  await step(rahul.page, "Rahul tries the same face on his account: refused, his face isn't enrolled", async () => {
    await rahul.page.goto("/attendance");
    await rahul.page.getByRole("button", { name: "Check in" }).click();
    const camera = rahul.page.getByRole("dialog", { name: "Verify it's you" });
    await cameraReady(rahul.page);
    await camera.getByRole("button", { name: /Capture & check in/ }).click();
    await toast(rahul.page, "Your face is not enrolled yet. Ask HR to register it.");
  });
  await step(rahul.page, "Rahul cannot check in on Divya's behalf by sending her id either", async () => {
    const divyaId = (await api<{ employee: { id: number } }>(divya.page, "GET", "/auth/me")).data.employee.id;
    // The legacy endpoint that trusted a client-supplied employee id no longer exists...
    expect((await api(rahul.page, "POST", `/attendance/check-in?employee_id=${divyaId}`)).status).toBe(404);
    // ...and the self-service endpoint ignores any id: it is always Rahul, and his face is required.
    const own = await api<{ code: string }>(rahul.page, "POST", `/attendance/me/check-in?employee_id=${divyaId}`);
    expect(own.status).toBe(400);
    expect(own.data.code).toBe("FACE_REQUIRED");
  });
  await rahul.close();
  await divya.close();

  await step(page, "The shared kiosk recognises Divya (and asks her to wait before checking out)", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/kiosk");
    await cameraReady(page); // a scan before the first frame silently captures nothing
    await page.getByRole("button", { name: "Scan once" }).click();
    await expect(page.getByText("Divya Menon")).toBeVisible();
    // Within a minute of checking in the kiosk asks her to wait; after that it checks her out.
    await expect(page.getByText(/Please wait a minute before checking out.|Check-out successful/)).toBeVisible();
  });
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

test("Button check-in where a company doesn't require faces, and late marking by shift", async ({ page }) => {
  await login(page, SAFFRON.ramesh);
  await step(page, "Ramesh (Saffron, morning shift) checks in with one click", async () => {
    await page.goto("/attendance");
    await page.getByRole("button", { name: "Check in" }).click();
    await toast(page, "Checked in. Have a great day!");
  });
  await step(page, "His history shows today; arriving after 06:10 is marked late", async () => {
    const today = await api<{ state: string; record: { status: string; source: string; check_in_time: string } }>(
      page, "GET", "/attendance/me/today",
    );
    expect(today.data.state).toBe("working");
    expect(today.data.record.source).toBe("self");
    // Morning shift starts at 06:00 and Saffron allows 10 minutes' grace (Asia/Kolkata time).
    const istSeconds = (Math.floor(new Date(today.data.record.check_in_time).getTime() / 1000) + 19_800) % 86_400;
    const expected = istSeconds > 6 * 3600 + 10 * 60 ? "late" : "present";
    expect(today.data.record.status).toBe(expected);
    // Today's row in his history ("EEE, d MMM", as the app formats it) carries that status.
    const now = new Date();
    const label = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
    const todayRow = page.getByRole("row").filter({ hasText: label });
    await expect(todayRow).toHaveCount(1);
    await expect(todayRow).toContainText(expected === "late" ? "Late" : "Present");
  });
});

test("Team attendance boards and manual corrections respect scope", async ({ page }) => {
  await login(page, NIMBUS.admin);
  const ids = await api<{ items: { id: number; full_name: string }[] }>(page, "GET", "/employees?limit=200");
  const meeraId = ids.data.items.find((e) => e.full_name === "Meera Pillai")!.id;
  await page.context().clearCookies();
  await login(page, SAFFRON.supervisor);
  await step(page, "Lakshmi's team board shows Ramesh at work today", async () => {
    await page.goto("/attendance");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByRole("row", { name: /Ramesh Babu/ }).first()).toBeVisible();
  });

  await page.context().clearCookies();
  await login(page, NIMBUS.lead);
  await step(page, "Arjun records a missed check-in for Divya, his direct report", async () => {
    await page.goto("/attendance");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: "Record manually" }).click();
    const dialog = page.getByRole("dialog", { name: "Record attendance" });
    await dialog.getByLabel("Employee").click();
    await dialog.getByPlaceholder("Type a name, code or email").fill("Divya");
    await dialog.getByRole("option", { name: /Divya Menon/ }).click();
    await dialog.getByLabel("Date").fill(inDays(-1));
    await dialog.getByLabel("Notes").fill("Forgot to check in after the client visit");
    await dialog.getByRole("button", { name: "Save" }).click();
    await toast(page, "Attendance recorded");
  });

  await step(page, "Arjun cannot correct attendance for Meera (not his report) or for himself", async () => {
    const forMeera = await api(page, "POST", "/attendance/manual", {
      employee_id: meeraId, date: inDays(-1), check_in_time: new Date().toISOString(),
    });
    expect(forMeera.status).toBe(404);
    const me = await api<{ employee: { id: number } }>(page, "GET", "/auth/me");
    const forSelf = await api<{ detail: string }>(page, "POST", "/attendance/manual", {
      employee_id: me.data.employee.id, date: inDays(-1), check_in_time: new Date().toISOString(),
    });
    expect(forSelf.status).toBe(403);
    expect(forSelf.data.detail).toBe("You cannot correct your own attendance.");
  });
});
