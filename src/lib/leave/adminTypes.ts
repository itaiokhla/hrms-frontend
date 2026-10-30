/**
 * Types of the HR / administrator side of Leave v2 (backend `app/routes/leave_v2.py`, request bodies
 * `app/schemas/leave_v2.py` + `LeaveTypeWriteV2`, plan document `app/payroll/policy_types.py` "LEAVE_PLAN").
 *
 * The plan document is strict on the server: unknown keys are refused, decimals are **strings** ("1.5"), whole
 * numbers are JSON numbers, and every documented default is filled in by the server on save.
 */

/* ------------------------------------------------------------------ access (`GET /leaves/access`) */

export interface LeaveAccess {
  v2_enabled: boolean;
  local_today: string;
  employee_id: number | null;
  /** Permission code → scopes the user holds (only codes held). */
  permissions: Record<string, string[]>;
  /** `leave:manage_policy` at COMPANY. */
  manage_company: boolean;
  half_day_enabled: boolean;
  discussion_enabled: boolean;
  return_enabled: boolean;
  on_behalf_enabled: boolean;
}

/* ------------------------------------------------------------------ leave types (03-leave/01 §3) */

export const LEAVE_CATEGORIES = [
  "ANNUAL", "CASUAL", "SICK", "PARENTAL", "BEREAVEMENT", "MARRIAGE", "STUDY", "CIVIC", "SABBATICAL", "COMP_OFF",
  "FLOATING", "UNPAID", "OTHER",
] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number];
export type LeaveKind = "COMP_OFF" | "FLOATING_HOLIDAY" | "EVENT";
export type LeaveUnit = "DAY" | "HOUR";
export type Sensitivity = "STANDARD" | "SENSITIVE";
export type AbsenceClass = "PLANNED" | "UNPLANNED" | "STATUTORY" | "PROTECTED";

export interface LeaveTypeUsage {
  leaves: number;
  pending_requests: number;
  ledger_rows: number;
  employees_with_balance: number;
  plans: { id: number; name: string }[];
  events: number;
  claims: number;
  encashments: number;
  in_use: boolean;
}

export interface LeaveTypeV2 {
  id: number;
  code: string;
  name: string;
  display_name: string;
  description: string | null;
  kind: LeaveKind | null;
  category: LeaveCategory;
  unit: LeaveUnit;
  sensitivity: Sensitivity;
  absence_class: AbsenceClass;
  counts_toward_absence_score: boolean;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
  counts_non_working_days: boolean;
  allow_half_day: boolean;
  color_token: string | null;
  icon: string | null;
  display_order: number;
  name_i18n: Record<string, string>;
  annual_quota: number;
  row_version: number;
  /** `GET /leaves/v2/types/{id}` only. */
  usage?: LeaveTypeUsage;
}

/** Body of `POST /leaves/v2/types` and `PUT /leaves/v2/types/{id}` (`LeaveTypeWriteV2`, strict). */
export interface LeaveTypeWrite {
  code: string;
  name: string;
  description: string | null;
  kind: LeaveKind | null;
  category: LeaveCategory;
  unit: LeaveUnit;
  sensitivity: Sensitivity | null;
  absence_class: AbsenceClass | null;
  counts_toward_absence_score: boolean | null;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
  counts_non_working_days: boolean;
  allow_half_day: boolean;
  color_token: string | null;
  icon: string | null;
  display_order: number;
  name_i18n: Record<string, string>;
  annual_quota: number;
  /** Lowering SENSITIVE → STANDARD: a reason (10+ characters) and the type code typed to confirm. */
  reason?: string | null;
  confirm_code?: string | null;
}

/** The fields the server freezes once a type is in use (`LEAVE_TYPE_CODE_FROZEN` / `LEAVE_TYPE_FIELD_FROZEN`). */
export const FROZEN_TYPE_FIELDS = ["code", "kind", "unit", "is_unlimited"] as const;

/* ------------------------------------------------------------------ plan document (LEAVE_PLAN) */

/** A decimal string such as "1.5" (never a JSON number). */
export type Dec = string;

export type CycleKind = "CALENDAR_YEAR" | "FISCAL_YEAR" | "ANNIVERSARY" | "CUSTOM";
export interface LeaveCycle {
  kind: CycleKind;
  custom_start: string | null;
}

