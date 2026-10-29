/**
 * Attendance requests, on-duty / remote work, muster and the module-neutral approvals inbox (AS-M4, G-13;
 * docs/attendance-shift/04-attendance/04-regularization-requests-approvals.md). Thin typed wrappers over the API —
 * every rule (windows, limits, routing, SoD) is enforced by the server; the UI only explains its answers.
 */
import { api } from "./api";

export type RequestKind = "MISSED_PUNCH" | "ADD_SESSION" | "CORRECTION" | "VOID_SESSION" | "MARK_EXCUSE" | "STATUS_OVERRIDE";
export type RequestMode = "SELF" | "ON_BEHALF" | "DIRECT";
export type RequestStatus = "DRAFT" | "PENDING" | "RETURNED" | "APPROVED" | "REJECTED" | "CANCELLED" | "SUPERSEDED";

export const KIND_LABELS: Record<RequestKind, string> = {
  MISSED_PUNCH: "Missed punch",
  ADD_SESSION: "Add a session",
  CORRECTION: "Correct times",
  VOID_SESSION: "Remove a session",
  MARK_EXCUSE: "Excuse late / early",
  STATUS_OVERRIDE: "Mark the day",
};

export const STATUS_TONE: Record<RequestStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  DRAFT: "neutral", PENDING: "warning", RETURNED: "info", APPROVED: "success", REJECTED: "danger",
  CANCELLED: "neutral", SUPERSEDED: "neutral",
};

/** Server error codes of this area mapped to sentences a person can act on (§16). */
export const ERROR_TEXT: Record<string, string> = {
  REQUEST_KIND_DISABLED: "This kind of request is not available here.",
  REQUEST_LIMIT_REACHED: "The request limit for this period is used up.",
  REQUEST_WINDOW_CLOSED: "Requests for this date are closed. Ask HR to correct it.",
  ATTENDANCE_PERIOD_CLOSED: "Attendance for this cycle was closed. Ask HR to correct it.",
  ATTENDANCE_REQUEST_OPEN: "A request for this is already open.",
  SELF_EDIT_FORBIDDEN: "You cannot correct your own attendance.",
  SELF_DECISION_FORBIDDEN: "You cannot decide a request about yourself or one you filed.",
  REQUEST_STALE: "This day changed since the request was filed.",
  TIMEZONE_REQUIRED: "Times need a time zone.",
  SESSION_OVERLAP: "This time overlaps another session.",
  NOT_ELIGIBLE: "This request does not apply to this day.",
  ON_DUTY_OVERLAP: "Leave or on-duty already covers these dates.",
};

export interface ReasonCode {
  code: string;
  label: string;
  applies_to: string[];
  requires_attachment: boolean;
  counts_toward_limit: boolean;
  sensitive: boolean;
}

export interface FormSession { id: number; in: string | null; out: string | null; source: string; row_version: number }

export interface RequestFormContext {
  employee_id: number;
  employee_name: string;
  work_timezone: string;
  date: string;
  kinds: RequestKind[];
  sessions: FormSession[];
  day: DaySummary | null;
  payroll_state: "OPEN" | "INPUT_LOCKED" | "FINALIZED";
}

export interface DaySummary {
  day_result: string;
  evaluation_state: string;
  version: number;
  net_minutes: number | null;
  late_mark: boolean;
  late_excused: boolean;
  early_mark: boolean;
  early_excused: boolean;
  exception_codes: string[];
}

export interface Issue { code: string; message: string; severity: "BLOCKING" | "WARNING"; details?: Record<string, unknown> }

export interface LimitUsage {
  limit_index: number;
  kinds: string[];
  period: string;
  used: number;
  limit: number | null;
  window_from: string;
  window_to: string;
  reached: boolean;
}

export interface RoutePreview {
  route_key: string | null;
  steps: { step_order: number; approver_type: string; label: string; approvers: (string | null)[] }[];
  sla_hours: number;
}

export interface RequestPreview {
  issues: Issue[];
  limit_usage: LimitUsage[];
  payroll_state: { state: string; message: string | null };
  route_preview: RoutePreview | null;
  evaluation_before: DaySummary | null;
  minutes: number;
}

export interface ApprovalStep {
  step_order: number;
  approver_type: string;
  approver_label: string;
  approver: string | null;
  status: string;
  acted_by: string | null;
  acted_at: string | null;
  remarks: string | null;
  due_at: string | null;
}

export interface AttendanceRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  shift_date: string;
  kind: RequestKind;
  kind_label: string;
  mode: RequestMode;
  status: RequestStatus;
  summary: string;
  reason_code: string;
  reason_label: string;
  comment: string | null;
  minutes: number;
  issues: { code: string; used?: number; limit?: number }[];
  decision_remarks: string | null;
  row_version: number;
  version: number;
  created_at: string | null;
  approval: { id: number; status: string; route_key: string | null; due_at: string | null; can_act: boolean;
    pending_reason: string | null; steps?: ApprovalStep[] | null } | null;
  allowed_actions: string[];
  attachments?: { id: number; file_name: string | null; hidden: boolean; sensitivity: string }[];
}

