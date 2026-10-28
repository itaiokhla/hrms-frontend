import { can, canBeyondSelf } from "./access";
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

export const ATTENDANCE_ROUTE_GUARDS: Record<string, (me: Me) => boolean> = {
  "/attendance/days/[employee_id]/[date]": canOpenAttendanceDay,
  "/teams": canSeeTeams,
  "/teams/[team_id]": canOpenTeam,
  "/attendance/shifts": canSeeShifts,
  "/attendance/shifts/[shift_id]": canSeeShifts,
  "/attendance/shift-rules/[rule_id]": canSeeShiftRules,
  "/rosters": canSeeRosters,
  "/rosters/[period_id]": canSeeRosters,
  "/rosters/my-schedule": canSeeMySchedule,
};

export const ATTENDANCE_ROUTE_GATES: Record<string, AttendanceGate> = {
  "/attendance/days/[employee_id]/[date]": "V2",
  "/teams": "GLOBAL",
  "/teams/[team_id]": "GLOBAL",
  "/attendance/shifts": "GLOBAL",
  "/attendance/shifts/[shift_id]": "GLOBAL",
  "/attendance/shift-rules/[rule_id]": "GLOBAL",
  "/rosters": "GLOBAL",
  "/rosters/[period_id]": "GLOBAL",
  "/rosters/my-schedule": "GLOBAL",
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
