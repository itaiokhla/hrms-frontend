/**
 * Response shapes of the pay-run endpoints, read from hrms-backend:
 * - app/payroll/routes/runs.py + services/runs.py (`run_json`, `run_population`, `exception_json`, `population_preview`)
 * - app/payroll/routes/run_calculation.py + services/review.py (`summary`, `list_employees`, `employee_detail`,
 *   `variance`, `stale`) and services/calculation.py (`calculate`)
 * - app/payroll/routes/run_approvals.py + services/run_approvals.py (`approvals_of`) and services/finalization.py
 * - app/payroll/routes/overview.py + services/reports.py (`overview_kpis`, `overview_list`)
 * - app/payroll/routes/corrections.py (reversals), payments.py (batches), payslips.py (generation)
 * Amounts are always `{amount: "<decimal string>", currency}` or decimal strings; never numbers.
 */

import type { Money } from "@/lib/money";

export type RunType = "REGULAR" | "OFF_CYCLE" | "RETRO_ADJUSTMENT" | "FINAL_SETTLEMENT" | "REVERSAL";
export type RunEmployeeStatus = "PENDING" | "CALCULATED" | "ERROR" | "ON_HOLD" | "EXCLUDED";
export type ExceptionSeverityDto = "BLOCKING" | "WARNING" | "FLAG";
export type ExceptionStatus = "OPEN" | "FIXED" | "WAIVED" | "DEFERRED";
export type HoldType = "PAYMENT" | "FULL";
export type HoldReason = "ABSCONDING" | "DISPUTE" | "BANK_ISSUE" | "INVESTIGATION" | "OTHER";

export interface ListPage<T> {
  total: number;
  items: T[];
}

export interface PeriodBrief {
  id: number;
  start: string;
  end: string;
  pay_date: string;
  status: string;
  tax_year: string | number | null;
  input_cutoff: string;
  approval_deadline: string;
}

/** Per-currency figures: decimal strings plus the employee count. */
export interface CurrencyFigures {
  gross?: string;
  deductions?: string;
  reimbursements?: string;
  net?: string;
  employer_cost?: string;
  employees?: number;
}

export interface PopulationSummary {
  eligible: number;
  included: number;
  excluded: number;
  on_hold?: number;
  excluded_by_reason: Record<string, number>;
  calculated?: number;
  errors?: number;
  pending?: number;
}

export interface Run {
  id: number;
  number: string;
  label: string;
  run_type: RunType | string;
  status: string;
  stage: number | null;
  legal_entity_id: number;
  pay_group: { id: number; code: string; name: string };
  period: PeriodBrief | null;
  currency: string;
  stale: boolean;
  stale_reasons: Record<string, unknown>[];
  population: Partial<PopulationSummary>;
  totals: Record<string, CurrencyFigures>;
  reverses_run_id: number | null;
  environment: string | null;
  row_version: number;
  created_at: string | null;
  /** Server-computed: actions valid for the state AND the caller's permissions and scope. */
  available_actions: string[];
  exceptions: { open: number; blocking: number };
  // detail only
  selection?: Record<string, unknown>;
  pack_version_ids?: Record<string, unknown>[];
  fx_snapshot_id?: number | null;
  engine_version?: string | null;
  calculation_job_id?: number | null;
  approval_request_id?: number | null;
  prechecked_at?: string | null;
  created_by_user_id?: number | null;
  calculated_by_user_id?: number | null;
  calculated_at?: string | null;
  submitted_by_user_id?: number | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  finalized_by_user_id?: number | null;
  finalized_at?: string | null;
  cancelled_at?: string | null;
  status_reason?: string | null;
}

export interface RunActionResult {
  id: number;
  number: string;
  status: string;
  row_version: number;
}

export interface PopulationItem {
  employee_id: number;
  assignment_id?: number;
  status: string;
  exclusion_reason: string | null;
  note?: string | null;
  employee_code: string | null;
  employee_name: string | null;
}

export interface PopulationPreview {
  eligible: number;
  included: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
  items: PopulationItem[];
}

export interface PrecheckResult extends RunActionResult {
  blocking: number;
  findings: Record<string, number>;
}

export interface CalculateResult {
  run: RunActionResult;
  job: { id: number; status: string };
  employees: number;
  action: "CALCULATE" | "RECALCULATE";
}

