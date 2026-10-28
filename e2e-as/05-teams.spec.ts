/**
 * G-05 / X-M1 Chrome checks (AS 13 §4.4 exit) on the time stack 8500/3500 with the G-05 seed (teams of spine §0.3
 * except PAYMENTS). (a) Kavya (HR admin) creates PAYMENTS (PROJECT, BR21) in the Modal and staffs it: Meghna Rao LEAD +
 * routing lead, Priya, Rohan Verma (primary), Farah Ali (LE12, Dubai); she edits it on the detail page. (b) Kavya creates
 * the custom role "Tech Lead (G-05)" (attendance:read, leave:read, team:read at TEAM) and assigns it to Meghna from
 * today (IG-AS-39). (c) Meghna sees People › Teams and the Team attendance board with Priya, Rohan and Farah but not
 * Nitin Gowda. (d) Priya's menus are unchanged (no Teams). (e) When the window ends, the reach is gone (a window that
 * ended yesterday, IG-AS-39); the open window is restored afterwards so the stack keeps the G-05 state. Rerun-safe.
 */
import type { Page } from "@playwright/test";

import { api, employeeId, expect, openAs, shot, signIn, store, test } from "./support";

test.describe.configure({ mode: "serial" });

const ROLE = "Tech Lead (G-05)";
const GRANTS = ["attendance:read", "leave:read", "team:read"].map((permission) => ({ permission, scope: "TEAM" }));

function localDay(offset = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400 * 1000); // Asia/Kolkata (Alpha HQ)
  return now.toISOString().slice(0, 10);
}

async function teamByCode(page: Page, code: string) {
  const list = await api(page, "GET", `/teams?q=${code}&limit=50`);
  return list.data.items.find((t: any) => t.code === code);
}

/** Employees whose attendance records the user can list over the last two months. */
async function inScope(page: Page): Promise<Set<number>> {
  const r = await api(page, "GET", `/attendance?start_date=${localDay(-58)}&end_date=${localDay()}&limit=200`);
  return new Set((r.data.items as any[]).map((i) => i.employee_id));
}

async function setTechLeadWindow(page: Page, userId: number, roleId: number, from: string, until: string | null) {
  const current = (await api(page, "GET", `/users/${userId}/role-assignments`)).data.items as any[];
  const today = localDay();
  const open = current.filter((a) => a.effective_until === null || a.effective_until >= today || a.role_id === roleId);
  const tech = open.filter((a) => a.role_id === roleId);
  const keep = open.filter((a) => a.role_id !== roleId).map((a) => ({
    assignment_id: a.assignment_id, role_id: a.role_id, effective_from: a.effective_from,
    effective_until: a.effective_until, targets: a.targets,
  }));
  const window = { ...(tech.length ? { assignment_id: tech[tech.length - 1].assignment_id } : {}), role_id: roleId,
    effective_from: from, effective_until: until, targets: {} };
  const r = await api(page, "PUT", `/users/${userId}/roles`, { assignments: [...keep, window] });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
}

