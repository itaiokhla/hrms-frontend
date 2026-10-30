/**
 * Types of the leave v2 API (backend app/routes/leave_v2.py, services leave_requests / leave_ledger / leave_changes /
 * leave_docs / leave_comp_off / leave_encashment / leave_reports). Numbers come as JSON numbers (``_num``: integers
 * or two-decimal floats); dates are ISO ``YYYY-MM-DD``. Statuses of the v2 fields are UPPER_SNAKE.
 */

export type LeaveStatusV2 = "DRAFT" | "PENDING" | "RETURNED" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";
export type IssueSeverity = "ERROR" | "WARNING" | "INFO";
export type StartPortion = "FULL" | "SECOND_HALF";
export type EndPortion = "FULL" | "FIRST_HALF";
export type LeaveSource = "SELF" | "ON_BEHALF" | "HR_RECORDED" | "SYSTEM" | "AGENT" | "IMPORT" | "BULK";
export type LeaveAction = "EDIT" | "SUBMIT" | "WITHDRAW" | "APPROVE" | "REJECT" | "RETURN" | "CHANGE";
export type ChangeKind = "CANCEL" | "PARTIAL_CANCEL" | "MODIFY" | "CONVERT" | "RECALL";
export type ChangeStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface Paged<T> {
  total: number;
  items: T[];
  skip: number;
  limit: number;
}

/** `GET /leaves/access` — what the signed-in user may do and the tenant's state. */
export interface LeaveAccess {
  v2_enabled: boolean;
  local_today: string;
  employee_id: number | null;
  /** Permission code → scopes held (only codes the user holds). */
  permissions: Record<string, string[]>;
  manage_company: boolean;
  half_day_enabled: boolean;
  discussion_enabled: boolean;
  return_enabled: boolean;
  on_behalf_enabled: boolean;
}

/** `GET /leaves/v2/types` (type_json). */
export interface LeaveTypeV2 {
  id: number;
  code: string;
  name: string;
  display_name: string;
  description: string | null;
  kind: string;
  category: string | null;
  unit: string;
  sensitivity: string;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
  counts_non_working_days: boolean;
  allow_half_day: boolean;
  color_token: string | null;
  icon: string | null;
  display_order: number;
}

export interface ExpiringLot {
  units: number;
  expires_on: string;
}

/** BalanceView.json() (leave_ledger). */
export interface LeaveBalance {
  leave_type_code: string;
  name: string;
  unit: string;
  scope: "CYCLE" | "LOTS" | string;
  unlimited: boolean;
  cycle_start: string | null;
  cycle_end: string | null;
  opening: number;
  credited: number;
  used: number;
  encashed: number;
  lapsed: number;
  expired: number;
  adjusted: number;
  balance: number;
  pending: number;
  reserved_encashment: number;
  available: number | null;
  expiring: ExpiringLot[];
  frozen: boolean;
  eligibility: string | null;
  available_from: string | null;
  color_token: string | null;
  icon: string | null;
  category: string | null;
  is_paid: boolean;
}

export interface MyBalances {
  date: string;
  v2_enabled: boolean;
  balances: LeaveBalance[];
}

/** One day of a preview (leave_charging.DayCharge.json()). */
export interface PreviewDay {
  date: string;
  requested: string;
  portion: string;
  charged: number;
  /** WORKING | BASIS | SANDWICH, or null when the day is not charged. */
  charge_reason: string | null;
  working_portion: string;
  employed: boolean;
  weekly_off: boolean;
  holiday: string | null;
  holiday_type: string | null;
}

export interface LeaveIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
}

export interface DocumentNeed {
  category: string;
  due: string;
  due_date: string | null;
}

/** `POST /leaves/preview` (Preview.json()). */
export interface LeavePreview {
  employee_id: number;
  employee_name: string;
  leave_type: string | null;
  leave_type_name: string | null;
  unit: string;
  start_date: string;
  end_date: string;
  start_portion: StartPortion;
  end_portion: EndPortion;
  days: PreviewDay[];
  charged_units: number;
  balance_before: number | null;
  balance_after: number | null;
  unlimited: boolean;
  issues: LeaveIssue[];
  flags: string[];
  blocking: boolean;
  split: { units: number; dates: string[]; leave_type: string | null } | null;
  documents_required: DocumentNeed[];
  plan: Record<string, unknown> | null;
  auto_approve: boolean;
  reason_rule: "REQUIRED" | "OPTIONAL" | "HIDDEN" | string;
  documents_allowed: boolean;
}