export interface OnDutyRow {
  id: number;
  employee_id: number;
  employee_name: string | null;
  date: string;
  portion: string;
  kind: "ON_DUTY" | "REMOTE_WORK";
  status: string;
  reason: string;
  reason_code: string | null;
  batch_id: string | null;
  start_time: string | null;
  end_time: string | null;
  row_version: number;
}

export interface InboxItem {
  id: number;
  module: string;
  module_label: string;
  subject_type: string;
  subject_id: number;
  subject_employee_name: string | null;
  status: string;
  current_step: number | null;
  pending_reason: string | null;
  created_at: string | null;
  can_act: boolean;
  steps: ApprovalStep[];
  subject: (Partial<AttendanceRequest> & Partial<OnDutyRow> & { summary?: string; dates?: string[] }) | null;
}

export interface MusterRow {
  employee_id: number;
  name: string;
  employee_code: string | null;
  work_timezone: string;
  sessions: { id: number; in: string | null; out: string | null; source: string }[];
  expected_portion: string | null;
  day_result: string | null;
  evaluation_state: string | null;
  open_requests: number;
}

export const MUSTER_MARKS = ["IN_OUT", "PRESENT", "HALF_DAY", "ABSENT", "IDLE"] as const;
export type MusterMark = (typeof MUSTER_MARKS)[number];
export const MUSTER_LABELS: Record<MusterMark, string> = {
  IN_OUT: "Times", PRESENT: "Present", HALF_DAY: "Half day", ABSENT: "Absent", IDLE: "Idle (rain / stoppage)",
};

export const requestsApi = {
  form: (date: string, mode: RequestMode, employeeId?: number | null) =>
    api.get<RequestFormContext>("/attendance/requests/form", { params: { date, mode, employee_id: employeeId ?? undefined } }),
  reasons: (kind: string) => api.get<{ items: ReasonCode[] }>("/attendance/reason-codes", { params: { kind } }),
  preview: (body: Record<string, unknown>) => api.post<RequestPreview>("/attendance/requests/preview", body),
  create: (body: Record<string, unknown>) => api.post<AttendanceRequest>("/attendance/requests", body),
  list: (params: Record<string, unknown>) => api.get<{ total: number; items: AttendanceRequest[] }>("/attendance/requests", { params }),
  get: (id: number) => api.get<AttendanceRequest>(`/attendance/requests/${id}`),
  withdraw: (id: number) => api.post<AttendanceRequest>(`/attendance/requests/${id}/withdraw`, {}),
  submit: (id: number) => api.post<AttendanceRequest>(`/attendance/requests/${id}/submit`, {}),
  upload: (file: File, employeeId?: number | null) => {
    const form = new FormData();
    form.append("file", file);
    if (employeeId) form.append("employee_id", String(employeeId));
    return api.post<{ id: number; file_name: string; bytes: number }>("/attendance/attachments", form);
  },
  inbox: (params: Record<string, unknown>) => api.get<{ total: number; items: InboxItem[] }>("/approvals", { params }),
  counts: () => api.get<{ counts: Record<string, number>; total: number }>("/approvals/counts"),
  decide: (id: number, body: { decision: "APPROVE" | "REJECT" | "RETURN"; remarks?: string; expected_step?: number | null }) =>
    api.post(`/approvals/${id}/decide`, body),
  decideBulk: (body: { request_ids: number[]; decision: "APPROVE" | "REJECT"; remarks?: string; module?: string }) =>
    api.post<{ results: { id: number; result: string; message?: string }[]; applied: number }>("/approvals/decide-bulk", body),
  onDuty: (params: Record<string, unknown>) => api.get<{ items: OnDutyRow[] }>("/attendance/on-duty", { params }),
  fileOnDuty: (body: Record<string, unknown>) => api.post<{ dates: { date: string; portion: string }[];
    skipped_dates: { date: string; reason: string }[]; route_preview?: RoutePreview; rows?: OnDutyRow[] }>("/attendance/on-duty", body),
  cancelOnDuty: (id: number) => api.post<OnDutyRow>(`/attendance/on-duty/${id}/cancel`, {}),
  muster: (params: { date: string; team_id?: number; branch_id?: number }) =>
    api.get<{ date: string; rows: MusterRow[] }>("/attendance/muster", { params }),
  submitMuster: (body: Record<string, unknown>) =>
    api.post<{ results: { employee_id: number; status: string; code?: string; message?: string }[]; applied: number; refused: number }>(
      "/attendance/muster", body),
};
