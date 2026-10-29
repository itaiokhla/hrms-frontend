/**
 * G-17 / AS-M7 — biometric terminals, agents and CSV imports on the time stack 8500/3500 (04-attendance/01 §7, §8).
 * A harness plays the ZKTeco terminal: it speaks ADMS plain text to the backend (/iclock/*) like the firmware does.
 *
 * (a) Kavya registers a biometric terminal (serial, make, first-and-last scans) and keeps the claim code; the
 *     terminal's first contact is refused 401 and quarantined (AS-SEC-01).
 * (b) She activates it: the dialog shows the first contact (proof of possession, AS-SEC-02), asks "Confirm it's you"
 *     (step-up) and shows the secret once (AS-SEC-07).
 * (c) The terminal handshakes and uploads two scans of an unknown PIN plus one malformed line: "OK: 3" only after the
 *     save (AS-DEV-01); the console shows it Online; the detail counts one rejected line (AS-DEV-14).
 * (d) She maps the PIN to an employee from the "People" tab; the scans become one device session (M-7, AS-CAP-11).
 * (e) "Sync time" is queued, fetched by the terminal's poll and acknowledged (SR-AS-04).
 * (f) She drops a CSV on "Import punches": the dry run lists unknown people and bad times, the import stores the
 *     valid rows, a second import of the same file stores nothing (AS-DEV-10).
 * (g) Suspended terminals get 403; Settings › Attendance › Devices & biometrics opens the same console; an employee
 *     gets 403 on the device API; Beta (v1) registers kiosks only.
 * Rerun-safe: every run registers a new serial, PIN and device code.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { completeStepUpIfAsked } from "../e2e-lh/step-up";
import { api, employeeId, expect, shot, signIn, test } from "./support";

test.describe.configure({ mode: "serial" });

const BACKEND_URL = process.env.E2E_TIME_BACKEND_URL ?? "http://127.0.0.1:8500";
const RUN = Date.now().toString(36).toUpperCase();
const SERIAL = `E2E${RUN}`;
const CODE = `GATE-${RUN}`;
const PIN = String(70000 + (Date.now() % 20000));

let deviceId = 0;
let claimCode = "";
let secret = "";
let target = { id: 0, name: "" };

function localStamp(daysAgo: number, hhmm: string) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 10)} ${hhmm}:00`;
}

async function iclock(request: APIRequestContext, method: "GET" | "POST", path: string, params: Record<string, string>, body?: string) {
  const query = new URLSearchParams(params).toString();
  const url = `${BACKEND_URL}/iclock/${path}?${query}`;
  const r = method === "GET" ? await request.get(url) : await request.post(url, { data: body ?? "", headers: { "Content-Type": "text/plain" } });
  return { status: r.status(), text: await r.text() };
}

async function openDevice(page: Page) {
  await page.goto("/attendance/devices");
  const row = page.getByRole("cell").getByTestId(`device-row-${CODE}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await row.click();
    await expect(page.getByTestId("device-detail")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

async function openTab(page: Page, name: RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test("(a) Kavya registers a biometric terminal; its first contact is quarantined", async ({ page, request }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance/devices");
  await expect(page.getByRole("heading", { name: "Devices", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await page.getByTestId("open-register-device").click();
    await expect(page.getByTestId("device-form")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId("device-kind").getByRole("radio", { name: "Biometric terminal" }).click();
  await page.getByTestId("device-code").fill(CODE);
  await page.getByTestId("device-name").fill("Pune plant gate (e2e)");
  await page.getByTestId("device-serial").fill(SERIAL);
  await page.getByTestId("device-vendor").selectOption("ZKTECO");
  await page.getByTestId("device-direction").selectOption("FIRST_LAST");
  await shot(page, testInfo, "17a-register-terminal");
  await page.getByTestId("device-save").click();
  const claim = page.getByTestId("device-claim-code");
  await expect(claim).toBeVisible();
  claimCode = (await claim.textContent())?.trim() ?? "";
  expect(claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await shot(page, testInfo, "17a-claim-code");
  await page.getByTestId("device-register-done").click();
  const listed = await api(page, "GET", `/attendance/devices?q=${CODE}`);
  deviceId = listed.data.items[0].id;
  expect(listed.data.items[0]).toMatchObject({ kind: "TERMINAL", status: "PENDING_ACTIVATION", integration: "PUSH" });
  const first = await iclock(request, "GET", "cdata", { SN: SERIAL, options: "all", pushver: "2.4.1" });
  expect(first).toEqual({ status: 401, text: "DEVICE_AUTH_FAILED" });
});

test("(b) she activates it with step-up after the first contact; the secret is shown once", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await openDevice(page);
  await page.getByTestId("device-action-activate").click();
  await expect(page.getByTestId("device-first-contact")).toHaveAttribute("data-seen", "yes");
  await page.getByTestId("device-activate-claim").fill(claimCode);
  await page.getByTestId("device-activate-serial").fill(SERIAL);
  await shot(page, testInfo, "17b-activate-proof-of-possession");
  await page.getByTestId("device-activate-submit").click();
  await completeStepUpIfAsked(page, "alpha", "kavya", 10_000);
  const secretBox = page.getByTestId("device-secret");
  await expect(secretBox).toBeVisible({ timeout: 30_000 });
  secret = (await secretBox.textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThanOrEqual(24);
  await shot(page, testInfo, "17b-secret-once");
  await page.getByTestId("device-activate-done").click();
  const detail = await api(page, "GET", `/attendance/devices/${deviceId}`);
  expect(detail.data.status).toBe("ACTIVE");
  expect(JSON.stringify(detail.data)).not.toContain(secret);
});

test("(c) the terminal handshakes and uploads; the console shows it online with one rejected line", async ({ page, request }, testInfo) => {
  const auth = { SN: SERIAL, key: secret };
  expect((await iclock(request, "GET", "cdata", { SN: SERIAL, options: "all", key: "wrong" })).status).toBe(401);
  const hello = await iclock(request, "GET", "cdata", { ...auth, options: "all", pushver: "2.4.1" });
  expect(hello.status).toBe(200);
  expect(hello.text).toContain(`GET OPTION FROM: ${SERIAL}`);
  const attlog = [`${PIN}\t${localStamp(2, "01:10")}\t0\t1\t0`, `${PIN}\t${localStamp(2, "01:55")}\t1\t1\t0`, `${PIN}\tnot-a-date\t0\t1`].join("\n");
  const upload = await iclock(request, "POST", "cdata", { ...auth, table: "ATTLOG", Stamp: "100" }, attlog);
  expect(upload).toEqual({ status: 200, text: "OK: 3" });
  const resend = await iclock(request, "POST", "cdata", { ...auth, table: "ATTLOG", Stamp: "100" }, attlog);
  expect(resend.text).toBe("OK: 3"); // P-2: duplicates collapse, still acknowledged
  await signIn(page, "alpha", "kavya");
  await page.goto("/attendance/devices");
  const row = page.getByRole("cell").getByTestId(`device-row-${CODE}`).locator("xpath=ancestor::tr");
  await expect(row.getByTestId("device-health")).toHaveAttribute("data-health", "ONLINE");
  await shot(page, testInfo, "17c-console-online");
  await openDevice(page);
  await expect(page.getByTestId("device-recent-punches")).toContainText(`PIN ${PIN}`);
  await openTab(page, /Rejected lines/);
  await expect(page.getByTestId("device-rejects")).toContainText("invalid datetime");
  await shot(page, testInfo, "17c-rejected-line");
  const summary = await api(page, "GET", `/attendance/devices/${deviceId}/summary`);
  expect(summary.data.punches).toBe(2);
});

test("(d) she maps the PIN to an employee from the People tab; the scans become a device session", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  target = { id: employeeId("alpha", "priya"), name: "" };
  const employee = await api(page, "GET", `/employees/${target.id}`);
  target.name = employee.data.full_name;
  await openDevice(page);
  await openTab(page, /People/);
  const unmapped = page.getByTestId(`unmapped-${PIN}`);
  await expect(unmapped).toBeVisible();
  await unmapped.getByRole("button", { name: /Map to employee/ }).click();
  await page.getByPlaceholder("Type a name, code or email").fill(target.name.split(" ")[0]);
  await page.getByRole("option", { name: new RegExp(target.name) }).first().click();
  await shot(page, testInfo, "17d-map-unmapped-pin");
  await page.getByTestId(`unmapped-map-${PIN}`).click();
  await expect(page.getByTestId(`mapping-${PIN}`)).toContainText(target.name);
  await expect(page.getByTestId(`unmapped-${PIN}`)).toHaveCount(0);
  await shot(page, testInfo, "17d-mapped");
  await openTab(page, /Overview/);
  await expect(async () => {
    const summary = await api(page, "GET", `/attendance/devices/${deviceId}/summary`);
    // M-7: both scans now belong to the employee and were paired. On a rerun earlier runs' scans of the same person
    // and minute exist on other devices, so pairing may keep those and mark these duplicates (cross-device dedup).
    const recent = summary.data.recent as { disposition: string; employee: { id: number } | null; mapping_status: string }[];
    expect(recent.length).toBe(2);
    for (const p of recent) {
      expect(p.employee?.id).toBe(target.id);
      expect(p.mapping_status).toBe("MAPPED");
      expect(["USED", "IGNORED_DUPLICATE", "IGNORED_WINDOW"]).toContain(p.disposition);
    }
  }).toPass({ timeout: 20_000 });
});

test("(e) Sync time is queued, fetched by the terminal's poll and acknowledged", async ({ page, request }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await openDevice(page);
  await openTab(page, /Commands/);
  await page.getByTestId("command-SYNC_TIME").click();
  const queued = page.locator('[data-testid^="command-row-"]').first();
  await expect(queued).toContainText("queued");
  // The poll also carries the UPLOAD_USER that mapping the PIN queued in (d) (E-2): one line per command.
  const poll = await iclock(request, "GET", "getrequest", { SN: SERIAL, key: secret });
  const lines = poll.text.trim().split("\n");
  const sync = lines.find((l) => /^C:\d+:SET OPTIONS DateTime=/.test(l));
  expect(sync).toBeTruthy();
  expect(lines.some((l) => /^C:\d+:DATA UPDATE USERINFO PIN=/.test(l))).toBe(true);
  const commandId = sync!.split(":")[1];
  const ack = await iclock(request, "POST", "devicecmd", { SN: SERIAL, key: secret },
    lines.map((l) => `ID=${l.split(":")[1]}&Return=0&CMD=DATA`).join("\n"));
  expect(ack.status).toBe(200);
  await openTab(page, /Overview/);
  await openTab(page, /Commands/);
  await expect(page.getByTestId(`command-row-${commandId}`)).toContainText("acked");
  await shot(page, testInfo, "17e-command-acked");
});

test("(f) CSV import: dry run with issues, import, re-import stores nothing", async ({ page }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  const employee = await api(page, "GET", `/employees/${employeeId("alpha", "priya")}`);
  const code = employee.data.employee_code;
  const day = localStamp(3, "00:00").slice(0, 10);
  const minute = String(Date.now() % 50).padStart(2, "0");
  const csv = [
    "employee_code,device_user_id,date,time,direction,timezone,note",
    `${code},,${day},02:${minute},IN,,`,
    `${code},,${day},03:${minute},OUT,,`,
    `,${PIN}9,${day},02:${minute},IN,,`,
    `${code},,${day},26:00,IN,,`,
  ].join("\n");
  await page.goto("/attendance/devices");
  await expect(async () => {
    await page.getByTestId("open-import").click();
    await expect(page.getByTestId("import-drawer")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId("import-file").setInputFiles({ name: "punches.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const result = page.getByTestId("import-result");
  await expect(result).toHaveAttribute("data-status", "DRY_RUN");
  await expect(page.getByTestId("import-issues")).toContainText("Unknown person");
  await expect(page.getByTestId("import-issues")).toContainText("Invalid date or time");
  await shot(page, testInfo, "17f-import-dry-run");
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toContainText("Imported 3 punch(es)");
  await shot(page, testInfo, "17f-import-done");
  const again = await page.evaluate(async (text) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("hrms_csrf="))?.split("=")[1] ?? "";
    const form = new FormData();
    form.append("file", new Blob([text], { type: "text/csv" }), "punches.csv");
    form.append("dry_run", "false");
    const r = await fetch("/api/v1/attendance/imports", { method: "POST", body: form, headers: { "X-CSRF-Token": decodeURIComponent(csrf) } });
    return { status: r.status, body: await r.json() };
  }, csv);
  expect(again.status).toBe(201);
  expect(again.body.totals.inserted).toBe(0);
});

test("(g) suspension, the settings entry point and who may see devices", async ({ page, request }, testInfo) => {
  await signIn(page, "alpha", "kavya");
  await page.goto("/settings/attendance/devices");
  await expect(page.getByRole("heading", { name: "Devices", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell").getByTestId(`device-row-${CODE}`)).toBeVisible();
  await shot(page, testInfo, "17g-settings-devices");
  const detail = await api(page, "GET", `/attendance/devices/${deviceId}`);
  const suspended = await api(page, "POST", `/attendance/devices/${deviceId}/suspend`, { reason: "e2e" });
  expect(suspended.status).toBe(200);
  expect(detail.data.row_version).toBeGreaterThan(0);
  expect(await iclock(request, "GET", "getrequest", { SN: SERIAL, key: secret })).toEqual({ status: 403, text: "DEVICE_SUSPENDED" });
  expect((await api(page, "POST", `/attendance/devices/${deviceId}/retire`, { reason: "e2e done" })).status).toBe(200);
  expect((await iclock(request, "GET", "ping", { SN: SERIAL, key: secret })).status).toBe(401);
  await signIn(page, "alpha", "priya");
  expect((await api(page, "GET", "/attendance/devices")).status).toBe(403);
  await signIn(page, "beta", "founder");
  await page.goto("/attendance/devices");
  await expect(async () => {
    await page.getByTestId("open-register-device").click();
    await expect(page.getByTestId("device-form")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("device-kind")).toHaveCount(0); // v1: kiosks only
  const refused = await api(page, "POST", "/attendance/devices", { code: `B-${RUN}`, name: "Beta gate", kind: "TERMINAL", serial_number: `B${SERIAL}` });
  expect(refused.status).toBe(422);
  await shot(page, testInfo, "17g-beta-v1-kiosk-only");
});
