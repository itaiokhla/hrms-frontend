/**
 * Calls to the payroll settings and policies API. Writes go through `payrollApi` (shared payroll
 * client): an `Idempotency-Key` per action and structured `detail` bodies (V-01…V-16 issues,
 * 409 `current` values) that the shared `toApiError` would flatten.
 */

import { api } from "@/lib/api";
import { newIdempotencyKey, payrollApi } from "@/lib/payroll/api";

import type {
  AssignmentRule,
  ChangeRequest,
  EditableScope,
  ExplainResponse,
  PolicyDetail,
  PolicyRow,
  PolicyVersion,
  SaveResponse,
  ScopeRef,
  SettingChangeIn,
  ValuesResponse,
} from "./types";

const SETTINGS = "/payroll/settings";
const POLICIES = "/payroll/policies";

export function scopeParams(scope: ScopeRef, asOf?: string): Record<string, string | number> {
  const params: Record<string, string | number> = { scope_type: scope.scope_type };
  if (scope.scope_type !== "TENANT" && scope.scope_id) params.scope_id = scope.scope_id;
  if (asOf) params.as_of = asOf;
  return params;
}

/** Query parameters of GET /payroll/settings/resolve for the selected scope. */
export function resolveParams(key: string, scope: ScopeRef, on?: string): Record<string, string | number> {
  const params: Record<string, string | number> = { key };
  const ids: Record<Exclude<EditableScope, "TENANT">, string> = {
    LEGAL_ENTITY: "legal_entity_id",
    BRANCH: "branch_id",
    PAY_GROUP: "pay_group_id",
  };
  if (scope.scope_type !== "TENANT" && scope.scope_id) params[ids[scope.scope_type]] = scope.scope_id;
  if (on) params.date = on;
  return params;
}

export const settingsApi = {
  values: (scope: ScopeRef, asOf?: string) => api.get<ValuesResponse>(`${SETTINGS}/values`, { params: scopeParams(scope, asOf) }),
  /** One Idempotency-Key per save attempt; a retry of the same attempt may pass it again. */
  save: (changes: SettingChangeIn[], idempotencyKey: string = newIdempotencyKey()) =>
    payrollApi.put<SaveResponse>(`${SETTINGS}/values`, { changes }, { idempotencyKey }),
  resolve: (key: string, scope: ScopeRef, on?: string) =>
    api.get<ExplainResponse>(`${SETTINGS}/resolve`, { params: resolveParams(key, scope, on) }),
  changeRequests: (status: "PENDING" | "APPROVED" | "REJECTED" | "ALL" = "PENDING") =>
    api.get<ChangeRequest[]>(`${SETTINGS}/change-requests`, { params: { status } }),
  decide: (id: number, approve: boolean, comment?: string) =>
    payrollApi.post<{ id: number; status: string; message?: string }>(
      `${SETTINGS}/change-requests/${id}/${approve ? "approve" : "reject"}`,
      comment ? { comment } : {},
    ),
};

export const policiesApi = {
  list: (type: string) => api.get<PolicyRow[]>(POLICIES, { params: { type } }),
  get: (id: number) => api.get<PolicyDetail>(`${POLICIES}/${id}`),
  create: (body: { type: string; name: string; description?: string | null; fields: Record<string, unknown>; effective_from?: string }) =>
    payrollApi.post<PolicyDetail>(POLICIES, body),
  createVersion: (id: number, body: { fields: Record<string, unknown>; effective_from?: string }) =>
    payrollApi.post<PolicyVersion>(`${POLICIES}/${id}/versions`, body),
  updateVersion: (id: number, version: number, body: { fields: Record<string, unknown>; effective_from?: string }) =>
    payrollApi.put<PolicyVersion>(`${POLICIES}/${id}/versions/${version}`, body),
  activate: (id: number, version: number, body: { effective_from?: string; reason?: string }) =>
    payrollApi.post<PolicyVersion & { message?: string }>(`${POLICIES}/${id}/versions/${version}/activate`, body),
  assignments: (id: number) => api.get<{ policy_id: number; type: string; rules: AssignmentRule[] }>(`${POLICIES}/${id}/assignments`),
  putAssignments: (id: number, rules: Omit<AssignmentRule, "id" | "status">[]) =>
    payrollApi.put<{ policy_id: number; type: string; rules: AssignmentRule[] }>(`${POLICIES}/${id}/assignments`, { rules }),
  archive: (id: number) => payrollApi.post<{ id: number; status: string; used_by_runs: boolean }>(`${POLICIES}/${id}/archive`),
};