export type BalanceScope = "CYCLE" | "LOTS" | "EVENT";
export type CountingBasis = "WORKING_DAYS" | "CALENDAR_DAYS" | "CALENDAR_EXCL_HOLIDAYS" | "FIXED_WEEKDAYS";
export type Gender = "FEMALE" | "MALE" | "OTHER" | "UNSPECIFIED";
export type WorkerClass = "EMPLOYEE" | "CONTRACTOR" | "INTERN" | "APPRENTICE";
export type EntitlementMethod = "FRONT_LOADED" | "PERIODIC" | "TENURE_SLABS" | "PER_DAYS_WORKED" | "EVENT_GRANT" | "NONE";
export type Frequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY";
export type EncashTrigger = "EXIT" | "YEAR_END" | "ON_REQUEST";
export type CapPeriod = "MONTH" | "QUARTER" | "CYCLE" | "ROLLING_12M";
export type InstancePeriod = CapPeriod | "LIFETIME";
export type DocumentWhen = "ALWAYS" | "MIN_UNITS" | "MIN_CALENDAR_DAYS" | "BACKDATED" | "ADJACENT_NON_WORKING";
export type AttachmentCategory =
  | "MEDICAL_CERTIFICATE" | "FIT_TO_WORK" | "PARENTAL_EVIDENCE" | "BEREAVEMENT_EVIDENCE" | "MARRIAGE_EVIDENCE"
  | "OFFICIAL_SUMMONS" | "STUDY_EVIDENCE" | "TRAVEL_DOCUMENT" | "SUPPORTING_DOCUMENT";
export type EventType =
  | "EXPECTED_DELIVERY" | "BIRTH" | "ADOPTION_HANDOVER" | "SURROGACY_HANDOVER" | "PREGNANCY_LOSS"
  | "REPRODUCTIVE_PROCEDURE" | "DEATH" | "MARRIAGE" | "PILGRIMAGE" | "SABBATICAL_ELIGIBILITY" | "LONG_ILLNESS" | "OTHER";

export interface LeaveMinTenure {
  value: number;
  unit: "DAYS" | "MONTHS" | "YEARS";
  basis: "SERVICE_START" | "HIRE_DATE" | "CONFIRMATION";
  mode: "BLOCK_USE" | "NO_ENTITLEMENT";
}

export interface LeaveEligibility {
  genders: Gender[] | null;
  unknown_gender: "ELIGIBLE_VERIFY" | "NOT_ELIGIBLE";
  worker_classes: WorkerClass[] | null;
  employment_types: string[] | null;
  countries: string[] | null;
  branch_ids: number[] | null;
  min_fte: Dec | null;
  min_tenure: LeaveMinTenure | null;
}

export interface LeaveTenureSlab {
  from_months: number;
  amount: Dec;
}

export interface LeaveEntitlement {
  method: EntitlementMethod;
  amount: Dec;
  frequency: Frequency | null;
  post_at: "START" | "END" | null;
  per_days_worked: number | null;
  tenure_slabs: LeaveTenureSlab[] | null;
  credit_expiry_months: number | null;
}

export interface LeaveNoticeStep {
  min_units: Dec;
  value: number;
}
export interface LeaveNotice {
  value: number;
  unit: "CALENDAR_DAYS" | "WORKING_DAYS";
  scale: LeaveNoticeStep[];
}
export interface LeaveEmergency {
  enabled: boolean;
  max_units: Dec;
  reason_required: boolean;
}
export interface LeaveCap {
  period: CapPeriod;
  max_units: Dec;
}
export interface LeaveInstanceCap {
  period: InstancePeriod;
  max_requests: number;
}

export interface LeaveRequestRules {
  self_service: boolean;
  on_behalf: boolean;
  portions: "INHERIT" | "FULL_ONLY" | "HOURS_ALLOWED";
  min_units: Dec | null;
  max_units: Dec | null;
  max_consecutive_units: Dec | null;
  caps: LeaveCap[];
  max_instances: LeaveInstanceCap[];
  min_notice: LeaveNotice | null;
  emergency_exception: LeaveEmergency | null;
  backdate_limit_days: number;
  future_limit_days: number;
  clubbing: { not_with: string[]; gap_days: number };
  adjacent_non_working: "ALLOW" | "WARN" | "BLOCK";
  blackouts: "APPLY" | "EXEMPT";
  coverage: "APPLY" | "EXEMPT";
  reason: "OPTIONAL" | "REQUIRED" | "HIDDEN";
}