export interface RunException {
  id: number;
  run_id: number;
  run_employee_id: number | null;
  employee_id: number | null;
  code: string;
  severity: ExceptionSeverityDto;
  source: string;
  message: string;
  details: Record<string, unknown>;
  resolutions: string[];
  fix_link: string | null;
  waivable: boolean;
  blocks_finalization: boolean;
  status: ExceptionStatus;
  resolved_by_user_id: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  deferred_to: string | null;
  deferred_to_period_id: number | null;
  row_version: number;
}

export interface PackView {
  country: string;
  capability: string;
  verified: boolean;
  versions: { label?: string; is_fixture?: boolean; code?: string; version?: string; [k: string]: unknown }[];
  evaluated: { pack: string; version: string; mode: string; reason: string | null; final: boolean }[];
  labels: string[];
  attestation_id: number | null;
  country_confirmed: boolean;
}

export interface Liability {
  scheme: string;
  payee_authority: string;
  currency: string;
  employee_amount: string;
  employer_amount: string;
  due_date: string | null;
  fixture: boolean;
  label?: string;
}

export interface FxView {
  snapshot_id: number;
  rates: { base: string; quote: string; rate: string; rate_type: string; source: string; as_of: string | null }[];
}

export interface RunSummary {
  run: Run;
  totals: Record<string, CurrencyFigures>;
  population: PopulationSummary;
  reconciles: boolean;
  liabilities: Liability[];
  settings: Record<string, unknown>;
  pack: PackView;
  fx: FxView | null;
  exceptions: { open: number; by_severity: Record<string, number>; by_code: Record<string, number>; variance_pending: number };
  calculation: {
    engine_version: string | null;
    calculated_at: string | null;
    calculated_by_user_id: number | null;
    progress: { job_id: number; status: string; done: number; total: number | null; chunks: Record<string, number>; running: boolean } | null;
    stale: boolean;
    stale_reasons: Record<string, unknown>[];
  };
}

export const EMPLOYEE_FILTERS = ["flags", "errors", "holds", "joiners", "leavers", "variance", "calculated", "excluded"] as const;
export type EmployeeFilter = (typeof EMPLOYEE_FILTERS)[number];

export interface RunEmployeeRow {
  id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  status: RunEmployeeStatus | string;
  exclusion_reason: string | null;
  hold_type: HoldType | null;
  currency: string;
  gross: Money | null;
  deductions: Money | null;
  reimbursements: Money | null;
  net: Money | null;
  employer_cost: Money | null;
  previous_net: Money | null;
  net_change_percent: string | null;
  flags: string[];
  error: { code?: string; message?: string } | null;
  exceptions: { open: number; blocking: number };
  variance_pending: boolean;
  calculated: boolean;
  row_version: number;
}

export interface RunEmployeesPage {
  run_id: number;
  total: number;
  counts: Record<EmployeeFilter, number>;
  items: RunEmployeeRow[];
}

export interface LineSource {
  type?: string;
  id?: number | string;
  link?: string;
  restricted?: boolean;
  [k: string]: unknown;
}

export interface PayrollLineDto {
  id: number;
  component: string;
  component_id: number | null;
  name: string;
  kind: string;
  category: string | null;
  stage: number | string | null;
  amount: Money | null;
  units: string | null;
  rate: string | null;
  period_ref: string | null;
  segment: string | number | null;
  tags: string[];
  visibility: string;
  explanation: string | null;
  trace: Record<string, unknown>;
  sources: LineSource[];
  sort_order: number;
  statutory: boolean;
  fixture: boolean;
  label?: string;
}

export interface LedgerSlotDto {
  slot?: string;
  classification: string;
  rule?: string | null;
  paid?: string | number | null;
  lop?: string | number | null;
  pending?: boolean;
  source?: LineSource | null;
  detail?: string | null;
  leave_type_code?: string | null;
}

export interface LedgerDayDto {
  date: string;
  segment?: string | number | null;
  employed?: boolean;
  slots: LedgerSlotDto[];
  paid?: string | number | null;
  lop?: string | number | null;
  holiday?: { name?: string } | null;
}

