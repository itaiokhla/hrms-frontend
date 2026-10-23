/**
 * Response shapes of the payroll inputs area, read from the FastAPI routes and services (never guessed):
 *
 * - wage inputs: hrms-backend/app/payroll/services/wage_inputs.py `serialize`, `serialize_import`
 * - approvals: services/approvals.py `serialize`, `action_result`
 * - loans: services/loans.py `serialize`, `_tx_json`, `_action_json`; schedule = time_pay_loans `to_dict`
 * - claims: services/claims.py `serialize`, `_receipt_json`
 * - overtime: services/overtime.py `serialize`
 * - tasks: services/tasks.py `serialize`, `action_result`
 * - arrears proposals and retro runs: services/retro.py `proposal_json`, `line_json`; routes/corrections.py
 *   `_proposal_result`, `_run_result` and the detect / preview payloads
 *
 * Amounts are `{amount: "<decimal string>", currency}` (EC-MON-15); never do Number arithmetic on them.
 */

import type { Money } from "@/lib/money";

export interface ListPage<T> {
  total: number;
  items: T[];
}

/* ------------------------------------------------------------------ wage inputs */

export const WAGE_INPUT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "CONSUMED", "REJECTED", "CANCELLED"] as const;
export type WageInputStatus = (typeof WAGE_INPUT_STATUSES)[number];