export interface LeaveDocumentNeed {
  when: DocumentWhen;
  min_units: Dec | null;
  category: AttachmentCategory;
}

export interface LeaveDocuments {
  allowed: boolean;
  required: LeaveDocumentNeed[];
  due: "AT_SUBMIT" | "BEFORE_DECISION" | "WITHIN_DAYS_AFTER_RETURN" | "WITHIN_DAYS_AFTER_SUBMIT";
  due_days: number | null;
  verification: "NONE" | "AFTER_APPROVAL" | "BEFORE_APPROVAL";
}

export interface LeaveEventRules {
  event_types: EventType[];
  entitlement_units: Dec;
  duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "WEEKS";
  earliest_start_offset_days: number;
  take_within_days: number | null;
  max_occurrences: number | null;
}

export interface LeaveTypeRule {
  leave_type_code: string;
  /** System-written: HR may keep or delete a frozen rule, never set the flag. */
  frozen: boolean;
  keep_on_plan_exit: boolean;
  cycle: LeaveCycle | null;
  balance_scope: { kind: BalanceScope };
  counting_basis: { basis: CountingBasis; weekdays: number[] | null };
  eligibility: LeaveEligibility;
  during_probation: "ALLOW" | "ACCRUE_ONLY" | "BLOCK";
  during_notice: "ALLOW" | "BLOCK" | "ALLOW_EXTENDS_LWD";
  entitlement: LeaveEntitlement;
  accrual_cap: Dec | null;
  max_balance: Dec | null;
  proration: { joiner: "PRORATE" | "FULL"; leaver: "PRORATE" | "FULL" };
  rounding: { mode: "NONE_2DP" | "NEAREST_HALF" | "UP_HALF" | "DOWN_HALF" | "NEAREST_QUARTER" | "NEAREST_WHOLE" };
  carry_forward: { cap: Dec | null; expiry_months: number | null };
  encashment: {
    eligible: boolean;
    triggers: EncashTrigger[];
    max_units_per_cycle: Dec | null;
    min_balance_after: Dec | null;
    step: Dec;
  };
  balance_check: "CURRENT" | "PROJECTED";
  insufficient_balance_action: "BLOCK" | "ALLOW_NEGATIVE" | "SPLIT_TO_UNPAID";
  negative_allowance: Dec;
  negative_at_cycle_end: "CARRY_NEGATIVE" | "WRITE_OFF";
  sandwich: { mode: "OFF" | "WEEKLY_OFFS" | "HOLIDAYS" | "BOTH"; half_day_edges: "IGNORE" | "COUNT" };
  request: LeaveRequestRules;
  documents: LeaveDocuments;
  approval: { auto_approve_eligible: boolean };
  change: { cancellation_requires_approval: "INHERIT" | "ALWAYS" | "NEVER"; recall_allowed: boolean };
  event: LeaveEventRules | null;
}

export interface LeaveCreditSlab {
  min_worked_minutes: number;
  units: Dec;
}

export interface LeaveCompOffRules {
  earn_on: ("HOLIDAY" | "WEEKLY_OFF")[];
  claim_window_days: number;
  credit_slabs: LeaveCreditSlab[];
  validity_days: number;
  min_usable_days: number;
  max_units_per_month: Dec | null;
}

export interface LeavePlanFields {
  schema_version: 1;
  defaults: { cycle: LeaveCycle };
  comp_off: LeaveCompOffRules | null;
  types: LeaveTypeRule[];
}

/* ------------------------------------------------------------------ plans (policy framework) */

/** A problem on a plan document: server `issues[]`, `warnings[]` or `details.errors[]`, or a client check. */
export interface PlanIssue {
  code?: string;
  /** Path such as `types[2].request.min_units` (null: the whole plan). */
  field?: string | null;
  message: string;
  severity?: "ERROR" | "WARNING";
  details?: unknown;
}

export interface ActivationRequest {
  hash: string;
  effective_from: string;
  reason: string | null;
  recalc_future_leave: boolean;
}

export type VersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

export interface PlanVersion {
  id: number;
  version: number;
  status: VersionStatus;
  effective_from: string;
  effective_to: string | null;
  fields: LeavePlanFields;
  policy_hash: string | null;
  activated_at: string | null;
  activated_by_user_id: number | null;
  activation_request?: ActivationRequest | null;
  activation_requested_by_user_id?: number | null;
}

