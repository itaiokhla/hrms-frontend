/**
 * Typed client of teams, memberships and `/me/teams` (X-M1; X 01 §3, §11, §14; backend app/routes/teams.py,
 * app/services/team_service.py). Writes send an `Idempotency-Key`; edits send the record's `row_version`. Errors keep
 * the body's structured `code` and `details` (TEAM_IN_USE reasons, NOT_ELIGIBLE dates).
 */

import type { Method } from "axios";

import { ShiftApiError } from "@/components/shifts/api";
import { http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";
import type { MeTeams } from "@/lib/types";

/* ------------------------------------------------------------------ objects (serialize_team / serialize_membership) */

export const TEAM_TYPES = ["FUNCTIONAL", "PROJECT", "CREW", "SITE", "OTHER"] as const;
export type TeamType = (typeof TEAM_TYPES)[number];
export const MEMBER_ROLES = ["LEAD", "DEPUTY_LEAD", "MEMBER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type TeamStatus = "ACTIVE" | "ARCHIVED";
export type TeamWarning = "NO_LEAD" | "NO_ROUTING_LEAD";
export type MembershipState = "FUTURE" | "ACTIVE" | "ENDED" | "CANCELLED";

export interface TeamLead {
  employee_id: number;
  name: string | null;
  member_role: MemberRole | string;
  routing: boolean;
}

export interface Team {
  id: number;
  code: string;
  name: string;
  team_type: TeamType | string;
  parent_team_id: number | null;
  legal_entity_id: number | null;
  branch_id: number | null;
  site_id: number | null;
  description: string | null;
  status: TeamStatus | string;
  effective_from: string;
  effective_to: string | null;
  row_version: number;
  /** Active LEAD and DEPUTY_LEAD rows, LEAD first, the routing lead first among them. */
  leads: TeamLead[];
  member_count: number | null;
  warnings: (TeamWarning | string)[];
}

/** What the viewer may do on this team (`GET /teams/{id}`). */
export interface TeamPermissions {
  manage: boolean;
  /** May add / end MEMBER rows. */
  members: boolean;
  /** May add / end LEAD and DEPUTY_LEAD rows and set the routing lead. */
  leads: boolean;
  /** Sees every member (not only the leads and their own row). */
  member_list: boolean;
}

export interface TeamDetail extends Team {
  permissions: TeamPermissions;
  parent_history: { parent_team_id: number | null; effective_from: string; effective_to: string | null }[];
}

export interface Membership {
  id: number;
  team_id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  member_role: MemberRole | string;
  is_primary_team: boolean;
  is_routing_lead: boolean;
  effective_from: string;
  effective_to: string | null;
  state: MembershipState | string;
  reason: string | null;
  row_version: number;
}

export interface MembershipWarning {
  code: "ABOVE_LEAD" | "DEPUTY_CANNOT_APPROVE" | string;
  message: string;
}

export interface MembershipResult extends Membership {
  warnings: MembershipWarning[];
}

export interface MemberCandidate {
  employee_id: number;
  name: string;
  employee_code: string | null;
  branch: string | null;
}

export interface ArchivePreview {
  dry_run: true;
  team_id: number;
  /** ACTIVE_MEMBERSHIPS · ROTATION_ASSIGNMENT · OPEN_ROSTER_PERIOD: any of them blocks the archive. */
  in_use: string[];
  /** Role assignments that name this team as an ASSIGNED_TEAMS target (they lose it; never blocks). */
  target_holders: { user_id: number; user_name: string; role_id: number; role_name: string; assignment_id: number }[];
  confirm_code_required: boolean;
}

export interface PageOf<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

/* ------------------------------------------------------------------ bodies (app/schemas/teams.py) */

export interface TeamBody {
  code: string;
  name: string;
  team_type: TeamType;
  parent_team_id?: number | null;
  legal_entity_id?: number | null;
  branch_id?: number | null;
  description?: string | null;
  effective_from?: string | null;
}

export interface TeamPatchBody {
  name?: string;
  team_type?: TeamType;
  legal_entity_id?: number | null;
  branch_id?: number | null;
  description?: string | null;
  parent_team_id?: number | null;
  clear_parent?: boolean;
  parent_effective_from?: string | null;
  row_version: number;
}

export interface MembershipBody {
  employee_id: number;
  member_role: MemberRole;
  is_primary_team: boolean;
  is_routing_lead: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  reason?: string | null;
  move_primary?: boolean;
}

export interface MembershipPatchBody {
  effective_to?: string | null;
  cancel?: boolean;
  member_role?: MemberRole;
  is_primary_team?: boolean;
  is_routing_lead?: boolean;
  change_from?: string | null;
  reason?: string | null;
  row_version: number;
}

export interface TeamListParams {
  q?: string;
  team_type?: string;
  status?: string;
  branch_id?: number;
  has_lead?: boolean;
  mine?: boolean;
  sort?: "name" | "code" | "-member_count" | "-updated_at";
  skip?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ errors */

/** The structured API error (`code`, `details`), shared with the shift and roster clients. */
export { ShiftApiError as TeamApiError };

const STRUCTURED = new Set([400, 404, 409, 422]);

async function request<T>(method: Method, url: string, body?: unknown,
  options: { params?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get") headers[IDEMPOTENCY_HEADER] = options.idempotencyKey ?? newIdempotencyKey();
  let response;
  try {
    response = await http.request<T>({
      method, url, data: body, params: options.params, headers,
      validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
    });
  } catch (error) {
    throw toApiError(error);
  }
  if (response.status >= 300) {
    const data = (response.data ?? {}) as { detail?: unknown; code?: string; issues?: ApiIssue[]; details?: Record<string, unknown> };
    const list = Array.isArray(data.detail) ? (data.detail as { field: string; msg: string }[]) : undefined;
    const message = typeof data.detail === "string" ? data.detail : list ? list.map((d) => d.msg).join(". ") : "Request failed.";
    throw new ShiftApiError(response.status, message, data.code, data.issues ?? [], data.details, list);
  }
  return response.data;
}

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/* ------------------------------------------------------------------ calls */

export const teamsApi = {
  list: (params: TeamListParams = {}) =>
    request<PageOf<Team>>("get", "/teams", undefined, { params: clean({ skip: 0, limit: 25, ...params }) }),
  create: (body: TeamBody, idempotencyKey?: string) => request<Team>("post", "/teams", body, { idempotencyKey }),
  get: (id: number | string) => request<TeamDetail>("get", `/teams/${id}`),
  update: (id: number | string, body: TeamPatchBody, idempotencyKey?: string) =>
    request<Team>("patch", `/teams/${id}`, body, { idempotencyKey }),
  previewArchive: (id: number | string, rowVersion?: number) =>
    request<ArchivePreview>("post", `/teams/${id}/archive`, { dry_run: true, row_version: rowVersion }),
  archive: (id: number | string, body: { confirm_code?: string; row_version?: number }, idempotencyKey?: string) =>
    request<Team>("post", `/teams/${id}/archive`, { ...body, dry_run: false }, { idempotencyKey }),
  members: (id: number | string, params: { state?: string; member_role?: string; q?: string; as_of?: string;
    skip?: number; limit?: number } = {}) =>
    request<PageOf<Membership>>("get", `/teams/${id}/members`, undefined, { params: clean({ limit: 200, ...params }) }),
  candidates: (id: number | string, q: string, effectiveFrom?: string) =>
    request<{ items: MemberCandidate[] }>("get", `/teams/${id}/member-candidates`, undefined,
      { params: clean({ q, effective_from: effectiveFrom }) }),
  addMember: (id: number | string, body: MembershipBody, idempotencyKey?: string) =>
    request<MembershipResult>("post", `/teams/${id}/members`, body, { idempotencyKey }),
  updateMembership: (membershipId: number | string, body: MembershipPatchBody, idempotencyKey?: string) =>
    request<MembershipResult>("patch", `/team-memberships/${membershipId}`, body, { idempotencyKey }),
  mine: () => request<MeTeams>("get", "/me/teams"),
};
