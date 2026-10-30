/** Shift changes, swaps, open shifts, availability and skill tags (AS-M6; backend app/routes/shift_requests.py). */
import { http, toApiError } from "./api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "./payroll/api";

/** The API error plus the rule results of a refusal (`issues`: WARN to acknowledge, BLOCK that refused). */
export type RequestError = ReturnType<typeof toApiError> & { issues?: CheckResult[] };

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await run()).data;
  } catch (error) {
    const err = toApiError(error) as RequestError;
    const issues = (error as { response?: { data?: { issues?: CheckResult[] } } }).response?.data?.issues;
    if (issues) err.issues = issues;
    throw err;
  }
}

/** A refusal that only needs the warnings acknowledged (the user may confirm and resend). */
export function warningsToConfirm(error: unknown): CheckResult[] | null {
  const err = error as RequestError;
  return err?.code === "WARNINGS_UNACKNOWLEDGED" && err.issues?.length ? err.issues : null;
}
/** A refusal inside the schedule notice window (e.g. US Fair Workweek): the person must agree to work the shift. */
export function consentToConfirm(error: unknown): { notice_hours?: number } | null {
  const err = error as RequestError & { details?: { notice_hours?: number } };
  return err?.code === "CONSENT_REQUIRED" ? { notice_hours: err.details?.notice_hours } : null;
}
const write = () => ({ headers: { [IDEMPOTENCY_HEADER]: newIdempotencyKey() } });

export type RequestKind = "SWAP" | "DROP" | "RELEASE" | "PICKUP" | "CHANGE";
export type RequestStatus = "PENDING_ACCEPTANCE" | "PENDING_APPROVAL" | "APPROVED" | "DECLINED" | "REJECTED"
  | "CANCELLED" | "EXPIRED" | "SUPERSEDED";

export interface EntryView {
  id: number; shift_date: string; kind: "WORK" | "OFF"; shift_id: number | null; shift_code: string | null;
  custom_start_time: string | null; custom_end_time: string | null; version: number; acknowledged_at: string | null;
}

export interface CheckResult { rule_key: string; severity?: string; message?: string | null; employee_id?: number | null }

export interface ShiftRequest {
  id: number; kind: RequestKind; status: RequestStatus; shift_date: string; counter_date: string | null;
  requester_employee_id: number; requester_name: string | null; target_employee_id: number | null; target_name: string | null;
  entry: EntryView | null; counter_entry: EntryView | null; open_shift_id: number | null;
  requested_change: Record<string, unknown> | null; requested_shift_code: string | null; reason: string | null;
  approval_required: boolean; expires_at: string | null; submitted_at: string; accepted_at: string | null;
  decided_at: string | null; decision_note: string | null; applied_publication_id: number | null; close_reason: string | null;
  checks: CheckResult[];
  can?: { accept: boolean; decline: boolean; withdraw: boolean; approve: boolean; reject: boolean };
}

export interface Coworker { employee_id: number; name: string; eligible: boolean; cell: EntryView | null; note: string | null }

export interface RequestPreview {
  kind: RequestKind; approval_required: boolean; cutoff_at: string | null; results: CheckResult[]; blocking: CheckResult[];
}

export interface OpenShift {
  id: number; shift_date: string; shift_id: number | null; shift_code: string | null; custom_start_time: string | null;
  custom_end_time: string | null; branch_id: number; team_id: number | null; site_id: number | null;
  required_count: number; filled_count: number; status: "OPEN" | "FILLED" | "CANCELLED" | "EXPIRED";
  source: "MANUAL" | "RELEASED" | "UNCOVERED"; approval_required: boolean; required_tags: string[];
  priority_until: string | null; posted_at: string; expires_at: string; filled_at: string | null; note: string | null;
  released_by_employee_id: number | null; pending_claims: number; row_version: number;
  can_claim?: boolean; reasons?: string[]; warnings?: string[]; my_claim?: { id: number; status: RequestStatus } | null;
  /** Detail only, for planners and approvers (§6.5): the claims by claim time and the instance's net minutes. */
  claims?: OpenShiftClaim[]; scheduled_minutes?: number | null;
}

/** §6.5 ranking inputs of one claim (display only; the approver chooses, D-AS-68). */
export interface ClaimRanking {
  week_hours_before: number; week_hours_after: number; worst_severity: string; tags: string[]; in_priority_group: boolean;
}

