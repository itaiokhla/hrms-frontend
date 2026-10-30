/**
 * Typed client of the HR / administrator side of Leave v2 (`/api/v1/leaves/...`, backend `app/routes/leave_v2.py`).
 *
 * - Every state-changing call sends an `Idempotency-Key` (one per logical action, reused by the step-up retry).
 * - `PUT /leaves/v2/types/{id}` sends `If-Match: <row_version>` as a bare integer (the route parses an int header).
 * - Calls that may need a fresh identity check (go-live, rollback, activation, year-end post / reverse, import
 *   commit, large adjustments) run through `withStepUp`: on 403 `STEP_UP_REQUIRED` the shared `StepUpProvider`
 *   prompt opens and the call is retried once.
 * - Errors keep the server's structure: `detail` objects (`{message, field, issues, details}`), validation errors of
 *   the plan document (`details.errors[]`) and top-level `issues` all end up in `LeaveAdminError.issues`.
 */

import type { Method } from "axios";

import { ApiError, http, toApiError } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey, withStepUp } from "@/lib/payroll/api";

import type {
  ActivateBody,
  ActivateResult,
  AdjustmentBody,
  AssignmentRule,
  Blackout,
  BlackoutWrite,
  CoverageRule,
  CoverageWrite,
  EmployeeBalances,
  GoLiveResult,
  HrBalances,
  ImportKind,
  ImportRun,
  LeaveAccess,
  LeaveSettingsResponse,
  LeaveSetup,
  LeaveTypeV2,
  LeaveTypeWrite,
  LedgerExplain,
  LedgerRow,
  LiabilityReport,
  LifecycleDates,
  PlanCreate,
  PlanDetail,
  PlanIssue,
  PlanSummary,
  PlanTemplate,
  PlanVersion,
  LeavePlanFields,
  QueueDocument,
  ReasonCode,
  ReasonCodeWrite,
  ReconcileReport,
  RecordBody,
  RecordPreview,
  RollbackResult,
  RouteStep,
  RouteStepWrite,
  SavedVersion,
  SimulateResult,
  UsageReport,
  YearEndRun,
} from "./adminTypes";

/* ------------------------------------------------------------------ errors */

/** An API error that keeps the structured leave error body. */
export class LeaveAdminError extends ApiError {
  /** Field-level problems: `issues[]`, `details.errors[]` (plan validation) or 422 field errors. */
  issues: PlanIssue[];
  /** The first field the server named (`types[0].entitlement`, `code`…). */
  field?: string;

  constructor(status: number, message: string, code: string | undefined, issues: PlanIssue[], field?: string, details?: unknown) {
    super(status, message, code, undefined, details);
    this.issues = issues;
    this.field = field;
  }
}

const FALLBACK: Record<number, string> = {
  400: "Some values need attention.",
  404: "Not found. It may be outside the people you can see, or available only after go-live.",
  409: "This changed or conflicts with something else. Reload and try again.",
  412: "This changed since you opened it. Reload and try again.",
  422: "Some values need attention.",
};

/** Build a `LeaveAdminError` from a status and a FastAPI error body (`{detail, code, issues?, details?}`). */
export function leaveError(status: number, body: unknown): LeaveAdminError {
  const data = (body && typeof body === "object" ? body : {}) as {
    detail?: unknown;
    code?: string;
    issues?: PlanIssue[];
    details?: unknown;
  };
  const issues: PlanIssue[] = Array.isArray(data.issues) ? [...data.issues] : [];
  let details = data.details;
  let field: string | undefined;
  let message = "";
  const detail = data.detail;
  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail)) {
    const list = detail.filter((d): d is { field: string; msg: string } => !!d && typeof d === "object" && "msg" in d);
    message = list.map((d) => d.msg).join(". ");
    list.forEach((d) => issues.push({ code: data.code, field: d.field, message: d.msg, severity: "ERROR" }));
  } else if (detail && typeof detail === "object") {
    const d = detail as { message?: unknown; field?: unknown; issues?: unknown; details?: unknown };
    message = typeof d.message === "string" ? d.message : "";
    field = typeof d.field === "string" ? d.field : undefined;
    if (Array.isArray(d.issues)) issues.push(...(d.issues as PlanIssue[]));
    if (d.details !== undefined) details = d.details;
    const errors = (d.details as { errors?: unknown } | undefined)?.errors;
    if (Array.isArray(errors)) {
      errors.forEach((e: { field?: string; message?: string }) =>
        issues.push({ code: data.code, field: e.field ?? null, message: e.message ?? "Invalid value", severity: "ERROR" }));
    }
    if (!issues.length && field) issues.push({ code: data.code, field, message, severity: "ERROR" });
  }
  const fallback = FALLBACK[status] ?? (status >= 500 ? "Something went wrong. Please try again." : "Request failed.");
  return new LeaveAdminError(status, message || fallback, data.code, issues, field ?? issues[0]?.field ?? undefined, details);
}