export interface AssignmentCriteria {
  everyone?: boolean;
  legal_entity_ids?: number[];
  branch_ids?: number[];
  pay_group_ids?: number[];
  department_ids?: number[];
  grade_ids?: number[];
  employment_types?: string[];
  designation_ids?: number[];
  employee_ids?: number[];
}

export interface AssignmentRule {
  id?: number;
  criteria: AssignmentCriteria;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  status?: string;
}

export interface PlanSummary {
  id: number;
  type: "LEAVE_PLAN";
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  active_version: PlanVersion | null;
  latest_version: number | null;
  draft_versions: number[];
  rule_count: number;
  created_at: string | null;
  head_count?: number;
  head_count_scope?: "COMPANY" | "SCOPED";
}

export interface PlanDetail extends PlanSummary {
  versions: PlanVersion[];
  assignments: AssignmentRule[];
  rule_history: AssignmentRule[];
}

export interface PlanTemplate {
  key: string;
  name: string;
  country: string | null;
  description: string;
  types: string[];
}

export interface PlanCreate {
  name: string;
  description?: string | null;
  effective_from?: string | null;
  template_key?: string | null;
  copy_from_plan_id?: number | null;
  fields?: Partial<LeavePlanFields> | null;
}

export type SavedVersion = PlanVersion & { warnings: PlanIssue[] };

export interface ActivateBody {
  effective_from?: string | null;
  reason?: string | null;
  recalc_future_leave: boolean;
  confirm: boolean;
}

export type ActivateResult =
  | { status: "AWAITING_SECOND_PERSON"; version: number; message: string }
  | (PlanVersion & { message?: string; recalculated_requests?: number });

export interface SimulateEntry {
  leave_type_code: string;
  status: "ELIGIBLE" | "ELIGIBLE_VERIFY" | "ACCRUE_ONLY" | "NOT_ELIGIBLE";
  available_from: string | null;
  this_cycle: string;
  cycle_start: string;
  cycle_end: string;
  unlimited: boolean;
}

export interface SimulateResult {
  policy_id: number;
  version: number;
  date: string;
  employees: { employee_id: number; name: string; types: SimulateEntry[] }[];
  truncated: boolean;
}

/* ------------------------------------------------------------------ setup and cut-over */

export type SetupStepStatus = "DONE" | "TODO" | "OPTIONAL" | "BLOCKED" | "READY";

export interface SetupStep {
  key: string;
  title: string;
  status: SetupStepStatus;
  detail: string;
  link: string;
}

export interface LeaveSetup {
  v2_enabled: boolean;
  state: "LEGACY_V1" | "V2_ACTIVE";
  steps: SetupStep[];
  unassigned: { employee_id: number; status: string }[];
}

export interface ReconcileRow {
  employee_id: number;
  name: string;
  leave_type: string;
  legacy: number;
  v2: number;
  difference: number;
  explained: boolean;
  note: string | null;
  negative: boolean;
}

export interface ReconcileReport {
  employees: number;
  types: number;
  grants_to_post: number;
  differences: ReconcileRow[];
  unexplained: number;
  negative_balances: number;
  year: number;
  v2_enabled: boolean;
}

export interface GoLiveResult {
  status: "V2_ACTIVE";
  grants_posted: number;
  report: ReconcileReport;
}

export interface RollbackResult {
  status: "LEGACY_V1";
  reversed_rows: number;
}

export const GO_LIVE_TEXT = "GO LIVE";
export const ROLL_BACK_TEXT = "ROLL BACK";

/* ------------------------------------------------------------------ rule catalogue */

export type RuleMode = "WARN" | "BLOCK";

export interface Blackout {
  id: number;
  name: string;
  from_date: string;
  to_date: string;
  legal_entity_id: number | null;
  branch_ids: number[] | null;
  department_ids: number[] | null;
  leave_type_codes: string[];
  mode: RuleMode;
  reason: string | null;
  status: "ACTIVE" | "ARCHIVED";
  row_version: number;
}
export type BlackoutWrite = Omit<Blackout, "id" | "row_version">;

export interface CoverageRule {
  id: number;
  name: string;
  department_id: number | null;
  branch_id: number | null;
  team_id: number | null;
  max_absent_count: number | null;
  max_absent_pct: number | null;
  count_pending: boolean;
  mode: RuleMode;
  status: "ACTIVE" | "ARCHIVED";
  row_version: number;
}
/** `max_absent_pct` is a decimal: sent as a string. */
export type CoverageWrite = Omit<CoverageRule, "id" | "row_version" | "max_absent_pct"> & { max_absent_pct: string | null };

