/**
 * Typed client of the employee / manager leave v2 API (backend app/routes/leave_v2.py, prefix /api/v1/leaves).
 *
 * Every state-changing call sends an `Idempotency-Key`. Errors keep the body's `code`, `issues` (preview findings)
 * and `details`, so forms can show the validator's findings next to the fields. Ledger, comp-off and encashment
 * answer 404 while the tenant has not cut over to leave v2 (`GET /leaves/access` → `v2_enabled`).
 */

import type { Method } from "axios";

import { ApiError, http, toApiError } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";

import type {
  ApprovalsInbox,
  ChangeInput,
  CompOffClaim,
  CompOffPreview,
  DocumentRequest,
  Encashment,
  LeaveAccess,
  LeaveAttachment,
  LeaveChange,
  LeaveDashboard,
  LeaveDetail,
  LeaveIssue,
  LeaveListItem,
  LeaveListQuery,
  LeaveMessage,
  LeavePreview,
  LeaveRequestInput,
  LeaveTypeV2,
  LedgerExplain,
  LedgerRow,
  MyBalances,
  Paged,
  PendingChange,
  TeamCalendar,
} from "./types";

/* ------------------------------------------------------------------ errors */

/** An API error that keeps the body's `issues` and `details`. */
export class LeaveApiError extends ApiError {
  issues: LeaveIssue[];

  constructor(status: number, message: string, code: string | undefined, issues: LeaveIssue[] = [], details?: unknown) {
    super(status, message, code, undefined, details);
    this.issues = issues;
  }
}

const STRUCTURED = new Set([400, 403, 404, 409, 413, 422]);

interface RequestOptions {
  params?: Record<string, unknown>;
  /** false: no Idempotency-Key (reads sent as POST, e.g. the preview). */
  idempotent?: boolean;
}

async function request<T>(method: Method, url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get" && options.idempotent !== false) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
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
  if (response.status >= 300) {
    const data = (response.data ?? {}) as { detail?: unknown; code?: string; issues?: LeaveIssue[]; details?: unknown };
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? (detail as { msg: string }[]).map((d) => d.msg).join(". ")
          : detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string"
            ? (detail as { message: string }).message
            : response.status === 404
              ? "Not found."
              : response.status === 403
                ? "You don't have permission to do that."
                : "Request failed.";
    throw new LeaveApiError(response.status, message, data.code, data.issues ?? [], data.details);
  }
  return response.data;
}

/**
 * What to do next, added after the server's (already readable) message for the conflict codes of 03-leave/01 §8:
 * 409s mean someone else moved first, 422s are plan rules the person can act on.
 */
const CODE_HINTS: Record<string, string> = {
  INVALID_TRANSITION: "Refresh to see where it stands now.",
  PREVIEW_CHANGED: "Refresh and try again.",
  CHANGE_PENDING: "Wait for that decision, or withdraw it first.",
  IDEMPOTENCY_KEY_REUSED: "Refresh to see the result.",
  LEAVE_OVERLAP: "Withdraw or change that leave first.",
  SLOT_CONFLICT: "Ask HR if those dates need correcting.",
  PAST_DATE_CHANGE_NOT_ALLOWED: "Ask HR to make this change.",
  PLAN_NOT_ASSIGNED: "HR needs to assign you a leave plan.",
  COMP_OFF_SOURCE_TAKEN: "Each worked day can be claimed once.",
};

export function leaveErrorMessage(error: unknown): string {
  const e = toApiError(error);
  const hint = e.code ? CODE_HINTS[e.code] : undefined;
  if (!hint) return e.message;
  const message = e.message.trim();
  return `${message}${/[.!?]$/.test(message) ? "" : "."} ${hint}`;
}

export function errorIssues(error: unknown): LeaveIssue[] {
  return error instanceof LeaveApiError ? error.issues : [];
}