test("X-M1 (a)-(e): Kavya builds PAYMENTS, Meghna's team reach comes and goes with her role window", async ({ page, browser }, testInfo) => {
  const ids = { meghna: employeeId("alpha", "meghna"), priya: employeeId("alpha", "priya"),
    rohan: employeeId("alpha", "rohan"), farah: employeeId("alpha", "farah"), nitin: employeeId("alpha", "nitin") };
  const meghnaUser = store().companies.alpha.ids.people.meghna.user_id as number;
  await signIn(page, "alpha", "kavya");

  await test.step("(a) Kavya creates PAYMENTS in the Modal, staffs it and edits it", async () => {
    await page.goto("/teams");
    await expect(page.getByTestId("teams-table")).toBeVisible();
    let team = await teamByCode(page, "PAYMENTS");
    if (!team) {
      const branches = (await api(page, "GET", "/branches")).data as any[];
      const br21 = branches.find((b) => b.code === "BR21");
      await page.getByTestId("open-new-team").click();
      const form = page.getByTestId("team-form");
      await form.getByTestId("team-code").fill("PAYMENTS");
      await form.getByTestId("team-name").fill("Payments");
      await form.getByTestId("team-type").selectOption("PROJECT");
      await form.getByTestId("team-branch").selectOption(String(br21.id));
      await form.getByTestId("team-from").fill(localDay(-30));
      await shot(page, testInfo, "a1-new-team-modal");
      await page.getByTestId("team-save").click();
      await page.waitForURL(/\/teams\/\d+/);  // create opens the new team's page
      team = await teamByCode(page, "PAYMENTS");
      expect(team, "PAYMENTS created").toBeTruthy();
    }
    await page.goto(`/teams/${team.id}?tab=members`);
    await expect(page.getByTestId("team-detail")).toBeVisible();
    const members = (await api(page, "GET", `/teams/${team.id}/members?state=ALL&limit=500`)).data.items as any[];
    const plan: [keyof typeof ids, string, string, boolean, boolean][] = [
      ["meghna", "Megh", "LEAD", true, false], ["priya", "Priy", "MEMBER", false, true],
      ["rohan", "Roha", "MEMBER", false, true], ["farah", "Fara", "MEMBER", false, true],
    ];
    for (const [key, search, role, routing, primary] of plan) {
      if (members.some((m) => m.employee_id === ids[key])) continue;
      await page.getByTestId("open-add-member").click();
      const form = page.getByTestId("member-form");
      await form.getByTestId("member-search").fill(search);
      await form.getByTestId(`member-candidate-${ids[key]}`).click();
      await form.getByTestId("member-role").selectOption(role);
      if (routing) await form.getByTestId("member-routing").check();
      if (primary) {
        const box = form.getByTestId("member-primary");
        if (!(await box.isChecked())) await box.check();
      }
      const from = team.effective_from > localDay(-7) ? team.effective_from : localDay(-7);  // inside the team
      await form.getByTestId("member-from").fill(from);
      await page.getByTestId("member-save").click();
      const done = page.getByTestId("member-done");  // the modal stays open to list warnings, if any
      await expect(done.or(page.getByTestId(`member-row-${ids[key]}`).first())).toBeVisible();
      if (await done.isVisible()) await done.click();
      await expect(page.getByTestId(`member-row-${ids[key]}`).first()).toBeVisible();
    }
    for (const key of ["meghna", "priya", "rohan", "farah"] as const) {
      await expect(page.getByTestId(`member-row-${ids[key]}`).first()).toBeVisible();
    }
    await shot(page, testInfo, "a2-payments-members");
    // Edit on the detail page (the same TeamForm).
    await page.goto(`/teams/${team.id}?tab=details`);
    await page.getByTestId("edit-team").click();
    await page.getByTestId("team-form").getByTestId("team-name").fill("Payments");
    await page.getByTestId("team-save").click();
    await expect(page.getByTestId("team-detail")).toContainText("Payments");
    const detail = await teamByCode(page, "PAYMENTS");
    expect(detail.leads.map((l: any) => [l.name, l.routing])).toEqual([["Meghna Rao", true]]);
    expect(detail.member_count).toBe(4);
  });

  await test.step("(b) the company admin creates the Tech Lead role; Kavya gives it to Meghna from today", async () => {
    // X 01 §16 S1-S2: roles are created by the company admin (role:create), assigned by HR (user:assign_role).
    let role = ((await api(page, "GET", "/roles")).data as any[]).find((r) => r.name === ROLE);
    if (!role) {
      const founder = await openAs(browser, "alpha", "founder");
      const created = await api(founder.page, "POST", "/roles", { name: ROLE, description: "Sees the teams they lead (G-05)", grants: GRANTS });
      expect(created.status, JSON.stringify(created.data)).toBeLessThan(300);
      role = created.data;
      await founder.close();
    }
    await setTechLeadWindow(page, meghnaUser, role.id, localDay(), null);
    const windows = (await api(page, "GET", `/users/${meghnaUser}/role-assignments`)).data.items as any[];
    expect(windows.some((w) => w.role_id === role.id && w.effective_until === null)).toBe(true);
  });

  await test.step("(c) Meghna sees People › Teams and her team's attendance, not Nitin", async () => {
    const m = await openAs(browser, "alpha", "meghna");
    await m.page.goto("/dashboard");
    await expect(m.page.getByRole("link", { name: "Teams", exact: true }).first()).toBeVisible();
    await m.page.goto("/teams");
    await expect(m.page.getByTestId("team-row-PAYMENTS").first()).toBeVisible();
    await shot(m.page, testInfo, "c1-meghna-teams");
    // In scope: Meghna (SELF) + Priya, Rohan, Farah (TEAM); Nitin is not (spine §0.3 cast, X 01 §4.4).
    const board = await api(m.page, "GET", "/attendance/summary/today");
    expect(board.data.total_employees).toBe(4);
    const people = await inScope(m.page);
    expect(people.has(ids.priya)).toBe(true);
    expect(people.has(ids.nitin)).toBe(false);
    await m.page.goto("/attendance");
    await m.page.getByRole("tab", { name: "Team", exact: true }).or(m.page.getByRole("button", { name: "Team", exact: true })).first().click();
    await m.page.getByLabel("From").first().fill(localDay(-58));  // today is a closure day on BR21 (LH e2e data)
    await expect(m.page.getByText("Priya Shah").first()).toBeVisible();
    await expect(m.page.getByText("Nitin Gowda")).toHaveCount(0);
    await shot(m.page, testInfo, "c2-meghna-team-attendance");
    await m.close();
  });

  await test.step("(d) Priya's menus are unchanged", async () => {
    const p = await openAs(browser, "alpha", "priya");
    await p.page.goto("/dashboard");
    await expect(p.page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
    await expect(p.page.getByRole("link", { name: "Teams", exact: true })).toHaveCount(0);
    await shot(p.page, testInfo, "d-priya-menus");
    await p.close();
  });

  await test.step("(e) after the window's last day the reach is gone; restored afterwards", async () => {
    const role = ((await api(page, "GET", "/roles")).data as any[]).find((r) => r.name === ROLE);
    await setTechLeadWindow(page, meghnaUser, role.id, localDay(-8), localDay(-1));
    const m = await openAs(browser, "alpha", "meghna");
    const board = await api(m.page, "GET", "/attendance/summary/today");
    expect(board.data.total_employees).toBeLessThan(4);
    expect((await inScope(m.page)).has(ids.priya)).toBe(false);
    await m.page.goto("/dashboard");
    await expect(m.page.getByRole("link", { name: "Teams", exact: true })).toHaveCount(0);
    await shot(m.page, testInfo, "e-meghna-after-window");
    await m.close();
    await setTechLeadWindow(page, meghnaUser, role.id, localDay(), null);
  });
});