export const REASON_APPLIES_TO = ["REJECT", "RETURN", "CANCEL", "RECALL", "ADJUST", "OVERRIDE"] as const;
export type ReasonAppliesTo = (typeof REASON_APPLIES_TO)[number];

export interface ReasonCode {
  id: number;
  code: string;
  label: string;
  applies_to: ReasonAppliesTo;
  counts_as_refused: boolean;
  is_active?: boolean;
}
export interface ReasonCodeWrite {
  code: string;
  label: string;
  applies_to: ReasonAppliesTo;
  counts_as_refused: boolean;
  is_active: boolean;
}

export type ApproverType = "primary_manager" | "skip_level_manager" | "department_head" | "role";

export interface StepCondition {
  leave_type_codes?: string[];
  min_units?: string | number;
  max_units?: string | number;
  legal_entity_ids?: number[];
  sensitivity?: Sensitivity;
}

export interface RouteStep {
  step_order: number;
  approver_type: ApproverType;
  approver_label: string;
  role_id: number | null;
  role_name: string | null;
  min_days: number | null;
  condition: StepCondition;
  sla_hours: number | null;
}

export interface RouteStepWrite {
  approver_type: ApproverType;
  role_id: number | null;
  min_days: number | null;
  condition: StepCondition | null;
  sla_hours: number | null;
}

/** One row of `GET /leaves/settings` (registry `definition_json` + value). */
export interface LeaveSetting {
  key: string;
  type: "bool" | "int" | "decimal" | "string" | "date" | "enum" | string;
  default: unknown;
  label: string;
  help: string;
  constraints: { min?: number | string; max?: number | string; choices?: string[]; regex?: string; max_length?: number; nullable?: boolean; [k: string]: unknown };
  ui: { control?: string; unit?: string; system_written?: boolean; [k: string]: unknown };
  requiresApproval?: boolean;
  value: unknown;
  system_written: boolean;
}

export interface LeaveSettingsResponse {
  settings: LeaveSetting[];
  can_write: boolean;
}

/* ------------------------------------------------------------------ balances and ledger */

export interface BalanceView {
  leave_type_code: string;
  name: string;
  unit: LeaveUnit;
  scope: BalanceScope;
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
  expiring: { units: number; expires_on: string }[];
  frozen: boolean;
  eligibility: string | null;
  available_from: string | null;
  color_token: string | null;
  icon: string | null;
  category: string | null;
  is_paid: boolean;
}

export interface HrBalances {
  date: string;
  v2_enabled: boolean;
  employees: { employee_id: number; name: string; employee_code: string; balances: BalanceView[] }[];
}

export interface EmployeeBalances {
  date: string;
  employee_id: number;
  name: string;
  balances: BalanceView[];
}

export interface LedgerRow {
  id: number;
  leave_type: string;
  delta: number;
  reason: string;
  effective_date: string;
  expires_on: string | null;
  cycle_start: string | null;
  source: string;
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
  source: string;
  note: string | null;
  ref_type: string | null;
  ref_id: number | null;
  cycle: { start: string; end: string | null } | null;
}

export interface AdjustmentBody {
  employee_id: number;
  leave_type: string;
  /** Decimal string, at most 2 places, -366..366, not 0. */
  delta: string;
  effective_date: string;
  reason: string;
  reason_code?: string | null;
  expires_on?: string | null;
}

/* ------------------------------------------------------------------ record leave */

export interface RecordBody {
  employee_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  start_portion: "FULL" | "SECOND_HALF";
  end_portion: "FULL" | "FIRST_HALF";
  reason?: string | null;
}

export interface PreviewIssue {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  details: Record<string, unknown>;
  field?: string;
}

export interface RecordPreview {
  employee_id: number;
  employee_name: string;
  leave_type: string | null;
  leave_type_name: string | null;
  unit: LeaveUnit;
  start_date: string;
  end_date: string;
  days: { date: string; charged: number; charge_reason: string | null; weekly_off: boolean; holiday: boolean }[];
  charged_units: number;
  balance_before: number | null;
  balance_after: number | null;
  unlimited: boolean;
  issues: PreviewIssue[];
  flags: string[];
  blocking: boolean;
  split: { units: number; dates: string[]; leave_type: string | null } | null;
  plan: { id?: number; name?: string } | null;
}