/** Body of preview / create / update (schemas.leave_v2.LeaveRequestIn). */
export interface LeaveRequestInput {
  leave_type: string;
  start_date: string;
  end_date: string;
  start_portion?: StartPortion;
  end_portion?: EndPortion;
  reason?: string | null;
  employee_id?: number | null;
  is_emergency?: boolean;
  draft?: boolean;
  attachment_ids?: number[];
  contact_note?: string | null;
}

export interface ApprovalStep {
  step_order: number;
  approver_type: string;
  approver_label: string;
  approver: string | null;
  status: string;
  acted_by: string | null;
  acted_as: string | null;
  acted_at: string | null;
  remarks: string | null;
}

export interface LeaveDayRow {
  date: string;
  portion: string;
  units: number;
  counted: boolean;
  charge_reason: string | null;
}

export interface LeaveSibling {
  id: number;
  leave_type: string;
  number_of_days: number;
  status: string;
}

/** `GET /leaves/requests/{id}` (leave_requests.detail). */
export interface LeaveDetail {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  number_of_days: number;
  start_portion: StartPortion;
  end_portion: EndPortion;
  cancellation_status: string | null;
  reason: string | null;
  /** Legacy lower-case status; use `status_v2`. */
  status: string;
  remarks: string | null;
  created_at: string;
  decided_at: string | null;
  steps: ApprovalStep[];
  can_act: boolean;
  acting_as: string | null;
  status_v2: LeaveStatusV2;
  version: number;
  source: LeaveSource | string;
  flags: string[];
  issues: LeaveIssue[];
  is_emergency: boolean;
  parent_leave_id: number | null;
  submitted_at: string | null;
  leave_type_name: string;
  color_token: string | null;
  masked: boolean;
  row_version: number;
  contact_note: string | null;
  allowed_actions: LeaveAction[];
  siblings: LeaveSibling[];
  days: LeaveDayRow[];
  /** A deleted draft (withdraw of a DRAFT). */
  deleted?: boolean;
}

/** One row of `GET /leaves/requests`. */
export interface LeaveListItem {
  id: number;
  employee_id: number;
  employee_name: string | null;
  leave_type: string;
  leave_type_name: string;
  color_token: string | null;
  start_date: string;
  end_date: string;
  start_portion: StartPortion;
  end_portion: EndPortion;
  number_of_days: number;
  status: LeaveStatusV2;
  source: string;
  flags: string[];
  parent_leave_id: number | null;
  cancellation_status: string | null;
  created_at: string | null;
}

export interface LeaveListQuery {
  scope?: "mine" | "team" | "all";
  status?: LeaveStatusV2 | "";
  employee_id?: number;
  start?: string;
  end?: string;
  skip?: number;
  limit?: number;
}

/** change_json (leave_changes). */
export interface LeaveChange {
  id: number;
  leave_id: number;
  employee_id: number;
  kind: ChangeKind;
  status: ChangeStatus;
  proposed: Record<string, unknown>;
  reason: string | null;
  initiator: "EMPLOYEE" | "EMPLOYER" | string;
  from_version: number;
  decision_note: string | null;
  units_delta: number;
  created_at: string | null;
  decided_at: string | null;
  applied_at: string | null;
  acknowledged_at: string | null;
  row_version: number;
  can_decide?: boolean;
}

/** `GET /leaves/changes/pending` / inbox `changes`. */
export interface PendingChange extends LeaveChange {
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  number_of_days: number;
}

export interface ChangeInput {
  kind: ChangeKind;
  proposed: Record<string, unknown>;
  reason?: string | null;
}

export interface LeaveMessage {
  id: number;
  kind: string;
  visibility: "PARTICIPANTS" | "APPROVERS_HR" | string;
  body: string;
  reason_code?: string | null;
  author: string | null;
  author_user_id?: number | null;
  mine: boolean;
  created_at: string | null;
  details?: Record<string, unknown> | null;
}