/* ------------------------------------------------------------------ calls */

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export const leaveApi = {
  access: () => request<LeaveAccess>("get", "/leaves/access"),
  dashboard: () => request<LeaveDashboard>("get", "/leaves/dashboard"),
  types: () => request<LeaveTypeV2[]>("get", "/leaves/v2/types"),
  myBalances: (date?: string) => request<MyBalances>("get", "/leaves/balances/me", undefined, { params: clean({ date }) }),

  /* requests */
  preview: (body: LeaveRequestInput) => request<LeavePreview>("post", "/leaves/preview", body, { idempotent: false }),
  create: (body: LeaveRequestInput) => request<LeaveDetail>("post", "/leaves/requests", body),
  list: (query: LeaveListQuery = {}) =>
    request<Paged<LeaveListItem>>("get", "/leaves/requests", undefined, { params: clean({ ...query }) }),
  get: (id: number) => request<LeaveDetail>("get", `/leaves/requests/${id}`),
  update: (id: number, body: LeaveRequestInput) => request<LeaveDetail>("put", `/leaves/requests/${id}`, body),
  submit: (id: number) => request<LeaveDetail>("post", `/leaves/requests/${id}/submit`),
  withdraw: (id: number, reason?: string) =>
    request<LeaveDetail>("post", `/leaves/requests/${id}/withdraw`, reason ? { reason } : undefined),
  approve: (id: number, remarks?: string) =>
    request<LeaveDetail>("post", `/leaves/requests/${id}/approve`, { remarks: remarks?.trim() || null }),
  reject: (id: number, remarks: string) =>
    request<LeaveDetail>("post", `/leaves/requests/${id}/reject`, { remarks: remarks.trim() || null }),
  returnForChanges: (id: number, reason: string) =>
    request<LeaveDetail>("post", `/leaves/requests/${id}/return`, { reason: reason.trim() }),
  inbox: () => request<ApprovalsInbox>("get", "/leaves/approvals/inbox"),

  /* changes */
  changes: (id: number) => request<LeaveChange[]>("get", `/leaves/requests/${id}/changes`),
  requestChange: (id: number, body: ChangeInput) => request<LeaveChange>("post", `/leaves/requests/${id}/changes`, body),
  pendingChanges: () => request<PendingChange[]>("get", "/leaves/changes/pending"),
  approveChange: (changeId: number, remarks?: string) =>
    request<LeaveChange>("post", `/leaves/changes/${changeId}/approve`, { remarks: remarks?.trim() || null }),
  rejectChange: (changeId: number, remarks: string) =>
    request<LeaveChange>("post", `/leaves/changes/${changeId}/reject`, { remarks: remarks.trim() || null }),
  withdrawChange: (changeId: number) => request<LeaveChange>("post", `/leaves/changes/${changeId}/withdraw`),
  acknowledgeChange: (changeId: number) => request<LeaveChange>("post", `/leaves/changes/${changeId}/acknowledge`),

  /* discussion and documents */
  messages: (id: number) => request<LeaveMessage[]>("get", `/leaves/requests/${id}/messages`),
  postMessage: (id: number, body: string, internal = false) =>
    request<LeaveMessage>("post", `/leaves/requests/${id}/messages`, { body, internal }),
  attachments: (id: number) => request<LeaveAttachment[]>("get", `/leaves/requests/${id}/attachments`),
  upload: (file: File, category: string, target: { leaveId?: number | null; employeeId?: number | null } = {}) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (target.leaveId) form.append("leave_id", String(target.leaveId));
    if (target.employeeId) form.append("employee_id", String(target.employeeId));
    return request<LeaveAttachment>("post", "/leaves/attachments", form);
  },
  documentRequests: (id: number) => request<DocumentRequest[]>("get", `/leaves/requests/${id}/document-requests`),

  /* balances and ledger (v2) */
  ledger: (query: { leave_type?: string; start?: string; end?: string } = {}) =>
    request<LedgerRow[]>("get", "/leaves/ledger", undefined, { params: clean({ ...query }) }),
  explain: (txnId: number) => request<LedgerExplain>("get", `/leaves/ledger/${txnId}/explain`),

  /* comp-off and encashment (v2) */
  compOffPreview: (workedDate: string) =>
    request<CompOffPreview>("get", "/leaves/comp-off/preview", undefined, { params: { worked_date: workedDate } }),
  compOffClaims: (scope: "mine" | "team" = "mine", status?: string) =>
    request<CompOffClaim[]>("get", "/leaves/comp-off/claims", undefined, { params: clean({ scope, status }) }),
  claimCompOff: (body: { worked_date: string; reason?: string | null }) =>
    request<CompOffClaim>("post", "/leaves/comp-off/claims", body),
  actOnClaim: (id: number, action: "approve" | "reject" | "withdraw", remarks?: string) =>
    request<CompOffClaim>("post", `/leaves/comp-off/claims/${id}/${action}`,
      action === "withdraw" ? undefined : { remarks: remarks?.trim() || null }),
  encashments: (scope: "mine" | "team" = "mine", status?: string) =>
    request<Encashment[]>("get", "/leaves/encashments", undefined, { params: clean({ scope, status }) }),
  requestEncashment: (body: { leave_type: string; units: number; reason?: string | null }) =>
    request<Encashment>("post", "/leaves/encashments", body),
  actOnEncashment: (id: number, action: "approve" | "reject" | "withdraw", remarks?: string) =>
    request<Encashment>("post", `/leaves/encashments/${id}/${action}`,
      action === "withdraw" ? undefined : { remarks: remarks?.trim() || null }),

  /* calendars */
  teamCalendar: (start: string, end: string, departmentId?: number) =>
    request<TeamCalendar>("get", "/leaves/team-calendar", undefined, { params: clean({ start, end, department_id: departmentId }) }),
};