/** Issues of any error (empty for errors without structure). */
export function issuesOf(error: unknown): PlanIssue[] {
  return error instanceof LeaveAdminError ? error.issues : [];
}

export function isStepUpCancelled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "STEP_UP_REQUIRED";
}

/* ------------------------------------------------------------------ request */

const STRUCTURED = new Set([400, 404, 409, 412, 413, 422]);

export interface LeaveRequestOptions {
  params?: Record<string, unknown>;
  /** Sent as `If-Match` (a bare row version: the leave type route parses an integer). */
  ifMatch?: number;
  /** Wrap in the step-up retry (403 STEP_UP_REQUIRED → "Confirm it's you" → retry once). */
  stepUp?: boolean;
  headers?: Record<string, string>;
}

export async function leaveRequest<T>(method: Method, url: string, body?: unknown, options: LeaveRequestOptions = {}): Promise<T> {
  const verb = method.toLowerCase();
  const headers: Record<string, string> = { ...options.headers };
  // One key per logical action: the step-up retry sends the same key (a refused attempt stores nothing).
  if (verb !== "get") headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  if (options.ifMatch !== undefined) headers["If-Match"] = String(options.ifMatch);
  const send = async () => {
    let response;
    try {
      response = await http.request<T>({
        method,
        url,
        data: body,
        params: options.params,
        headers,
        validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
      });
    } catch (error) {
      throw toApiError(error);
    }
    if (response.status >= 300) throw leaveError(response.status, response.data);
    return response.data;
  };
  return options.stepUp ? withStepUp(send) : send();
}

const get = <T>(url: string, params?: Record<string, unknown>) => leaveRequest<T>("get", url, undefined, { params });