export interface LeaveAttachment {
  id: number;
  leave_id: number | null;
  category: string;
  sensitivity: "GENERAL" | "MEDICAL" | string;
  original_name: string;
  mime: string;
  bytes: number;
  scan_status: string;
  verification_status: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string | null;
  can_view?: boolean;
  can_verify?: boolean;
}

export interface DocumentRequest {
  id: number;
  leave_id: number;
  category: string;
  due_date: string;
  status: string;
  note: string | null;
  fulfilled_attachment_id: number | null;
}

/** An inbox request (leave_service.serialize + flags, issues, source, type name, colour). */
export interface InboxRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string | null;
  leave_type: string;
  leave_type_name: string;
  color_token: string | null;
  start_date: string;
  end_date: string;
  number_of_days: number;
  start_portion: StartPortion;
  end_portion: EndPortion;
  cancellation_status: string | null;
  reason: string | null;
  status: string;
  remarks: string | null;
  created_at: string;
  decided_at: string | null;
  steps: ApprovalStep[];
  can_act: boolean;
  acting_as: string | null;
  flags: string[];
  issues: LeaveIssue[];
  source: string;
}

export interface CompOffClaim {
  id: number;
  employee_id: number;
  employee_name: string | null;
  worked_date: string;
  source: string;
  worked_minutes: number;
  credit_units: number;
  leave_type: string;
  status: string;
  reason: string | null;
  decision_note: string | null;
  expires_on: string | null;
  created_at: string | null;
  row_version: number;
  can_decide?: boolean;
}

export interface CompOffPreview {
  worked_date: string;
  source: "HOLIDAY_WORK" | "WEEKLY_OFF_WORK" | string;
  worked_minutes: number;
  credit_units: number;
  leave_type: string;
  expires_on: string;
  holiday: string | null;
}

export interface Encashment {
  id: number;
  employee_id: number;
  employee_name: string | null;
  leave_type: string;
  units: number;
  trigger: string;
  status: string;
  reason: string | null;
  decision_note: string | null;
  cycle_start: string | null;
  payroll_reference: string | null;
  paid_at: string | null;
  created_at: string | null;
  decided_at: string | null;
  row_version: number;
  can_decide?: boolean;
}

export interface ApprovalsInbox {
  requests: InboxRequest[];
  changes: PendingChange[];
  comp_off_claims: CompOffClaim[];
  encashments: Encashment[];
}

export interface CalendarLeave {
  /** null when the viewer only sees "Away" (no access to the request). */
  id: number | null;
  start_date: string;
  end_date: string;
  start_portion: StartPortion | null;
  end_portion: EndPortion | null;
  status: "APPROVED" | "PENDING" | string;
  label: string;
  color_token: string | null;
  leave_type: string | null;
}

export interface CalendarPerson {
  employee_id: number;
  name: string;
  is_me: boolean;
  department_id: number | null;
  leaves: CalendarLeave[];
}

export interface TeamCalendar {
  start: string;
  end: string;
  people: CalendarPerson[];
  away_by_day: Record<string, number>;
  visibility: string;
}

export interface LeaveDashboard {
  date: string;
  balances: LeaveBalance[];
  upcoming: { id: number; start_date: string; end_date: string; status: string; leave_type: string; units: number } | null;
  approvals_waiting: number;
  comp_off_claims_waiting: number;
  away_today: { name: string; label: string }[];
  v2_enabled: boolean;
}

export interface LedgerRow {
  id: number;
  leave_type: string;
  delta: number;
  reason: string;
  effective_date: string;
  expires_on: string | null;
  cycle_start: string | null;
  source: string | null;
  ref_type: string | null;
  ref_id: number | null;
  note: string | null;
  created_at: string | null;
}

export interface LedgerExplain {
  id: number;
  reason: string;
  explanation: string;
  delta: number;
  effective_date: string;
  key: string;
  source: string | null;
  note: string | null;
  ref_type: string | null;
  ref_id: number | null;
  cycle: { start: string; end: string | null } | null;
}