export interface LedgerDto {
  days?: LedgerDayDto[];
  totals?: Record<string, unknown>;
  period?: Record<string, unknown>;
}

export interface RunEmployeeDetail {
  run: { id: number; number: string; status: string; currency: string };
  id: number;
  employee: { id: number; code: string | null; name: string | null; hire_date: string | null; termination_date: string | null };
  employee_assignment_id: number | null;
  status: string;
  exclusion_reason: string | null;
  exclusion_note: string | null;
  hold_type: HoldType | null;
  hold: { type?: string; reason_code?: string; note?: string; by_user_id?: number; at?: string } | null;
  error: { code?: string; message?: string } | null;
  currency: string;
  totals: Record<"gross" | "deductions" | "reimbursements" | "net" | "employer_cost", Money | null>;
  previous: { net?: string | null; currency?: string; period_ref?: string | null; components?: Record<string, string> };
  net_change_percent: string | null;
  lines: PayrollLineDto[];
  hidden_lines: number;
  ledger: LedgerDto | null;
  flags: string[];
  exceptions: RunException[];
  snapshot: { id: number; version: number; content_hash: string } | null;
  calc_hash: string | null;
  content_hash: string | null;
  engine_version: string | null;
  calculated_at: string | null;
  row_version: number;
  payments?: Record<string, unknown>[];
}

export interface VarianceEntry {
  previous: string | null;
  current: string;
  change: string | null;
  change_percent: string | null;
  flagged: boolean;
}

export interface VarianceItem {
  run_employee_id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  currency: string;
  previous_period: string | null;
  threshold_percent: string | null;
  net: VarianceEntry;
  components: ({ component: string } & VarianceEntry)[];
  flagged: boolean;
  acknowledged: boolean;
  pending: string[];
  comment_required: boolean;
  acknowledgments: { code: string; by_user_id: number | null; at: string | null; comment: string | null }[];
}

export interface VariancePage {
  run_id: number;
  total: number;
  flagged: number;
  pending: number;
  items: VarianceItem[];
}

export interface StaleInfo {
  run_id: number;
  stale: boolean;
  reasons: Record<string, unknown>[];
  all_employees: boolean;
  employees: { run_employee_id: number; employee_id: number; employee_code: string | null; employee_name: string | null; changes: Record<string, unknown>[] }[];
  actions: { action: "RECALCULATE_SELECTED" | "HANDLE_AS_RETRO" | string; available: boolean; employee_ids?: number[]; reason?: string; endpoint?: string }[];
}

export interface ApprovalDecision {
  id: number;
  run_employee_id: number | null;
  approval_request_id: number | null;
  step_order: number | null;
  approver_user_id: number | null;
  acted_as: string | null;
  on_behalf_of_user_id: number | null;
  decision: "APPROVED" | "REJECTED" | string;
  comment: string | null;
  acted_at: string | null;
  cleared_at: string | null;
  cleared_reason: string | null;
}

export interface RunApprovals {
  run_id: number;
  status: string;
  row_version: number;
  approval_request: { id: number; status: string; current_step: number | null; pending_reason: string | null } | null;
  separation_of_duties: boolean;
  decisions: ApprovalDecision[];
  self_lines_pending: { run_employee_id: number; employee_id: number; approver_user_id: number }[];
}

/** GET /payroll/approvals/{id} (services/approvals.serialize). */
export interface ApprovalRequestDetail {
  id: number;
  status: string;
  current_step: number | null;
  pending_reason: string | null;
  requested_by: string | null;
  steps: { step_order: number; approver_label: string; approver: string | null; status: string; acted_by: string | null; acted_at: string | null; remarks: string | null }[];
  can_act: boolean;
  acting_as: string | null;
}

export interface FinalizationStatus {
  run_id: number;
  status: string;
  label: string;
  row_version: number;
  can_finalize: boolean;
  blockers: { code: string; message: string; reasons?: unknown[] }[];
  self_lines_pending: { run_employee_id: number; employee_id: number; approver_user_id: number }[];
  statutory: { country: string; verified: boolean; packs: { pack: string; version: string; mode: string; reason: string | null; final: boolean }[] };
  finalized_at: string | null;
  finalized_by_user_id: number | null;
}

