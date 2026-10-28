/**
 * Pure helpers of the Teams pages (X-M1; X 01 §3, §15.2): labels, list views, form validation and the row actions a
 * membership allows. No React, no network: unit-tested in __tests__/teamModel.test.ts.
 */

import type { Membership, MemberRole, Team, TeamListParams, TeamType } from "./api";

export const TEAM_TYPE_LABEL: Record<TeamType, string> = {
  FUNCTIONAL: "Functional",
  PROJECT: "Project",
  CREW: "Crew",
  SITE: "Site",
  OTHER: "Other",
};

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  LEAD: "Lead",
  DEPUTY_LEAD: "Deputy",
  MEMBER: "Member",
};

export const MEMBERSHIP_STATE_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  FUTURE: "Starts later",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

export const TEAM_WARNING_TEXT: Record<string, string> = {
  NO_LEAD: "No lead: team-lead steps go to the fallback approver.",
  NO_ROUTING_LEAD: "No routing lead: team-lead steps go to any lead.",
};

export const TEAM_ERROR_TEXT: Record<string, string> = {
  MEMBERSHIP_OVERLAP: "This person already has a membership of this team on these dates.",
  PRIMARY_TEAM_CONFLICT: "This person already has a primary team on these dates. Tick “Move primary team” to move it here.",
  ROUTING_LEAD_CONFLICT: "This team already has a routing lead on these dates, or the person is not a lead.",
  NOT_ELIGIBLE: "The person is not employed on every date of this membership, or the dates fall outside the team's dates.",
  TEAM_IN_USE: "The team still has members, a rotation or an open roster period. End them first.",
  CONFIRMATION_REQUIRED: "Type the team code to confirm the archive.",
  TEAM_ARCHIVED: "The team is archived.",
  TEAM_CYCLE: "A team cannot be placed under one of its own sub-teams.",
  BRANCH_ENTITY_MISMATCH: "The branch belongs to another legal entity.",
  TEAM_NAME_COLLIDES_WITH_TERM: "This name is already used as a team-type label. Choose another name.",
  MEMBERSHIP_CANCELLED: "The membership was cancelled.",
  INVALID_DATES: "Check the dates: a membership ends on or after its first day.",
  INVALID_DATE: "The date is outside the team's dates.",
  NOTHING_TO_CHANGE: "Nothing to change.",
  ROW_VERSION_CONFLICT: "Someone else changed this record. Reload and try again.",
  CONFLICT: "Another team already uses this code.",
  FORBIDDEN: "You don't have permission to do that.",
};

export const IN_USE_TEXT: Record<string, string> = {
  ACTIVE_MEMBERSHIPS: "It still has active or future members.",
  ROTATION_ASSIGNMENT: "A crew rotation is assigned to it.",
  OPEN_ROSTER_PERIOD: "It has an open roster period.",
};

export const typeLabel = (t: string) => TEAM_TYPE_LABEL[t as TeamType] ?? t;
export const roleLabel = (r: string) => MEMBER_ROLE_LABEL[r as MemberRole] ?? r;
export const stateLabel = (s: string) => MEMBERSHIP_STATE_LABEL[s] ?? s;
export const isLeadRole = (r: string) => r === "LEAD" || r === "DEPUTY_LEAD";

/* ------------------------------------------------------------------ list views (§15.2) */

export type TeamView = "all" | "mine" | "no-lead" | "crews";

export const TEAM_VIEWS: { value: TeamView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Teams I lead" },
  { value: "no-lead", label: "Without a lead" },
  { value: "crews", label: "Crews" },
];

export interface TeamFilters {
  q: string;
  team_type: string;
  status: string;
  /** "" · "yes" · "no" */
  has_lead: string;
}

/** The list query of a view plus the filter controls; a view's own filter wins over the matching control. */
export function teamListParams(view: TeamView, filters: TeamFilters, skip = 0, limit = 25): TeamListParams {
  const params: TeamListParams = { skip, limit };
  const q = filters.q.trim();
  if (q) params.q = q;
  if (filters.team_type) params.team_type = filters.team_type;
  if (filters.status) params.status = filters.status;
  if (filters.has_lead === "yes") params.has_lead = true;
  if (filters.has_lead === "no") params.has_lead = false;
  if (view === "mine") params.mine = true;
  if (view === "no-lead") params.has_lead = false;
  if (view === "crews") params.team_type = "CREW";
  return params;
}

