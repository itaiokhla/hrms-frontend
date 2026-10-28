/** AS-M1 WI-AS-1.7: the shift route guards, tabs and the sidebar child share one predicate (09-ui-ux/01 §4.1). */
import {
  ATTENDANCE_ROUTE_GATES, ATTENDANCE_ROUTE_GUARDS, ATTENDANCE_TABS, canOpenTeam, canSeeMySchedule, canSeeRosters, canSeeShifts,
  canSeeTeams, isIdSegment, visibleTabs,
} from "@/lib/attendance-routes";
import { navFor } from "@/lib/navigation";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false },
    roles: [], permissions, is_company_admin: false, registry_version: "test",
  };
}

const kavya = me({ [P.SHIFT_MANAGE]: ["COMPANY"], [P.SHIFT_ASSIGN]: ["COMPANY"], [P.SHIFT_READ]: ["COMPANY"], [P.ATTENDANCE_READ]: ["COMPANY"] });
const priya = me({ [P.SHIFT_READ]: ["SELF"], [P.ATTENDANCE_MARK]: ["SELF"] });
const planner = me({ [P.SHIFT_ASSIGN]: ["BRANCH"] });
const supervisor = me({ [P.SHIFT_READ]: ["DEPARTMENT"], [P.ATTENDANCE_READ]: ["DEPARTMENT"] });

const attendanceChildren = (user: Me) =>
  navFor(user).flatMap((g) => g.items).find((i) => i.label === "Attendance")?.children?.map((c) => c.href) ?? [];