/** Drop empty query values. */
function clean(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

/* ------------------------------------------------------------------ calls */

const L = "/leaves";

export const leaveAdminApi = {
  access: () => get<LeaveAccess>(`${L}/access`),

  /* types */
  types: (includeInactive = true) => get<LeaveTypeV2[]>(`${L}/v2/types`, { include_inactive: includeInactive }),
  type: (id: number) => get<LeaveTypeV2>(`${L}/v2/types/${id}`),
  createType: (body: LeaveTypeWrite) => leaveRequest<LeaveTypeV2>("post", `${L}/v2/types`, body),
  updateType: (id: number, body: LeaveTypeWrite, rowVersion: number) =>
    leaveRequest<LeaveTypeV2>("put", `${L}/v2/types/${id}`, body, { ifMatch: rowVersion }),

  /* plans */
  plans: (includeArchived = false) => get<PlanSummary[]>(`${L}/plans`, { include_archived: includeArchived }),
  templates: () => get<PlanTemplate[]>(`${L}/plans/templates`),
  plan: (id: number) => get<PlanDetail>(`${L}/plans/${id}`),
  unassigned: (on?: string) => get<{ employee_id: number; status: string }[]>(`${L}/plans/unassigned`, clean({ on })),
  createPlan: (body: PlanCreate) => leaveRequest<PlanDetail>("post", `${L}/plans`, body),
  patchPlan: (id: number, body: { name?: string; description?: string }) => leaveRequest<PlanDetail>("patch", `${L}/plans/${id}`, body),
  createVersion: (id: number, body?: { fields?: LeavePlanFields; effective_from?: string }) =>
    leaveRequest<PlanVersion>("post", `${L}/plans/${id}/versions`, body ?? {}),
  saveVersion: (id: number, version: number, body: { fields?: LeavePlanFields; effective_from?: string }) =>
    leaveRequest<SavedVersion>("put", `${L}/plans/${id}/versions/${version}`, body),
  activate: (id: number, version: number, body: ActivateBody) =>
    leaveRequest<ActivateResult>("post", `${L}/plans/${id}/versions/${version}/activate`, body, { stepUp: true }),
  assignments: (id: number) => get<{ policy_id: number; type: string; rules: AssignmentRule[] }>(`${L}/plans/${id}/assignments`),
  putAssignments: (id: number, rules: Omit<AssignmentRule, "id" | "status">[]) =>
    leaveRequest<{ policy_id: number; rules: AssignmentRule[] }>("put", `${L}/plans/${id}/assignments`, { rules }),
  archive: (id: number) => leaveRequest<{ id: number; status: string }>("post", `${L}/plans/${id}/archive`),
  simulate: (body: { policy_id: number; version: number; employee_ids?: number[] | null; on?: string | null }) =>
    leaveRequest<SimulateResult>("post", `${L}/plans/simulate`, body),

  /* setup and cut-over */
  setup: () => get<LeaveSetup>(`${L}/setup`),
  reconcile: () => get<ReconcileReport>(`${L}/setup/reconcile`),
  goLive: (confirm: string) => leaveRequest<GoLiveResult>("post", `${L}/setup/go-live`, { confirm }, { stepUp: true }),
  rollback: (confirm: string, reason: string) =>
    leaveRequest<RollbackResult>("post", `${L}/setup/rollback`, { confirm, reason }, { stepUp: true }),

  /* rule catalogue */
  blackouts: (includeArchived = false) => get<Blackout[]>(`${L}/blackouts`, { include_archived: includeArchived }),
  createBlackout: (body: BlackoutWrite) => leaveRequest<Blackout>("post", `${L}/blackouts`, body),
  updateBlackout: (id: number, body: BlackoutWrite) => leaveRequest<Blackout>("put", `${L}/blackouts/${id}`, body),
  coverage: () => get<CoverageRule[]>(`${L}/coverage-rules`),
  createCoverage: (body: CoverageWrite) => leaveRequest<CoverageRule>("post", `${L}/coverage-rules`, body),
  updateCoverage: (id: number, body: CoverageWrite) => leaveRequest<CoverageRule>("put", `${L}/coverage-rules/${id}`, body),
  reasonCodes: (appliesTo?: string) => get<ReasonCode[]>(`${L}/reason-codes`, clean({ applies_to: appliesTo })),
  saveReasonCode: (body: ReasonCodeWrite) => leaveRequest<ReasonCode>("post", `${L}/reason-codes`, body),
  route: () => get<RouteStep[]>(`${L}/approval-route`),
  saveRoute: (steps: RouteStepWrite[]) => leaveRequest<RouteStep[]>("put", `${L}/approval-route`, { steps }),
  settings: () => get<LeaveSettingsResponse>(`${L}/settings`),
  saveSetting: (key: string, value: unknown, reason?: string | null) =>
    leaveRequest<unknown>("put", `${L}/settings/${encodeURIComponent(key)}`, { value, reason: reason || null }),

  /* balances and ledger */
  balances: (params: { search?: string; leave_type?: string; department_id?: number; date?: string } = {}) =>
    get<HrBalances>(`${L}/balances`, clean(params)),
  employeeBalances: (employeeId: number, date?: string) =>
    get<EmployeeBalances>(`${L}/balances/employees/${employeeId}`, clean({ date })),
  ledger: (employeeId: number, params: { leave_type?: string; start?: string; end?: string } = {}) =>
    get<LedgerRow[]>(`${L}/ledger`, clean({ employee_id: employeeId, ...params })),
  explainLedger: (txnId: number) => get<LedgerExplain>(`${L}/ledger/${txnId}/explain`),
  adjust: (body: AdjustmentBody) => leaveRequest<LedgerExplain>("post", `${L}/adjustments`, body, { stepUp: true }),

  /* record leave */
  recordPreview: (body: RecordBody) => leaveRequest<RecordPreview>("post", `${L}/record/preview`, body),
  record: (body: RecordBody) => leaveRequest<{ id: number }>("post", `${L}/record`, body, { stepUp: true }),

  /* imports */
  importUpload: (file: File, kind: ImportKind) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    return leaveRequest<ImportRun>("post", `${L}/imports`, form);
  },
  importGet: (id: number) => get<ImportRun>(`${L}/imports/${id}`),
  importCommit: (id: number) => leaveRequest<ImportRun>("post", `${L}/imports/${id}/commit`, undefined, { stepUp: true }),

  /* year end */
  yearEnds: () => get<YearEndRun[]>(`${L}/year-end`),
  yearEnd: (id: number) => get<YearEndRun>(`${L}/year-end/${id}`),
  previewYearEnd: (body: { cycle_end: string; legal_entity_id?: number | null }) =>
    leaveRequest<YearEndRun>("post", `${L}/year-end`, body),
  postYearEnd: (id: number) => leaveRequest<YearEndRun>("post", `${L}/year-end/${id}/post`, undefined, { stepUp: true }),
  reverseYearEnd: (id: number) => leaveRequest<YearEndRun>("post", `${L}/year-end/${id}/reverse`, undefined, { stepUp: true }),

  /* documents */
  documentsQueue: () => get<QueueDocument[]>(`${L}/documents/queue`),
  verifyDocument: (id: number, approve: boolean, reason?: string | null) =>
    leaveRequest<QueueDocument>("post", `${L}/attachments/${id}/verify`, { approve, reason: reason || null }),
  documentUrl: (id: number) => `${L}/attachments/${id}/download`,

  /* reports */
  usage: (start: string, end: string) => get<UsageReport>(`${L}/reports/usage`, { start, end }),
  liability: (date?: string, legalEntityId?: number) =>
    get<LiabilityReport>(`${L}/reports/liability`, clean({ date, legal_entity_id: legalEntityId })),

  /* lifecycle */
  setLifecycle: (employeeId: number, body: LifecycleDates) =>
    leaveRequest<LifecycleDates & { employee_id: number }>("put", `${L}/employees/${employeeId}/lifecycle`, body),
};