/* ------------------------------------------------------------------ imports */

export type ImportKind = "OPENING_BALANCES" | "BALANCE_ADJUSTMENTS";
export const IMPORT_COLUMNS = ["employee_code", "leave_type", "units", "effective_date", "expires_on", "note"] as const;

export interface ImportRun {
  id: number;
  kind: ImportKind;
  status: "DRY_RUN" | "COMMITTED" | string;
  file_name: string;
  report: { valid: number; errors: { line: number; errors: string[] }[]; error_count: number; posted?: number };
  rows: {
    line: number;
    employee_id: number;
    employee_code: string;
    leave_type: string;
    units: string;
    effective_date: string;
    expires_on: string | null;
    note: string | null;
  }[];
  created_at: string | null;
  committed_at: string | null;
  expires_at: string | null;
}

/* ------------------------------------------------------------------ year end */

export interface YearEndRow {
  employee_id: number;
  name: string;
  leave_type: string;
  cycle_start: string;
  balance: string;
  carry: string;
  encash: string;
  lapse: string;
  carry_expiry_months: number | null;
  policy_version_id: number | null;
}

export interface YearEndRun {
  id: number;
  cycle_end: string;
  status: "DRAFT" | "POSTED" | "REVERSED" | string;
  legal_entity_id: number | null;
  summary: {
    employees: number;
    carry: string;
    encash: string;
    lapse: string;
    negative: number;
    early_preview?: boolean;
    rows?: number;
  } | null;
  rows: YearEndRow[] | null;
  created_by_user_id: number | null;
  posted_by_user_id: number | null;
  posted_at: string | null;
  reversed_at: string | null;
}

/* ------------------------------------------------------------------ documents */

export interface QueueDocument {
  id: number;
  leave_id: number | null;
  category: AttachmentCategory | string;
  sensitivity: string | null;
  original_name: string;
  mime: string;
  bytes: number;
  scan_status: string;
  verification_status: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string | null;
  employee_name: string;
  can_view: boolean;
  can_verify: boolean;
}

/* ------------------------------------------------------------------ reports */

export interface UsageReport {
  start: string;
  end: string;
  by_type: { leave_type: string; name: string; units: number; employees: number | null; suppressed: boolean }[];
  by_month: Record<string, number>;
  pending_requests: number;
}

export interface LiabilityReport {
  date: string;
  rows: { employee_id: number; name: string; leave_type: string; encashable_units: number }[];
  totals: Record<string, number>;
}

/* ------------------------------------------------------------------ lifecycle */

export interface LifecycleDates {
  probation_end_date: string | null;
  confirmation_date: string | null;
  notice_start_date: string | null;
  service_start_date: string | null;
}

/* ------------------------------------------------------------------ labels */

export const CATEGORY_LABEL: Record<LeaveCategory, string> = {
  ANNUAL: "Annual", CASUAL: "Casual", SICK: "Sick", PARENTAL: "Parental", BEREAVEMENT: "Bereavement",
  MARRIAGE: "Marriage", STUDY: "Study", CIVIC: "Civic duty", SABBATICAL: "Sabbatical", COMP_OFF: "Comp-off",
  FLOATING: "Floating holiday", UNPAID: "Unpaid", OTHER: "Other",
};

export const KIND_LABEL: Record<string, string> = {
  "": "Ordinary", COMP_OFF: "Comp-off", FLOATING_HOLIDAY: "Floating holiday", EVENT: "Event (per occurrence)",
};

export const ABSENCE_CLASS_LABEL: Record<AbsenceClass, string> = {
  PLANNED: "Planned", UNPLANNED: "Unplanned", STATUTORY: "Statutory", PROTECTED: "Protected",
};

// Colour tokens (`leave-1..12`, `leave-neutral`) and their CSS-variable colours live in `@/lib/leave/colors`.

/** Icons offered in the type editor (`^[a-z0-9-]+$`, at most 40 characters). */
export const LEAVE_ICONS = [
  "sun", "coffee", "heart-pulse", "baby", "flower-2", "gem", "graduation-cap", "landmark", "plane", "rotate-ccw",
  "calendar-plus", "calendar-x", "tag", "umbrella", "briefcase", "clock",
] as const;