/** Same-origin link to an attachment (the session cookie authorizes it; every download is logged by the server). */
export const attachmentDownloadUrl = (id: number) => `/api/v1/leaves/attachments/${id}/download`;

/* ------------------------------------------------------------------ labels */

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  RETURNED: "Returned",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled",
  PAID: "Paid",
  REVOKED: "Revoked",
};

export const STATUS_TONE: Record<string, "neutral" | "warning" | "info" | "success" | "danger" | "primary"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  RETURNED: "info",
  APPROVED: "success",
  PAID: "success",
  REJECTED: "danger",
  REVOKED: "danger",
  WITHDRAWN: "neutral",
  CANCELLED: "neutral",
};

export const FLAG_LABEL: Record<string, string> = {
  EMERGENCY: "Emergency",
  ELIGIBILITY_VERIFY: "Eligibility to verify",
  BALANCE_CONFLICT: "Balance conflict",
  SPLIT_TO_UNPAID: "Split to unpaid",
};

export const SOURCE_LABEL: Record<string, string> = {
  SELF: "Self",
  ON_BEHALF: "On behalf",
  HR_RECORDED: "HR recorded",
  SYSTEM: "System",
  AGENT: "Agent",
  IMPORT: "Imported",
  BULK: "Bulk",
};

export const CHANGE_LABEL: Record<string, string> = {
  CANCEL: "Cancel",
  PARTIAL_CANCEL: "Cancel some days",
  MODIFY: "Change dates",
  CONVERT: "Change type",
  RECALL: "Recall",
};

export const DOCUMENT_CATEGORIES = [
  "SUPPORTING_DOCUMENT",
  "MEDICAL_CERTIFICATE",
  "FIT_TO_WORK",
  "PARENTAL_EVIDENCE",
  "BEREAVEMENT_EVIDENCE",
  "MARRIAGE_EVIDENCE",
  "OFFICIAL_SUMMONS",
  "STUDY_EVIDENCE",
  "TRAVEL_DOCUMENT",
] as const;

export const categoryLabel = (category: string) =>
  category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, " ");

export const LEDGER_REASON_LABEL: Record<string, string> = {
  OPENING: "Opening balance",
  GRANT: "Entitlement",
  ACCRUAL: "Accrual",
  PRORATE: "Proration",
  CARRY_FORWARD: "Carry forward",
  COMP_OFF: "Comp-off",
  USE: "Leave taken",
  ENCASH: "Encashed",
  LAPSE: "Lapsed",
  EXPIRE: "Expired",
  ADJUST: "Adjustment",
  PENALTY: "Penalty",
};

/** "1 day", "0.5 day", "2.5 days". */
export function units(n: number | null | undefined, unit = "DAY"): string {
  if (n === null || n === undefined) return "—";
  const word = unit === "HOUR" ? "hour" : "day";
  return `${n} ${word}${Math.abs(n) === 1 || Math.abs(n) === 0.5 ? "" : "s"}`;
}

export function portionText(start: string | null | undefined, end: string | null | undefined, sameDay: boolean): string | null {
  if (sameDay) {
    if (end === "FIRST_HALF") return "First half";
    if (start === "SECOND_HALF") return "Second half";
    return null;
  }
  const parts = [];
  if (start === "SECOND_HALF") parts.push("starts mid-day");
  if (end === "FIRST_HALF") parts.push("ends mid-day");
  return parts.length ? parts.join(", ") : null;
}

/** All ISO dates from start to end inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const last = Date.UTC(ye, me - 1, de);
  for (let t = Date.UTC(ys, ms - 1, ds); t <= last && out.length < 400; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Holds a permission at any scope beyond SELF (from `GET /leaves/access`). */
export function accessBeyondSelf(access: LeaveAccess | undefined, code: string): boolean {
  return (access?.permissions?.[code] ?? []).some((s) => s !== "SELF");
}

export function accessHas(access: LeaveAccess | undefined, code: string): boolean {
  return (access?.permissions?.[code] ?? []).length > 0;
}