export type OpenShiftClaim = ShiftRequest & { ranking?: ClaimRanking };

export interface Availability {
  id: number; employee_id: number; employee_name: string | null; kind: "UNAVAILABLE" | "PREFERRED"; weekday: number | null;
  start_date: string; end_date: string | null; start_time: string | null; end_time: string | null; note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decided_at: string | null; row_version: number;
}

export interface SkillTag { id: number; code: string; name: string; status: string; holders: number }

export interface RequestBody {
  kind: Exclude<RequestKind, "PICKUP">; entry_id: number; target_employee_id?: number; counter_entry_id?: number;
  requested_change?: { shift_id?: number; custom_start_time?: string; custom_end_time?: string };
  reason?: string; acknowledged_warnings?: string[];
}

export interface KindRules { enabled: boolean; cutoff_hours: number; approval_required: boolean; max_per_period?: number | null;
  pay_effect?: "PAID_OFF" | "LEAVE_REQUIRED" | null }

export interface ShiftRequestSettings {
  requests_enabled: boolean;
  open_shifts_enabled: boolean;
  /** shift.roster.planner_cannot_publish (EC AS-ROS-11): the last draft saver cannot publish. */
  planner_cannot_publish: boolean;
  /** shift.roster.publish_requires_approval (§5.2): rosters go to a publisher for approval. */
  publish_requires_approval: boolean;
  policy_id: number | null;
  policy_legacy: boolean;
  requests: { swap: KindRules; drop: KindRules; release: KindRules; pickup_approval_required: boolean;
    change_enabled: boolean; change_cutoff_hours: number };
  open_shift_eligibility: { same_team: boolean; same_branch: boolean; priority: "NONE" | "EXISTING_PART_TIME_FIRST"; exclusive_window_hours: number };
  availability: { enabled: boolean; change_notice_days: number; approval_required: boolean };
  acknowledge_published_shifts: boolean;
  can_manage: boolean;
}

