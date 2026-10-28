import type { PermissionCode, Scope } from "./permissions.generated";

export interface Me {
  user: {
    id: number;
    email: string;
    full_name: string;
    mfa_enabled: boolean;
    permission_version: number;
    last_login_at: string | null;
  };
  company: {
    id: number;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    subscription: { status: string; plan: string; trial_ends_at: string | null; active: boolean };
  };
  employee: {
    id: number;
    employee_code: string;
    first_name: string;
    last_name: string;
    position: string | null;
    department: string | null;
    has_photo: boolean;
  } | null;
  roles: { id: number; name: string; system_key: string | null }[];
  permissions: Partial<Record<PermissionCode, Scope[]>>;
  is_company_admin: boolean;
  registry_version: string;
  /** Version of the company's published brand; differs from the page's when a new brand was published. */
  brand_version?: string;
  /** `me.teams` (X 01 §11): own and led teams on the user's local today; null/absent on a legacy backend. */
  teams?: MeTeams | null;
}

/** `me.teams` / `GET /me/teams` (X 01 §11). `member_count` is only present on `/me/teams`. */
export interface MeTeams {
  member_of: { id: number; name: string; code?: string; primary: boolean }[];
  leads: { id: number; name: string; code?: string; routing: boolean; member_role?: string; member_count?: number }[];
  acting_for: { employee_id: number; name: string | null; until: string }[];
}

export interface Page<T> {
  total: number;
  items: T[];
  skip: number;
  limit: number;
}

export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  position: string | null;
  department_id: number | null;
  department: string | null;
  shift_id: number | null;
  shift: string | null;
  location: string | null;
  hire_date: string | null;
  termination_date: string | null;
  is_active: boolean;
  manager_id: number | null;
  manager_name: string | null;
  has_login: boolean;
  has_photo: boolean;
  face_registered: boolean;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  base_salary?: number | null;
}

export interface Department {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  head_employee_id: number | null;
  head_name: string | null;
  /** Teams are child departments. */
  parent_department_id?: number | null;
  employee_count: number;
}

export interface Shift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  /** Unpaid part of the shift (BUG-AS-22); null = not set. */
  unpaid_break_minutes?: number | null;
  is_flexible: boolean;
  is_active: boolean;
  /* AS-M1 catalogue fields (03-shifts/01 §2.3); the times above are the legacy mirror of the version in force. */
  code?: string;
  kind?: ShiftKind;
  /** `shift-1` … `shift-12`; always shown with the code text, never colour alone. */
  color_token?: string;
  status?: "ACTIVE" | "ARCHIVED";
  legal_entity_id?: number | null;
  branch_id?: number | null;
  description?: string | null;
  row_version?: number;
  half_split_time?: string | null;
  current_version_id?: number | null;
  current_version?: ShiftVersion | null;
}

export type ShiftKind = "FIXED" | "FLEXIBLE" | "OPEN" | "SPLIT";

export interface ShiftSegment {
  kind: "WORK" | "ON_CALL";
  start: string;
  end: string;
  next_day?: boolean | null;
}

export interface ShiftBreakRule {
  kind: "LUNCH" | "REST" | "PERSONAL" | "OTHER";
  mode: "PUNCHED" | "FIXED_WINDOW" | "FLOATING_WINDOW" | "AUTO_DEDUCT";
  minutes: number;
  paid: boolean;
  start?: string | null;
  end?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  next_day?: boolean;
  auto_deduct_after_minutes?: number | null;
}

/** One effective-dated version of a shift (03-shifts/01 §3.2; `serialize_version`). */
export interface ShiftVersion {
  id: number;
  shift_id: number;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  start_time: string | null;
  end_time: string | null;
  segments: ShiftSegment[];
  break_rules: ShiftBreakRule[];
  unpaid_break_minutes: number | null;
  half_split_time: string | null;
  core_start_time: string | null;
  core_end_time: string | null;
  expected_net_minutes: number | null;
  grace_in_minutes: number | null;
  grace_out_minutes: number | null;
  early_in_window_minutes: number;
  late_out_window_minutes: number;
  anchor_timezone: string | null;
  safety_critical: boolean;
  outdoor: boolean;
  long_duty: boolean;
  crosses_midnight: boolean;
  /** Decimal as text ("9.00"). */
  duration_hours: string | null;
  content_hash?: string;
  reason: string | null;
  voided_at: string | null;
  created_at: string | null;
}