export interface Attestation {
  id: number;
  legal_entity_id: number;
  schemes: string[];
  effective_from: string;
  effective_to: string | null;
  reason: string;
  evidence_ref: string | null;
  status: "PENDING" | "ACTIVE" | "REVOKED" | string;
  attested_by_user_id: number | null;
  approved_by_user_id: number | null;
  approved_at: string | null;
  row_version: number;
  statement: string;
}

export interface Reversal {
  id: number;
  original_run_id: number;
  reversal_run_id: number | null;
  status: string;
  reason: string;
  selected: boolean;
  preview: Record<string, { gross: Money; net: Money; employees: number }>;
  approvals: { step: number; user_id: number; at: string | null; comment: string | null }[];
  requested_by_user_id: number | null;
  run_employee_ids?: number[];
  employee_ids?: number[];
  decision_note?: string | null;
  finalized_at?: string | null;
  created_at: string | null;
  row_version: number;
}

export interface PaymentBatchBrief {
  id: number;
  reference: string;
  run_id: number;
  method: string;
  currency: string;
  status: string;
  item_count: number;
  total: Money | null;
  sandbox: boolean;
  badge: string | null;
  exclusions: unknown[];
  figures: Record<"intended" | "submitted" | "settled" | "returned" | "failed" | "outstanding", Money | null>;
}

export interface GenerationStatus {
  run_id: number;
  total: number;
  counts: { QUEUED: number; GENERATED: number; FAILED: number };
  failed: { task_id: number; run_employee_id: number; employee: string | null; attempts: number; retries: number; error: string | null }[];
  published: number;
}

/* ------------------------------------------------------------------ overview */

export interface OverviewMoneyRow {
  currency: string;
  /** "Draft" | "Approved" | "Final" (services/reports.run_stage). */
  stage: string;
  gross: string;
  net: string;
  employer_cost: string;
  employees: number;
  runs: number;
}

export interface OverviewDeadline {
  pay_group_id: number;
  pay_group: string;
  period_start: string;
  period_end: string;
  input_cutoff: string;
  approval_deadline: string;
  pay_date: string;
  run: { id: number; number: string; status: string; stage: string } | null;
}

export interface Overview {
  filters: Record<string, string | number>;
  kpis: Record<"eligible" | "with_salary" | "without_salary" | "processed" | "paid" | "on_hold", number>;
  consistency: { eligible_equals_with_plus_without: boolean };
  money: OverviewMoneyRow[];
  converted: {
    currency: string;
    available: boolean;
    date: string;
    totals?: Record<string, Money>;
    label?: string | null;
    issues?: { currency: string; code: string; message: string }[];
    message?: string;
    rates?: { base: string; quote: string; rate: string; source: string; as_of: string }[];
  } | null;
  statutory: { legal_entity_id: number; pack_version: string; watermark: string | null; items: { code: string; label: string; amount: string; currency: string; stage: string }[] }[];
  exceptions: { open: number; blocking: number; by_code: Record<string, number> };
  deadlines: OverviewDeadline[];
  empty_state: "NO_EMPLOYEES" | "NO_SALARIES" | null;
  processing_disabled_reason: string | null;
  definitions: Record<string, string>;
}

export interface OverviewListRow {
  assignment_id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string;
  legal_entity_id: number;
  pay_group_id: number;
  pay_group: string;
  branch_id: number | null;
  currency: string;
  with_salary: boolean;
  processed: boolean;
  paid: boolean;
  on_hold: boolean;
  run_ids: number[];
}

export interface OverviewList {
  kpi: string;
  total: number;
  items: OverviewListRow[];
}

/* ------------------------------------------------------------------ lookups */

export interface EntityOption {
  id: number;
  code: string;
  legal_name: string;
  country_code?: string;
  base_currency?: string;
}

export interface PayGroupOption {
  id: number;
  code: string;
  name: string;
  status?: string;
  legal_entity_id: number | null;
  currency: string;
  pay_frequency?: string;
}

export interface BranchOption {
  id: number;
  name: string;
  legal_entity_id: number | null;
}

export interface PayPeriodOption {
  id: number;
  pay_group_id: number;
  start: string;
  end: string;
  pay_date: string;
  input_cutoff: string;
  approval_deadline: string;
  status: string;
  attendance_start?: string;
  attendance_end?: string;
}