export const shiftRequestsApi = {
  settings: () => call(() => http.get<ShiftRequestSettings>("/shift-requests/settings")),
  saveSettings: (body: Partial<Omit<ShiftRequestSettings, "policy_id" | "policy_legacy" | "can_manage">> & { reason?: string }) =>
    call(() => http.put<ShiftRequestSettings>("/shift-requests/settings", body, write())),
  list: (box: "mine" | "incoming" | "approvals", status?: string) =>
    call(() => http.get<{ items: ShiftRequest[] }>("/shift-requests", { params: { box, status } })),
  get: (id: number) => call(() => http.get<ShiftRequest>(`/shift-requests/${id}`)),
  coworkers: (entryId: number, kind: "SWAP" | "DROP") =>
    call(() => http.post<{ coworkers: Coworker[] }>("/shift-requests/preview", { kind, entry_id: entryId })),
  preview: (body: RequestBody) => call(() => http.post<RequestPreview>("/shift-requests/preview", body)),
  create: (body: RequestBody) => call(() => http.post<ShiftRequest>("/shift-requests", body, write())),
  accept: (id: number, acknowledged: string[] = [], consentGiven = false) =>
    call(() => http.post<ShiftRequest>(`/shift-requests/${id}/accept`,
      { acknowledged_warnings: acknowledged, consent_given: consentGiven }, write())),
  decline: (id: number, note?: string) => call(() => http.post<ShiftRequest>(`/shift-requests/${id}/decline`, { note }, write())),
  withdraw: (id: number) => call(() => http.post<ShiftRequest>(`/shift-requests/${id}/withdraw`, {}, write())),
  approve: (id: number, note?: string, acknowledged: string[] = []) =>
    call(() => http.post<ShiftRequest>(`/shift-requests/${id}/approve`, { note, acknowledged_warnings: acknowledged }, write())),
  reject: (id: number, note: string) => call(() => http.post<ShiftRequest>(`/shift-requests/${id}/reject`, { note }, write())),

  /** `eligible_only` defaults to true on the server for employees (SP-AS-045); false also lists shifts they can't take.
   * List key `roster.open_shifts` (saved views store from, to, status, eligible_only). */
  openShifts: (from?: string, to?: string, status?: string, eligibleOnly?: boolean) =>
    call(() => http.get<{ items: OpenShift[]; can_post: boolean; from: string; to: string }>("/open-shifts",
      { params: { from, to, status, eligible_only: eligibleOnly } })),
  openShift: (id: number) => call(() => http.get<OpenShift>(`/open-shifts/${id}`)),
  postOpenShift: (body: { branch_id: number; shift_date: string; shift_id?: number; custom_start_time?: string;
    custom_end_time?: string; required_count: number; required_tags?: string[]; approval_required: boolean;
    exclusive_window_hours?: number; source?: "MANUAL" | "UNCOVERED"; note?: string }) =>
    call(() => http.post<OpenShift>("/open-shifts", body, write())),
  claim: (id: number, acknowledged: string[] = [], reason?: string, consentGiven = false) =>
    call(() => http.post<ShiftRequest>(`/open-shifts/${id}/claim`,
      { acknowledged_warnings: acknowledged, reason, consent_given: consentGiven }, write())),
  cancelOpenShift: (id: number) => call(() => http.post<OpenShift>(`/open-shifts/${id}/cancel`, {}, write())),

  myAvailability: () => call(() => http.get<{ items: Availability[] }>("/me/availability")),
  addAvailability: (body: { kind: "UNAVAILABLE" | "PREFERRED"; weekday?: number | null; start_date: string;
    end_date?: string | null; start_time?: string | null; end_time?: string | null; note?: string }) =>
    call(() => http.post<Availability>("/me/availability", body, write())),
  cancelAvailability: (id: number) => call(() => http.post<Availability>(`/me/availability/${id}/cancel`, {}, write())),
  teamAvailability: (status?: string) => call(() => http.get<{ items: Availability[] }>("/availability", { params: { status } })),
  decideAvailability: (id: number, decision: "approve" | "reject") =>
    call(() => http.post<Availability>(`/availability/${id}/${decision}`, {}, write())),

  tags: () => call(() => http.get<{ items: SkillTag[] }>("/skill-tags")),
  createTag: (code: string, name: string) => call(() => http.post<SkillTag>("/skill-tags", { code, name }, write())),
  acknowledge: (entryId: number) =>
    call(() => http.post<{ entry_id: number; acknowledged_at: string }>(`/me/schedule/entries/${entryId}/acknowledge`, {}, write())),
};

/** Saved-views list key of the open-shift board (backend `saved_views.LIST_KEYS`, IG-AS-160). */
export const OPEN_SHIFTS_LIST_KEY = "roster.open_shifts";

export const OPEN_SHIFT_STATUS_LABEL: Record<OpenShift["status"], string> = {
  OPEN: "Open", FILLED: "Filled", CANCELLED: "Cancelled", EXPIRED: "Expired",
};

export const KIND_LABEL: Record<RequestKind, string> = {
  SWAP: "Swap", DROP: "Give away", RELEASE: "Release to pool", PICKUP: "Pick up", CHANGE: "Change",
};

export const STATUS_LABEL: Record<RequestStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  PENDING_ACCEPTANCE: { label: "Waiting for coworker", tone: "info" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  DECLINED: { label: "Declined", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Withdrawn", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

/** Plain-language text for a check or refusal reason (peer-side facts are already masked by the API). */
export const REASON_TEXT: Record<string, string> = {
  PEER_NOT_AVAILABLE: "Not available for this swap",
  MIN_REST_VIOLATION: "Too little rest between shifts",
  SHIFT_OVERLAP: "Overlaps another shift",
  DOUBLE_SHIFT: "A second shift that day",
  WEEKLY_HOURS_EXCEEDED: "Too many hours that week",
  UNAVAILABLE: "Marked unavailable then",
  TAG_MISSING: "Missing a required skill",
  TAG_EXPIRED: "A required skill has expired",
  PRIORITY_WINDOW: "Offered to priority staff first",
  LEAVE: "On leave that day",
  BRANCH: "Works at another branch",
  TEAM: "Not in this team",
  SELF: "Your own shift",
  EMPLOYMENT: "Not employed then",
  GIVER_SALARIED: "Salaried staff apply for leave instead",
  OWN_LEAVE: "You are on leave that day",
};

export function reasonText(code: string): string {
  return REASON_TEXT[code] ?? code.replace(/_/g, " ").toLowerCase();
}