/** GET /shifts/{id}: the shift, every version (voided included), live usage and the owner's local today. */
export interface ShiftDetail extends Shift {
  code: string;
  kind: ShiftKind;
  color_token: string;
  status: "ACTIVE" | "ARCHIVED";
  row_version: number;
  versions: ShiftVersion[];
  usage: { rules: number; placements: number };
  owner_today: string;
}

/** Who a shift assignment rule covers (AssignmentCriteria; `everyone` cannot be combined). */
export interface ShiftRuleCriteria {
  legal_entity_ids?: number[] | null;
  branch_ids?: number[] | null;
  pay_group_ids?: number[] | null;
  department_ids?: number[] | null;
  grade_ids?: number[] | null;
  employment_types?: string[] | null;
  designation_ids?: number[] | null;
  employee_ids?: number[] | null;
  everyone?: boolean | null;
}

/** One shift assignment rule (03-shifts/01 §12; `serialize_rule`). Higher priority wins. */
export interface ShiftRule {
  id: number;
  name: string;
  shift_id: number;
  criteria: ShiftRuleCriteria;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  legal_entity_id: number | null;
  status: "ACTIVE" | "INACTIVE";
  reason: string | null;
  replaces_rule_id: number | null;
  team_id_snapshot: number | null;
  row_version: number;
}

export interface OrgNode {
  id: number;
  full_name: string;
  position: string | null;
  department: string | null;
  location: string | null;
  manager_id: number | null;
  report_count: number;
  has_photo: boolean;
}

export interface Delegation {
  id: number;
  delegator_employee_id: number;
  delegator_name: string;
  delegate_employee_id: number;
  delegate_name: string;
  module: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  active: boolean;
  revoked: boolean;
}

export interface SecondaryLine {
  id: number;
  employee_id: number;
  employee_name: string;
  manager_id: number;
  manager_name: string;
  relation_type: "functional" | "project" | "dotted_line";
  effective_from: string;
  effective_until: string | null;
}

export type AttendanceState = "NOT_PUNCHED_IN" | "WORKING" | "ON_LUNCH" | "PUNCHED_OUT";
export type AttendanceAction = "PUNCH_IN" | "LUNCH_IN" | "LUNCH_OUT" | "PUNCH_OUT";
export type LocationMode = "OFF" | "OPTIONAL" | "REQUIRED";
export type TrackingState = "NO_SESSION" | "NOT_APPLICABLE" | "ACTIVE" | "PAUSED" | "STOPPED";
export type ScheduleState = "SCHEDULED" | "DUE" | "OVERDUE";
export type SampleStatus =
  | "CAPTURED"
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED"
  | "ERROR"
  | "MISSED";
export type MovementStatus = "BASELINE" | "WITHIN_RANGE" | "UNCERTAIN" | "LOW_ACCURACY" | "SIGNIFICANT_MOVEMENT_REVIEW";

/** Canonical hours from the server (attendance_hours.compute). */
export interface Hours {
  gross_seconds: number | null;
  lunch_seconds: number;
  break_seconds: number;
  excluded_seconds: number;
  net_seconds: number | null;
  provisional: boolean;
  complete: boolean;
  issues: string[];
}

export interface AttendanceBreak {
  id: number;
  kind: "LUNCH";
  started_at: string;
  ended_at: string | null;
  is_paid: boolean;
  end_reason: string | null;
}

export interface LocationSummary {
  captured: number;
  failed: number;
  missed: number;
  low_accuracy: number;
  movement_flags: number;
  exceptions: number;
  review_pending: number;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee_name: string | null;
  department?: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  /** Net working seconds (attendance minus unpaid breaks). */
  working_seconds: number;
  status: "present" | "absent" | "late" | "half-day";
  source: "self" | "kiosk" | "manual";
  is_manual: boolean;
  face_match_score: number | null;
  notes: string | null;
  attendance_state: AttendanceState;
  closed_reason: string | null;
  hours: Hours;
  breaks: AttendanceBreak[];
  tracking_state: string;
  location: LocationSummary | null;
}

export interface AttendanceEvent {
  id: number;
  event_type: "PUNCH_IN" | "LUNCH_IN" | "LUNCH_OUT" | "PUNCH_OUT" | "SESSION_CLOSED" | "CORRECTION";
  occurred_at: string;
  source: string;
  location_status: "CAPTURED" | "FAILED" | "EXCEPTION" | "NOT_PROVIDED" | "NOT_REQUIRED" | "NOT_APPLICABLE";
  note: string | null;
  face_match_score?: number | null;
}