export interface WageInputFlag {
  code: string;
  message?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface WageInput {
  id: number;
  employee_id: number;
  legal_entity_id: number;
  pay_group_id: number;
  component_id: number;
  component_code: string;
  amount: Money | null;
  units: string | null;
  rate: string | null;
  currency: string;
  fx_rule: string | null;
  target_period: { id: number | null; start: string; end: string };
  reason: string | null;
  source: string;
  status: WageInputStatus | string;
  recurrence: Record<string, unknown> | null;
  recurrence_parent_id: number | null;
  external_ref: string | null;
  import_id: number | null;
  flags: WageInputFlag[];
  approval_request_id: number | null;
  reserved_by_run_employee_id: number | null;
  consumed_by_run_employee_id: number | null;
  created_by_user_id: number | null;
  submitted_at: string | null;
  decided_at: string | null;
  status_reason: string | null;
  row_version: number;
  created_at: string | null;
}

/** POST /payroll/wage-inputs returns `{items: [_result…]}` (one per recurrence occurrence). */
export interface WageInputResult {
  id: number;
  status: string;
  row_version: number;
  approval_request_id: number | null;
  recurrence_parent_id: number | null;
  flags: string[];
}

export const IMPORT_STATUSES = ["VALIDATED", "INVALID", "COMMITTING", "COMMITTED", "FAILED"] as const;

export interface ImportRow {
  row: number;
  ok: boolean;
  errors: string[];
  employee_code: string | null;
}

export interface WageInputImport {
  id: number;
  file_name: string;
  sha256: string;
  status: (typeof IMPORT_STATUSES)[number] | string;
  row_count: number;
  error_count: number;
  job_id: number | null;
  result: Record<string, unknown> | null;
  created_at: string | null;
  committed_at: string | null;
  rows?: ImportRow[];
}

/* ------------------------------------------------------------------ approvals */

export const APPROVAL_MODULES = [
  "payroll_run",
  "off_cycle",
  "final_settlement",
  "compensation",
  "wage_input",
  "overtime",
  "task",
  "lop",
  "attendance",
  "reimbursement",
  "loan",
  "bank_change",
  "payment_batch",
  "settings",
] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export interface ApprovalStep {
  step_order: number;
  approver_type: string;
  approver_label: string;
  approver: string | null;
  role_id: number | null;
  specific_user_id: number | null;
  status: string;
  acted_by: string | null;
  acted_as: string | null;
  acted_at: string | null;
  remarks: string | null;
}

export interface ApprovalRequest {
  id: number;
  module: ApprovalModule | string;
  module_label: string;
  subject_type: string;
  subject_id: number;
  subject_employee_id: number | null;
  subject_employee_name: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | string;
  current_step: number | null;
  pending_reason: string | null;
  amount: Money | null;
  requested_by_user_id: number | null;
  requested_by: string | null;
  context: Record<string, unknown>;
  created_at: string | null;
  decided_at: string | null;
  steps: ApprovalStep[];
  can_act: boolean;
  acting_as: string | null;
}

/* ------------------------------------------------------------------ loans */

export const LOAN_KINDS = ["LOAN", "ADVANCE"] as const;
export const LOAN_STATUSES = ["PENDING_APPROVAL", "APPROVED", "ACTIVE", "PAUSED", "CLOSED", "REJECTED", "CANCELLED"] as const;

export interface LoanIssue {
  code: string;
  severity?: string;
  message?: string;
  [key: string]: unknown;
}

export interface LoanInstalment {
  number: number;
  principal: string;
  interest: string;
  total: string;
  balance_after: string;
}

export interface LoanSchedule {
  kind: string;
  method: string;
  currency: string;
  principal: string;
  annual_rate_percent: string;
  total_interest: string;
  total_payable: string;
  instalments: LoanInstalment[];
  explanation: string | null;
}

export interface LoanTransaction {
  id: number;
  kind: "DISBURSEMENT" | "INSTALMENT" | "PREPAYMENT" | "WAIVER" | string;
  amount: Money | null;
  schedule_version: number;
  run_employee_id: number | null;
  scheduled: Money | null;
  effective_on: string;
  reference: string | null;
  note: string | null;
  action_id: number | null;
  created_at: string | null;
}

export interface LoanAction {
  id: number;
  action: "PAUSE" | "RESUME" | "RESTRUCTURE" | "PREPAY" | "WAIVE" | string;
  params: Record<string, unknown> | null;
  reason: string | null;
  status: "PENDING_APPROVAL" | "APPLIED" | "REJECTED" | "CANCELLED" | string;
  approval_request_id: number | null;
  requested_by_user_id: number | null;
  decided_at: string | null;
  status_reason: string | null;
  created_at: string | null;
}

export interface Loan {
  id: number;
  employee_id: number;
  legal_entity_id: number;
  pay_group_id: number;
  kind: (typeof LOAN_KINDS)[number] | string;
  principal: Money | null;
  currency: string;
  purpose: string | null;
  tenure: number | null;
  interest: Record<string, unknown> | null;
  status: string;
  balance: Money | null;
  schedule_version: number;
  recover_balance_on_exit: boolean | null;
  application_issues: LoanIssue[];
  approval_request_id: number | null;
  applied_by_user_id: number | null;
  decided_at: string | null;
  disbursed_on: string | null;
  closed_at: string | null;
  status_reason: string | null;
  row_version: number;
  created_at: string | null;
  schedule?: LoanSchedule | null;
  transactions?: LoanTransaction[];
  actions?: LoanAction[];
}

/* ------------------------------------------------------------------ claims */

export const CLAIM_STATUSES = ["SUBMITTED", "APPROVED", "SCHEDULED", "PAID", "REJECTED"] as const;

export interface ClaimReceipt {
  id: number;
  file_name: string;
  sha256: string;
  mime: string;
  bytes: number;
  uploaded_at: string | null;
}

export interface ClaimFlag {
  code: string;
  severity?: string;
  message?: string;
  [key: string]: unknown;
}

export interface FxConversion {
  explanation?: string | null;
  rate?: string | null;
  [key: string]: unknown;
}

export interface Claim {
  id: number;
  employee_id: number;
  legal_entity_id: number;
  pay_group_id: number;
  claim_type: string;
  claim_type_name: string | null;
  taxability: string | null;
  expense_date: string;
  amount: Money | null;
  merchant: string | null;
  description: string | null;
  payout_route: string | null;
  payout: Money | null;
  approved: Money | null;
  fx_conversion: FxConversion | null;
  status: string;
  flags: ClaimFlag[];
  approval_request_id: number | null;
  receipts: ClaimReceipt[];
  paid_ref: string | null;
  decided_at: string | null;
  status_reason: string | null;
  row_version: number;
  created_at: string | null;
}

/* ------------------------------------------------------------------ overtime */

export const OVERTIME_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED"] as const;
export type OvertimeStatus = (typeof OVERTIME_STATUSES)[number];

export interface ApprovalSummary {
  status: string;
  current_step: number | null;
  pending_reason: string | null;
}

export interface OvertimeEntry {
  id: number;
  employee_id: number;
  employee_name: string | null;
  date: string;
  start_at: string | null;
  end_at: string | null;
  minutes_requested: number | null;
  minutes_computed: number | null;
  minutes_approved: number | null;
  bucket: "WORKDAY" | "WEEKLY_OFF" | "HOLIDAY" | null;
  source: "APPROVED_REQUESTS" | "ATTENDANCE_WITH_APPROVAL" | "ATTENDANCE_AUTO" | string;
  status: OvertimeStatus | string;
  comp_off: boolean;
  pre_approval: boolean;
  reason: string | null;
  version: number;
  supersedes_id: number | null;
  approval_request_id: number | null;
  requested_by_user_id: number | null;
  decided_at: string | null;
  consumed_by_run_employee_id: number | null;
  row_version: number;
  created_at: string | null;
  approval?: ApprovalSummary;
}

/* ------------------------------------------------------------------ tasks */

export const TASK_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "DISPUTED", "PAID", "REVERSED"] as const;

export interface TaskAssignee {
  employee_id: number;
  employee_name: string | null;
  split_percent: string;
}

export interface TaskEvidence {
  id: number;
  file_name: string;
  mime: string;
  bytes: number;
  sha256: string;
  uploaded_at: string | null;
}