/** The Leads cell: names with ★ for the routing lead; deputies marked. */
export function leadsText(team: Pick<Team, "leads">): string {
  if (!team.leads.length) return "—";
  return team.leads
    .map((l) => `${l.name ?? `Employee #${l.employee_id}`}${l.member_role === "DEPUTY_LEAD" ? " (deputy)" : ""}${l.routing ? " ★" : ""}`)
    .join(", ");
}

/** The Home cell: branch, else legal entity, else the whole company. */
export function homeText(team: Pick<Team, "branch_id" | "legal_entity_id">, branchName: (id: number) => string | undefined,
  entityName: (id: number) => string | undefined): string {
  if (team.branch_id) return branchName(team.branch_id) ?? `Branch #${team.branch_id}`;
  if (team.legal_entity_id) return entityName(team.legal_entity_id) ?? `Entity #${team.legal_entity_id}`;
  return "Company-wide";
}

/* ------------------------------------------------------------------ forms */

export interface TeamValues {
  code: string;
  name: string;
  team_type: string;
  parent_team_id: string;
  legal_entity_id: string;
  branch_id: string;
  description: string;
  effective_from: string;
}

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function validateTeam(values: TeamValues, mode: "create" | "edit"): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mode === "create") {
    const code = values.code.trim();
    if (!code) errors.code = "Enter a code.";
    else if (code.length > 30) errors.code = "At most 30 characters.";
    else if (!CODE_PATTERN.test(code)) errors.code = "Letters, digits, dot, dash and underscore; start with a letter or digit.";
  }
  if (!values.name.trim()) errors.name = "Enter a name.";
  else if (values.name.trim().length > 100) errors.name = "At most 100 characters.";
  if (!values.team_type) errors.team_type = "Choose a type.";
  if (values.description.length > 500) errors.description = "At most 500 characters.";
  return errors;
}

export interface MembershipValues {
  employee_id: number | null;
  member_role: MemberRole;
  is_primary_team: boolean;
  is_routing_lead: boolean;
  effective_from: string;
  effective_to: string;
  reason: string;
  move_primary: boolean;
}

export function validateMembership(values: MembershipValues, { canLeads }: { canLeads: boolean }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.employee_id) errors.employee_id = "Choose a person.";
  if (!canLeads && isLeadRole(values.member_role)) errors.member_role = "Only HR or a team administrator can add leads.";
  if (values.is_routing_lead && values.member_role !== "LEAD") errors.is_routing_lead = "Only a lead can be the routing lead.";
  if (values.effective_from && values.effective_to && values.effective_to < values.effective_from) {
    errors.effective_to = "The membership ends before it starts.";
  }
  if (values.reason.length > 500) errors.reason = "At most 500 characters.";
  return errors;
}

/** Normalises the role switch: leaving LEAD clears the routing flag (routing lead ⇒ LEAD, X 01 §3.1). */
export function withRole(values: MembershipValues, role: MemberRole): MembershipValues {
  return { ...values, member_role: role, is_routing_lead: role === "LEAD" ? values.is_routing_lead : false };
}

/* ------------------------------------------------------------------ row actions */

export interface MembershipActions {
  end: boolean;
  cancel: boolean;
  changeRole: boolean;
}

/**
 * What a member row allows (TM-3, TM-7, SG-X3): end an ACTIVE row, cancel a FUTURE one, change the role or primary
 * flag of either; lead rows need the `leads` permission; nobody changes their own row.
 */
export function membershipActions(row: Pick<Membership, "state" | "member_role" | "employee_id">,
  perms: { members: boolean; leads: boolean }, ownEmployeeId: number | null | undefined): MembershipActions {
  const none = { end: false, cancel: false, changeRole: false };
  if (!perms.members) return none;
  if (ownEmployeeId != null && row.employee_id === ownEmployeeId) return none;
  if (isLeadRole(String(row.member_role)) && !perms.leads) return none;
  const live = row.state === "ACTIVE" || row.state === "FUTURE";
  return {
    end: row.state === "ACTIVE",
    cancel: row.state === "FUTURE",
    // A members-only holder may still change the primary flag of a MEMBER row (§3.2 "set primary team").
    changeRole: live,
  };
}

/** The roles a form may offer: everyone may add MEMBER rows; LEAD / DEPUTY_LEAD need the `leads` permission. */
export function allowedRoles(canLeads: boolean): MemberRole[] {
  return canLeads ? ["MEMBER", "DEPUTY_LEAD", "LEAD"] : ["MEMBER"];
}

/** "2 Nov 2026 – open" style range with the formatter injected (keeps this file free of date libraries). */
export function rangeText(from: string, to: string | null, fmt: (d: string) => string): string {
  return `${fmt(from)} – ${to ? fmt(to) : "open"}`;
}
