import { can, canBeyondSelf, companyWide } from "./access";
import { P } from "./permissions.generated";
import type { Me } from "./types";

/**
 * One guard table for the attendance, shift and team routes (AS 09-ui-ux/01 §4.1 rules 2, 6, 7; spine §11.1): the
 * page guard, the rollout gate and the URL-bound tabs per route. Sidebar children import the same predicates, so the
 * menu and the page can never disagree. UI only: the API enforces every rule on its own.
 */
export type AttendanceGate = "GLOBAL" | "V2";

export interface AttendanceTab {
  value: string;
  label: string;
  /** Hidden tabs are dropped; an unknown or hidden `?tab=` falls back to the first visible one. */
  visible?: (me: Me) => boolean;
}

/** Shifts (A15): `shift:manage` ∨ `shift:assign` ∨ `shift:read` beyond SELF — an employee's SELF read never opens it. */
export function canSeeShifts(me: Me): boolean {
  return can(me, P.SHIFT_MANAGE) || can(me, P.SHIFT_ASSIGN) || canBeyondSelf(me, P.SHIFT_READ);
}

/** Assignment rules (tab and rule pages): `shift:assign` ∨ `shift:read` beyond SELF. */
export function canSeeShiftRules(me: Me): boolean {
  return can(me, P.SHIFT_ASSIGN) || canBeyondSelf(me, P.SHIFT_READ);
}

/** Rosters (AS-M5): `roster:plan` ∨ `roster:publish` ∨ `roster:read` beyond SELF — an employee's SELF read never opens it. */
export function canSeeRosters(me: Me): boolean {
  return can(me, P.ROSTER_PLAN) || can(me, P.ROSTER_PUBLISH) || canBeyondSelf(me, P.ROSTER_READ);
}

/** My schedule: any linked employee with `roster:read` (SELF is in the default self-service role). */
export function canSeeMySchedule(me: Me): boolean {
  return me.employee !== null && can(me, P.ROSTER_READ);
}

/** Teams list (X-M1; X 01 §15.2-§15.3): `team:read` beyond SELF ∨ `team:manage` — an employee's SELF read never opens it. */
export function canSeeTeams(me: Me): boolean {
  return canBeyondSelf(me, P.TEAM_READ) || can(me, P.TEAM_MANAGE);
}

/**
 * One team's page: any team code. A SELF read opens one's own teams (the "My teams" menu links there); the API
 * answers 404 for a team outside the viewer's reach.
 */
export function canOpenTeam(me: Me): boolean {
  return can(me, P.TEAM_READ) || can(me, P.TEAM_MANAGE) || can(me, P.TEAM_MEMBERSHIP_MANAGE);
}

/** One evaluated day (AS-M3): `attendance:read` (SELF opens one's own days; the API answers 404 outside the scope). */
export function canOpenAttendanceDay(me: Me): boolean {
  return can(me, P.ATTENDANCE_READ);
}

/** Approvals inbox (AS-M4, D-AS-55): any approve code of an engine module, or attendance HR. */
export function canSeeApprovals(me: Me): boolean {
  return can(me, P.ATTENDANCE_APPROVE) || can(me, P.ATTENDANCE_REGULARIZE) || can(me, P.OVERTIME_APPROVE)
    || can(me, P.TASK_APPROVE);
}

/** On-duty and remote work (AS-M4): own requests (`attendance:request`) or on behalf of others. */
export function canSeeOnDuty(me: Me): boolean {
  return can(me, P.ATTENDANCE_REQUEST) || can(me, P.ATTENDANCE_REQUEST_ON_BEHALF);
}

/** Timesheets (AS-M4 §12): own week (`attendance:request`) or people in an `attendance:read` scope. */
export function canSeeTimesheets(me: Me): boolean {
  return can(me, P.ATTENDANCE_REQUEST) || canBeyondSelf(me, P.ATTENDANCE_READ);
}

/** Attendance period close (AS-M4 §14.3): `attendance:close_period`. */
export function canClosePeriods(me: Me): boolean {
  return can(me, P.ATTENDANCE_CLOSE_PERIOD);
}

/** Attendance settings pages owned by the module (team attendance, requests & approvals). */
export function canManageAttendanceSettings(me: Me): boolean {
  return can(me, P.ATTENDANCE_MANAGE_POLICY);
}

/** Devices console (AS-M2 kiosks, AS-M7 terminals and agents): `attendance:manage_devices`. */
export function canManageDevices(me: Me): boolean {
  return can(me, P.ATTENDANCE_MANAGE_DEVICES);
}

/** Statutory registers (AS-M9, 10-analytics §6.1 R-1): `attendance:export` beyond SELF. */
export function canExportAttendance(me: Me): boolean {
  return canBeyondSelf(me, P.ATTENDANCE_EXPORT);
}

/** Supervisor muster (AS-M4, D-AS-75): `attendance:muster`. */
export function canSeeMuster(me: Me): boolean {
  return can(me, P.ATTENDANCE_MUSTER);
}

/** Exceptions list (AS-M3): `attendance:read` beyond SELF (an employee opens their own days from My attendance). */
export function canSeeAttendanceExceptions(me: Me): boolean {
  return canBeyondSelf(me, P.ATTENDANCE_READ);
}

/** Settings › Attendance › Overview (cut-over): `attendance:manage_policy` at COMPANY scope (the API checks it too). */
export function canManageAttendanceCutover(me: Me): boolean {
  return companyWide(me, P.ATTENDANCE_MANAGE_POLICY);
}

/** Sites (A20, AS-M2): `attendance:manage_sites` (reads at any scope; writes at COMPANY, checked by the API). */
export function canManageSites(me: Me): boolean {
  return can(me, P.ATTENDANCE_MANAGE_SITES);
}