export interface TaskWarning {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  project: string | null;
  category: string | null;
  task_type: string;
  quantity: string | null;
  accepted_quantity: string | null;
  unit: string;
  /** Null for viewers without payroll:inputs:read or payroll:configuration:read (contract §25, F-42). */
  rate: Money | null;
  /** True when the backend withheld the rate from this viewer. */
  pay_hidden?: boolean;
  due_date: string | null;
  completed_on: string | null;
  status: string;
  external_ref: string | null;
  approval_request_id: number | null;
  approved_on: string | null;
  paid_in_run_id: number | null;
  created_by_user_id: number | null;
  submitted_at: string | null;
  decided_at: string | null;
  reversed_at: string | null;
  status_reason: string | null;
  row_version: number;
  assignees: TaskAssignee[];
  evidence: TaskEvidence[];
  warnings: TaskWarning[] | string[];
  created_at: string | null;
  approval?: ApprovalSummary;
}

/* ------------------------------------------------------------------ arrears proposals (3.5 §12) */

/** app/models/corrections.py ARREARS_STATUSES. */
export const ARREARS_STATUSES = ["PENDING_APPROVAL", "APPROVED", "SETTLED", "REJECTED", "CANCELLED", "SUPERSEDED"] as const;
/** services/retro.py DETECTABLE: the sources a past change can come from. */
export const ARREARS_TRIGGERS = ["COMPENSATION", "ATTENDANCE", "LEAVE", "OVERTIME", "TASK", "SETTING", "POLICY", "INPUT"] as const;
export type ArrearsTrigger = (typeof ARREARS_TRIGGERS)[number];

export interface ArrearsIssue {
  code: string;
  severity?: string;
  message?: string;
}

export interface ArrearsInstalment {
  id: number;
  number: number;
  amount: Money | null;
  status: string;
  settled_run_id: number | null;
  settled_amount: Money | null;
}

/** One component difference; `delta` is in the employee's perspective (> 0 arrears, < 0 recovery). */
export interface ArrearsLine {
  id: number;
  component_code: string;
  kind: string;
  category: string | null;
  tags: string[];
  direction: "ARREARS" | "RECOVERY" | string;
  original: Money | null;
  recalculated: Money | null;
  delta: Money | null;
  period_ref: Record<string, unknown> | null;
  explanation: string | null;
  instalments: ArrearsInstalment[];
}

export interface ArrearsProposal {
  id: number;
  employee_id: number;
  legal_entity_id: number;
  pay_group_id: number;
  original_run_id: number;
  original_run_employee_id: number;
  original_period: { id: number; start: string; end: string };
  currency: string;
  trigger: string;
  trigger_ref: Record<string, unknown>;
  changed_sources: string[];
  base_proposal_id: number | null;
  superseded_by_id: number | null;
  totals: Partial<Record<"arrears" | "recovery" | "net_change", Money>>;
  issues: ArrearsIssue[];
  status: (typeof ARREARS_STATUSES)[number] | string;
  payment_mode: string | null;
  recovery_mode: string | null;
  retro_run_id: number | null;
  approval_request_id: number | null;
  reason: string | null;
  decision_note: string | null;
  engine_version: string | null;
  calc_hash: string | null;
  created_at: string | null;
  decided_at: string | null;
  settled_at: string | null;
  row_version: number;
  /** Only on GET /arrears-proposals/{id}. */
  lines?: ArrearsLine[];
  outstanding?: Money | null;
}

/** Approve / reject: compact action results without amounts (routes/corrections.py `_proposal_result`). */
export interface ArrearsActionResult {
  id: number;
  status: string;
  payment_mode: string | null;
  recovery_mode: string | null;
  row_version: number;
}

export interface ArrearsPreviewLine {
  component_code: string;
  direction: string;
  delta: Money | null;
  original: Money | null;
  recalculated: Money | null;
}

/** POST /arrears-proposals/detect with `preview: true`: nothing is recorded. */
export interface ArrearsPreviewItem {
  run_id: number;
  run_employee_id: number;
  period: { period_id: number; start: string; end: string; run_id: number; run_number: string; run_employee_id: number };
  issues: ArrearsIssue[];
  lines: ArrearsPreviewLine[];
}

/** POST /arrears-proposals/detect without preview: one outcome per finalized period reached. */
export interface ArrearsDetectOutcome {
  run_id: number;
  run_employee_id: number;
  proposal_id: number | null;
  status: string;
  superseded_id: number | null;
  cancelled_id: number | null;
  issues: string[];
}

export interface RetroRunResult {
  id: number;
  number: string;
  run_type: string;
  status: string;
  row_version: number;
}

/* ------------------------------------------------------------------ lookups */

export interface PayGroupOption {
  id: number;
  code?: string;
  name: string;
  status: string;
  legal_entity_id: number | null;
  currency?: string;
}

export interface ComponentOption {
  id: number;
  code: string;
  name: string;
  kind: string;
  status: string;
}

export interface EmployeeOption {
  id: number;
  employee_code: string;
  full_name: string;
}

export interface PayPeriodOption {
  id: number;
  pay_group_id: number;
  start: string;
  end: string;
  pay_date: string;
  status: string;
}