export interface LocationSampleBrief {
  id: number;
  sample_type: "PUNCH_IN" | "LUNCH_IN" | "LUNCH_OUT" | "PUNCH_OUT" | "PERIODIC";
  status: SampleStatus;
  received_at: string;
  captured_at: string | null;
  accuracy_m: number | null;
  accuracy_class: "PREFERRED" | "ACCEPTABLE" | "LOW" | null;
  movement_status: MovementStatus | null;
  distance_from_punch_in_m: number | null;
  uncertainty_m: number | null;
  is_recovery: boolean;
  slot_due_at: string | null;
  review_status: "PENDING" | "APPROVED" | "REJECTED" | "ACKNOWLEDGED" | null;
  exception_reason: string | null;
  error_message: string | null;
  latitude?: number | null;
  longitude?: number | null;
  redacted?: boolean;
}

export interface CapturePolicy {
  punch: LocationMode;
  lunch: LocationMode;
  exception: "ALLOW_WITH_REASON" | "BLOCK";
  reject_low_accuracy: boolean;
  preferred_accuracy_m: number;
  acceptable_accuracy_m: number;
  timeout_ms: number;
  max_attempts: number;
  max_fix_age_seconds: number;
  retention_days: number;
}

export interface AttendancePolicy {
  version: string;
  require_face: boolean;
  require_face_for_lunch: boolean;
  allow_multiple_lunches: boolean;
  lunch_is_paid: boolean;
  lunch_open_at_punch_out: "CONFIRM_AUTO_CLOSE" | "BLOCK";
  max_shift_hours: number;
  location: CapturePolicy;
  tracking: { enabled: boolean; interval_minutes: number; grace_minutes: number; pause_on_lunch: boolean; movement_threshold_m: number };
}

export interface TrackingStatus {
  attendance_id: number | null;
  state: TrackingState;
  stop_reason: string | null;
  schedule_state: ScheduleState | null;
  next_due_at: string | null;
  grace_until: string | null;
  overdue_since: string | null;
  interval_minutes: number;
  grace_minutes: number;
  missed_count: number;
  pending_missed: number;
  last_capture: LocationSampleBrief | null;
  last_attempt: LocationSampleBrief | null;
  policy_version: string;
  capture: CapturePolicy;
  server_now: string;
  replayed?: boolean;
}

export interface MyAttendance {
  state: "not_checked_in" | "working" | "completed";
  attendance_state: AttendanceState;
  record: AttendanceRecord | null;
  last_session: AttendanceRecord | null;
  events: AttendanceEvent[];
  actions: AttendanceAction[];
  overnight: boolean;
  tracking: TrackingStatus;
  policy: AttendancePolicy;
  server_now: string;
  replayed?: boolean;
}

export interface SessionDetail extends AttendanceRecord {
  events: AttendanceEvent[];
  location_access: boolean;
  samples: LocationSampleBrief[] | null;
  tracking: TrackingStatus;
}

export interface LocationReviewItem extends LocationSampleBrief {
  kind: "EXCEPTION" | "MOVEMENT";
  attendance_id: number;
  employee_id: number;
  employee_name: string;
  date: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface HoursTotals {
  sessions: number;
  complete_sessions: number;
  incomplete_sessions: number;
  provisional_sessions: number;
  gross_seconds: number;
  lunch_seconds: number;
  excluded_seconds: number;
  net_seconds: number;
}

export interface TodaySummary {
  date: string;
  total_employees: number;
  present_today: number;
  absent_today: number;
  on_leave: number;
  working_now: number;
  on_lunch_now: number;
  completed_today: number;
  late_today: number;
  attendance_percentage: number;
  employees: AttendanceRecord[];
}

export interface LeaveStep {
  step_order: number;
  approver_type: string;
  approver_label: string;
  approver: string | null;
  status: "waiting" | "pending" | "approved" | "rejected" | "skipped" | "cancelled";
  acted_by: string | null;
  acted_as: "approver" | "delegate" | "override" | null;
  acted_at: string | null;
  remarks: string | null;
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  number_of_days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  remarks: string | null;
  created_at: string;
  decided_at: string | null;
  steps: LeaveStep[];
  can_act: boolean;
  acting_as: "approver" | "delegate" | "override" | null;
}

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  annual_quota: number;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
}