/** Shift requests & open shifts for planners and approvers (AS-M6): `roster:approve` ∨ `roster:plan`. */
export function canManageShiftRequests(me: Me): boolean {
  return can(me, P.ROSTER_APPROVE) || can(me, P.ROSTER_PLAN);
}

/** Privacy & consents (AS-M2 §6.15): any linked employee. */
export function canSeeMyPrivacy(me: Me): boolean {
  return me.employee !== null;
}

/** `/punch` (M1): a linked employee with `attendance:mark`. */
export function canPunch(me: Me): boolean {
  return me.employee !== null && can(me, P.ATTENDANCE_MARK);
}

/** The V2 rollout gate (spine §15.7): `me.attendance.v2`, set by the cut-over. */
export function attendanceV2(me: Me): boolean {
  return me.attendance?.v2 === true;
}

export const ATTENDANCE_ROUTE_GUARDS: Record<string, (me: Me) => boolean> = {
  "/attendance/days/[employee_id]/[date]": canOpenAttendanceDay,
  "/attendance/exceptions": canSeeAttendanceExceptions,
  "/settings/attendance/overview": canManageAttendanceCutover,
  "/settings/attendance/rules": canManageAttendanceCutover,
  "/teams": canSeeTeams,
  "/teams/[team_id]": canOpenTeam,
  "/attendance/shifts": canSeeShifts,
  "/attendance/shifts/[shift_id]": canSeeShifts,
  "/attendance/shift-rules/[rule_id]": canSeeShiftRules,
  "/rosters": canSeeRosters,
  "/rosters/[period_id]": canSeeRosters,
  "/rosters/my-schedule": canSeeMySchedule,
  "/approvals": canSeeApprovals,
  "/attendance/on-duty": canSeeOnDuty,
  "/attendance/remote-work": canSeeOnDuty,
  "/attendance/muster": canSeeMuster,
  "/attendance/timesheets": canSeeTimesheets,
  "/attendance/period-close": canClosePeriods,
  "/settings/attendance/team": canManageAttendanceSettings,
  "/settings/attendance/requests": canManageAttendanceSettings,
  "/attendance/devices": canManageDevices,
  "/settings/attendance/devices": canManageDevices,
  "/reports/attendance": canExportAttendance,
  "/settings/attendance/capture": canManageAttendanceCutover,
  "/attendance/sites": canManageSites,
  "/attendance/sites/[site_id]": canManageSites,
  "/me/attendance/privacy": canSeeMyPrivacy,
  "/attendance/shift-requests": canManageShiftRequests,
  "/punch": canPunch,
};

export const ATTENDANCE_ROUTE_GATES: Record<string, AttendanceGate> = {
  "/attendance/days/[employee_id]/[date]": "V2",
  "/attendance/exceptions": "V2",
  "/settings/attendance/overview": "GLOBAL",
  "/settings/attendance/rules": "GLOBAL",
  "/teams": "GLOBAL",
  "/teams/[team_id]": "GLOBAL",
  "/attendance/shifts": "GLOBAL",
  "/attendance/shifts/[shift_id]": "GLOBAL",
  "/attendance/shift-rules/[rule_id]": "GLOBAL",
  "/rosters": "GLOBAL",
  "/rosters/[period_id]": "GLOBAL",
  "/rosters/my-schedule": "GLOBAL",
  // AS-M4: on-duty exists for v1 tenants too; attendance requests and muster are v2-only (spine §15.7).
  "/approvals": "GLOBAL",
  "/attendance/on-duty": "GLOBAL",
  "/attendance/remote-work": "GLOBAL",
  "/attendance/muster": "V2",
  "/attendance/timesheets": "V2",
  "/attendance/period-close": "V2",
  "/settings/attendance/team": "GLOBAL",
  "/settings/attendance/requests": "GLOBAL",
  // Kiosks work for every tenant; terminals and agents need v2 (the API answers FEATURE_DISABLED, the form hides them).
  "/attendance/devices": "GLOBAL",
  "/settings/attendance/devices": "GLOBAL",
  // Registers render evaluated days: v1 tenants get an empty register (no attendance_days rows), never a 404 page.
  "/reports/attendance": "GLOBAL",
  // AS-M2: the capture policy is exempt from V-AS-02 (SP-AS-221); sites and consents serve v1 tenants too.
  "/settings/attendance/capture": "GLOBAL",
  "/attendance/sites": "GLOBAL",
  "/attendance/sites/[site_id]": "GLOBAL",
  "/me/attendance/privacy": "GLOBAL",
  // AS-M6 needs attendance v2 (the API answers 409 ATTENDANCE_V2_REQUIRED otherwise).
  "/attendance/shift-requests": "V2",
  "/punch": "GLOBAL",
};

export const ATTENDANCE_TABS: Record<string, readonly AttendanceTab[]> = {
  "/attendance/shifts": [
    { value: "catalogue", label: "Shifts" },
    { value: "rules", label: "Assignment rules", visible: canSeeShiftRules },
  ],
  "/attendance/shifts/[shift_id]": [
    { value: "details", label: "Details" },
    { value: "versions", label: "Versions" },
    { value: "rules", label: "Rules", visible: canSeeShiftRules },
  ],
};

/** The tabs this viewer may see, in order (the first one is the default). */
export function visibleTabs(tabs: readonly AttendanceTab[] | undefined, me: Me | null | undefined): AttendanceTab[] {
  if (!tabs || !me) return [];
  return tabs.filter((t) => !t.visible || t.visible(me));
}

/** Typed route segments (`{shift_id}`, `{rule_id}`): digits only, else the page renders NotFoundState (rule 4). */
export const isIdSegment = (value: string | null | undefined): value is string => !!value && /^\d+$/.test(value);