describe("shift route guards", () => {
  it("opens Shifts for manage, assign or a read beyond SELF, never for an employee's SELF read", () => {
    expect(canSeeShifts(kavya)).toBe(true);
    expect(canSeeShifts(planner)).toBe(true);
    expect(canSeeShifts(supervisor)).toBe(true);
    expect(canSeeShifts(priya)).toBe(false);
    expect(canSeeShifts(me({}))).toBe(false);
    for (const path of ["/attendance/shifts", "/attendance/shifts/[shift_id]"]) {
      expect(ATTENDANCE_ROUTE_GUARDS[path](kavya)).toBe(true);
      expect(ATTENDANCE_ROUTE_GUARDS[path](priya)).toBe(false);
    }
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/shift-rules/[rule_id]"](priya)).toBe(false);
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/shift-rules/[rule_id]"](planner)).toBe(true);
  });

  it("gates every shift route GLOBAL (AS-M1 ships to every tenant) and the evaluation pages V2 (AS-M3)", () => {
    expect(Object.keys(ATTENDANCE_ROUTE_GATES).sort()).toEqual(Object.keys(ATTENDANCE_ROUTE_GUARDS).sort());
    const v2 = ["/attendance/days/[employee_id]/[date]", "/attendance/exceptions"];
    expect(v2.map((path) => ATTENDANCE_ROUTE_GATES[path])).toEqual(["V2", "V2"]);
    const others = Object.entries(ATTENDANCE_ROUTE_GATES).filter(([path]) => !v2.includes(path)).map(([, gate]) => gate);
    expect(new Set(others)).toEqual(new Set(["GLOBAL"]));
  });

  it("shows Exceptions only on v2 tenants and the cut-over only to company-wide policy managers (AS-M3)", () => {
    const hr = me({ [P.ATTENDANCE_READ]: ["COMPANY"], [P.ATTENDANCE_MANAGE_POLICY]: ["COMPANY"] });
    const branchHr = me({ [P.ATTENDANCE_READ]: ["BRANCH"], [P.ATTENDANCE_MANAGE_POLICY]: ["LEGAL_ENTITY"] });
    expect(attendanceChildren(hr)).not.toContain("/attendance/exceptions");
    expect(attendanceChildren({ ...hr, attendance: { v2: true } })).toContain("/attendance/exceptions");
    expect(attendanceChildren(hr)).toContain("/settings/attendance/overview");
    expect(attendanceChildren(branchHr)).not.toContain("/settings/attendance/overview");
    expect(ATTENDANCE_ROUTE_GUARDS["/settings/attendance/overview"](branchHr)).toBe(false);
    expect(ATTENDANCE_ROUTE_GUARDS["/settings/attendance/rules"](hr)).toBe(true);
    expect(ATTENDANCE_ROUTE_GUARDS["/settings/attendance/rules"](branchHr)).toBe(false);
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/exceptions"](branchHr)).toBe(true);
    expect(ATTENDANCE_ROUTE_GUARDS["/attendance/exceptions"](me({ [P.ATTENDANCE_READ]: ["SELF"] }))).toBe(false);
  });

  it("opens an evaluated day for any attendance:read, SELF included (the API scopes the employee)", () => {
    const day = ATTENDANCE_ROUTE_GUARDS["/attendance/days/[employee_id]/[date]"];
    expect(day(kavya)).toBe(true);
    expect(day(me({ [P.ATTENDANCE_READ]: ["SELF"] }))).toBe(true);
    expect(day(priya)).toBe(false);
  });

  it("lists the catalogue and rules tabs in order, rules only for assign or read beyond SELF", () => {
    expect(visibleTabs(ATTENDANCE_TABS["/attendance/shifts"], kavya).map((t) => t.value)).toEqual(["catalogue", "rules"]);
    expect(visibleTabs(ATTENDANCE_TABS["/attendance/shifts"], me({ [P.SHIFT_MANAGE]: ["BRANCH"] })).map((t) => t.value)).toEqual(["catalogue"]);
    expect(visibleTabs(ATTENDANCE_TABS["/attendance/shifts"], null)).toEqual([]);
  });

  it("shows the Shifts sidebar child with the same predicate", () => {
    expect(attendanceChildren(kavya)).toContain("/attendance/shifts");
    expect(attendanceChildren(priya)).not.toContain("/attendance/shifts");
  });

  it("opens Rosters for plan, publish or a read beyond SELF, and My schedule for any linked employee (AS-M5)", () => {
    const rosterPlanner = me({ [P.ROSTER_PLAN]: ["BRANCH"], [P.ROSTER_READ]: ["BRANCH"] });
    const employee = me({ [P.ROSTER_READ]: ["SELF"], [P.ATTENDANCE_MARK]: ["SELF"] });
    expect(canSeeRosters(rosterPlanner)).toBe(true);
    expect(canSeeRosters(me({ [P.ROSTER_PUBLISH]: ["DEPARTMENT"] }))).toBe(true);
    expect(canSeeRosters(employee)).toBe(false);
    expect(canSeeMySchedule(employee)).toBe(true);
    expect(canSeeMySchedule({ ...employee, employee: null })).toBe(false);
    expect(ATTENDANCE_ROUTE_GUARDS["/rosters/[period_id]"](rosterPlanner)).toBe(true);
    expect(attendanceChildren(rosterPlanner)).toEqual(expect.arrayContaining(["/rosters", "/rosters/my-schedule"]));
    expect(attendanceChildren(employee)).toContain("/rosters/my-schedule");
    expect(attendanceChildren(employee)).not.toContain("/rosters");
  });

  it("opens Teams for team:read beyond SELF or team:manage, never for an employee's SELF read (X-M1, X 01 §15.3)", () => {
    const peopleItems = (user: Me) =>
      navFor(user).find((g) => g.label === "People")?.items.map((i) => i.href) ?? [];
    const manager = me({ [P.TEAM_READ]: ["SELF", "REPORTING_TREE"], [P.EMPLOYEE_READ]: ["REPORTING_TREE"] });
    const admin = me({ [P.TEAM_MANAGE]: ["BRANCH"] });
    const lead = me({ [P.TEAM_READ]: ["TEAM_TREE"], [P.TEAM_MEMBERSHIP_MANAGE]: ["TEAM_TREE"] });
    const employee = me({ [P.TEAM_READ]: ["SELF"], [P.ATTENDANCE_MARK]: ["SELF"] });
    expect(canSeeTeams(manager)).toBe(true);
    expect(canSeeTeams(admin)).toBe(true);
    expect(canSeeTeams(lead)).toBe(true);
    expect(canSeeTeams(employee)).toBe(false);
    expect(canSeeTeams(me({}))).toBe(false);
    expect(peopleItems(manager)).toEqual(["/employees", "/organization", "/teams"]);
    expect(peopleItems(admin)).toEqual(["/teams"]);
    expect(navFor(employee).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/teams");
    // A SELF read still opens one's own team page (the "My teams" menu links there).
    expect(ATTENDANCE_ROUTE_GUARDS["/teams"](employee)).toBe(false);
    expect(ATTENDANCE_ROUTE_GUARDS["/teams/[team_id]"](employee)).toBe(true);
    expect(canOpenTeam(me({}))).toBe(false);
  });

  it("accepts digits only as an id segment", () => {
    expect(isIdSegment("42")).toBe(true);
    expect(isIdSegment("4x")).toBe(false);
    expect(isIdSegment("")).toBe(false);
    expect(isIdSegment(null)).toBe(false);
  });
});