export interface LeaveBalance {
  name: string;
  is_paid: boolean;
  is_unlimited: boolean;
  total: number;
  used: number;
  pending: number;
  remaining: number | null;
  available: number | null;
}

export interface ChainStep {
  step_order: number;
  approver_type: "primary_manager" | "skip_level_manager" | "department_head" | "role";
  approver_label: string;
  role_id: number | null;
  role_name: string | null;
  min_days: number | null;
}

export interface PayrollRecord {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  salary_month: string;
  basic_salary: number;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  status: "draft" | "approved" | "processed";
  /** ISO 4217 currency of every amount on the row (the employee's legal entity). */
  currency?: string;
  legal_entity_id?: number | null;
  created_by_user_id: number | null;
  approved_by_user_id: number | null;
  created_at: string;
}

export interface PayrollSummary {
  month: string;
  total_employees: number;
  /** Null when rows are in several currencies: unlike currencies are never added together. */
  currency?: string | null;
  mixed_currency?: boolean;
  total_gross_salary: number | null;
  total_deductions: number | null;
  total_net_salary: number | null;
  average_salary: number | null;
  by_currency?: Record<string, { employees: number; gross: number; deductions: number; net: number }>;
  status_breakdown: Record<string, number>;
}

export interface Payslip {
  payroll_id: number;
  employee: { id: number; name: string; employee_code: string; department: string; designation: string };
  salary_month: string;
  salary_components: Record<string, number>;
  gross_salary: number;
  deductions: Record<string, number>;
  total_deductions: number;
  net_salary: number;
  attendance: Record<string, number>;
  status: string;
  currency?: string;
  employer?: {
    legal_name: string;
    code: string;
    country_code: string;
    address: Record<string, string>;
    registration_lines: { label: string; value: string }[];
  } | null;
}

export interface SalaryStructure {
  id: number;
  employee_id: number;
  employee_name: string | null;
  basic_salary: number;
  house_rent_allowance: number;
  dearness_allowance: number;
  conveyance_allowance: number;
  other_allowances: number;
  gross: number;
  effective_from: string;
  effective_to: string | null;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  location: string | null;
  is_optional: boolean;
  description: string | null;
}

export interface Asset {
  id: number;
  asset_tag: string;
  name: string;
  category: string;
  serial_number: string | null;
  status: "in_stock" | "assigned" | "maintenance" | "retired";
  purchase_date: string | null;
  purchase_cost: number | null;
  notes: string | null;
  assignment: {
    id: number;
    employee_id: number;
    employee_name: string | null;
    assigned_at: string;
    acknowledged_at: string | null;
  } | null;
  history?: {
    employee_name: string;
    assigned_at: string;
    acknowledged_at: string | null;
    returned_at: string | null;
    return_condition: string | null;
  }[];
}

export interface RoleGrant {
  permission: PermissionCode;
  scope: Scope;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  system_key: string | null;
  is_system_role: boolean;
  is_protected: boolean;
  is_full_access: boolean;
  member_count: number;
  grants: RoleGrant[];
  can_edit: boolean;
  can_assign: boolean;
}

export interface UserRow {
  id: number;
  email: string;
  full_name: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: { id: number; name: string; is_protected: boolean }[];
  employee: { id: number; full_name: string; employee_code: string; position: string | null; department: string | null } | null;
}

export interface Capability {
  permission: PermissionCode;
  label: string;
  sensitivity: string;
  scopes: Scope[];
  scope_labels: string[];
}

export interface UserDetail extends UserRow {
  access: {
    is_company_admin: boolean;
    capabilities: Record<string, Capability[]>;
    restricted: { permission: string; label: string; module: string }[];
  };
  active_sessions: number;
  assigned_employee_ids: number[];
}

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  action_url: string | null;
  created_at: string;
}

export interface DashboardData {
  sections: string[];
  scope?: "company" | "team";
  headcount?: number;
  me?: {
    attendance: MyAttendance;
    leave_balance: Record<string, LeaveBalance>;
    latest_payslip?: PayrollRecord | null;
  };
  attendance?: TodaySummary;
  attendance_trend?: { date: string; label: string; present: number; absent: number }[];
  recent_activity?: { employee_name: string; type: string; time: string; message: string }[];
  upcoming_leaves?: { employee_name: string; leave_type: string; start_date: string; end_date: string }[];
  pending_approvals: number;
  payroll?: PayrollSummary;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_email: string | null;
  actor_type: string;
  module: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  ip_address: string | null;
}
