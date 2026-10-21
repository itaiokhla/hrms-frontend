/**
 * Compensation v2 DTOs, mirrored from the real FastAPI services (never guessed):
 * - components: hrms-backend/app/payroll/services/components.py (version_json, component_json, run_tester, validate_formula)
 * - structures: hrms-backend/app/payroll/services/structures.py (template_json, version_json, line_dicts, breakdown,
 *   validate_lines, move_assignments)
 * - compensation: hrms-backend/app/payroll/services/compensation.py (assignment_json, list_compensation,
 *   employee_compensation, compare, import_dry_run, import_commit, get_import)
 * - revision cycles: hrms-backend/app/payroll/services/revisions.py (cycle_json)
 *
 * Money is always `{amount: "<decimal string>", currency}`; nothing here is a JS number of money.
 */

import type { Money } from "@/lib/money";
import type { JobDto } from "@/lib/payroll/api";

/* ------------------------------------------------------------------ catalogue constants (models/compensation.py) */

export const COMPONENT_KINDS = ["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION", "REIMBURSEMENT", "BENEFIT_IN_KIND", "INFORMATIONAL", "ROUNDING"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const CATEGORIES_BY_KIND: Record<ComponentKind, readonly string[]> = {
  EARNING: ["BASE", "FIXED_ALLOWANCE", "VARIABLE", "OVERTIME", "HOLIDAY_PREMIUM", "SHIFT_PREMIUM", "TASK_EARNING", "COMMISSION", "BONUS", "RETRO_ADJUSTMENT", "LEAVE_ENCASHMENT", "GRATUITY", "SEVERANCE"],
  DEDUCTION: ["TAX", "EMPLOYEE_CONTRIBUTION", "LOAN_REPAYMENT", "ADVANCE_RECOVERY", "VOLUNTARY", "PENALTY_IF_LEGAL", "GARNISHMENT_IF_LEGAL", "RECOVERY"],
  EMPLOYER_CONTRIBUTION: ["EMPLOYER_CONTRIBUTION", "BENEFIT"],
  REIMBURSEMENT: ["REIMBURSEMENT"],
  BENEFIT_IN_KIND: ["BENEFIT"],
  INFORMATIONAL: ["INFO"],
  ROUNDING: ["ROUNDING"],
};

export const CALC_METHODS = ["FIXED", "PERCENT_OF", "FORMULA", "RATE_X_UNITS", "SLAB", "INPUT", "BALANCING", "SYSTEM"] as const;
export type CalcMethod = (typeof CALC_METHODS)[number];
export const PRORATIONS = ["NONE", "BY_PAID_DAYS", "BY_PAID_HOURS", "BY_EMPLOYMENT_DAYS"] as const;
export const PRORATION_BASES = ["CALENDAR_DAYS", "WORKING_DAYS", "FIXED_30", "FIXED_26", "CUSTOM_DAYS", "HOURS"] as const;
export const FREQUENCIES = ["EVERY_PERIOD", "SPECIFIC_MONTHS", "ONE_TIME", "ON_EXIT"] as const;
export const VISIBILITIES = ["EMPLOYEE_VISIBLE", "HR_ONLY"] as const;
export const ROUNDING_MODES = ["HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEILING", "FLOOR"] as const;
export const TAXABILITY = ["TAXABLE", "EXEMPT", "PARTIAL"] as const;
export const STRUCTURE_TYPES = ["CTC_BASED", "GROSS_BASED", "NET_BASED", "HOURLY", "DAILY", "TASK_BASED"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];
export const ASSIGNMENT_REASONS = ["HIRE", "REVISION", "PROMOTION", "TRANSFER", "CORRECTION"] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];
export const CYCLE_METHODS = ["PERCENT", "FIXED_AMOUNT", "PER_ROW", "MATRIX"] as const;
export type CycleMethodType = (typeof CYCLE_METHODS)[number];

/* ------------------------------------------------------------------ components */

export interface ComponentVersion {
  id: number;
  version: number;
  name: string;
  translations: Record<string, string>;
  description: string | null;
  calc_method: CalcMethod | string;
  formula: string | null;
  params: Record<string, unknown>;
  tags: string[];
  proration: string | null;
  proration_basis: string | null;
  frequency: { type: string; months?: number[] } | null;
  taxability: Record<string, string> | null;
  totals_flags: Record<string, boolean> | null;
  cap: Record<string, unknown> | null;
  floor: Record<string, unknown> | null;
  rounding: string | null;
  eligibility: string | null;
  payslip: { group?: string; order?: number; show_if_zero?: boolean; show_rate_column?: boolean; label_override?: string };
  visibility: string | null;
  gl: { debit_account?: string; credit_account?: string; allocate_by_cost_center?: boolean } | null;
  reporting_codes: Record<string, string>;
  input_approval_above: Money | null;
  effective_from: string;
  effective_to: string | null;
  status: "ACTIVE" | "SUPERSEDED" | string;
  created_by_user_id: number | null;
  created_at: string;
}

export interface PayComponent {
  id: number;
  code: string;
  kind: ComponentKind | string;
  category: string;
  /** "COMPANY" or a country pack code. */
  owner: string;
  read_only: boolean;
  status: "ACTIVE" | "ARCHIVED" | string;
  stage: number;
  name: string;
  current_version: ComponentVersion | null;
  /** Detail only. */
  in_use?: boolean;
  versions?: ComponentVersion[];
  /** After a create or a new version. */
  warnings?: FormulaIssue[];
}

export interface FormulaIssue {
  code: string;
  message: string;
  severity?: string;
  /** 0-based character offsets into the formula. */
  position?: number | null;
  end?: number | null;
  path?: string[] | null;
}

/** POST /payroll/components/validate-formula */
export interface FormulaCheck {
  type: string | null;
  components: string[];
  rates: string[];
  tags: string[];
  inputs: string[];
  history: string[];
  variables: string[];
  tables: string[];
  functions: string[];
  dependencies: string[];
  errors: FormulaIssue[];
  warnings: FormulaIssue[];
  node_count: number;
  valid: boolean;
  canonical: string | null;
}

/** POST /payroll/components/{code}/test */
export interface TesterResult {
  ok: boolean;
  formula: string;
  /** Money as {amount, currency}; numbers/dates as strings; booleans. */
  value: Money | string | boolean | null;
  type?: string | null;
  error: FormulaIssue | null;
  errors?: FormulaIssue[];
  references: Record<string, string>;
  steps: string[];
  warnings: FormulaIssue[];
  source: { type: "SAMPLE" | "EMPLOYEE"; employee_id?: number; period?: { start: string; end: string }; compensation_id?: number | null; assumptions?: string[] };
}

/* ------------------------------------------------------------------ structures */

export interface StructureLine {
  id?: number;
  component_id?: number;
  component: string;
  kind?: string;
  category?: string;
  method: string | null;
  value: string | null;
  formula: string | null;
  params: Record<string, unknown>;
  overridable: boolean;
  override_min: string | null;
  override_max: string | null;
  display_order: number | null;
}

export interface TestVector {
  name: string;
  pay_basis_amount: string;
  expected: Record<string, string>;
  overrides?: Record<string, string>;
}

export interface StructureIssue {
  code: string;
  severity?: string;
  message: string;
  component?: string | null;
  path?: string[] | null;
  position?: number | null;
  minimum_pay_basis?: Money;
  vectors?: string[];
  [key: string]: unknown;
}

export interface VectorResult {
  name: string;
  passed: boolean;
  error?: string;
  mismatches: { component: string; expected: string; actual: string | null }[];
  issues?: StructureIssue[];
}

/** POST /salary-structures/{id}/validate (and stored as version.validation after publish). */
export interface ValidationReport {
  structure_id?: number;
  version?: number;
  ok: boolean;
  currency: string | null;
  errors: StructureIssue[];
  warnings: StructureIssue[];
  minimum_pay_basis: Money | null;
  vectors: VectorResult[];
  balancing?: { component: string; range: { min: string; max: string } } | null;
  validated_at?: string;
}

export interface Eligibility {
  legal_entity_ids?: number[];
  pay_group_ids?: number[];
  grade_ids?: number[];
  employment_type_ids?: number[];
}

export interface StructureVersion {
  id: number;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | string;
  eligibility: Eligibility;
  test_range: { min: string; max: string } | null;
  test_vectors: TestVector[];
  validation: ValidationReport | null;
  effective_from: string | null;
  row_version: number;
  created_by_user_id: number | null;
  published_by_user_id: number | null;
  published_at: string | null;
  created_at: string;
  lines?: StructureLine[];
}

export interface SalaryStructure {
  id: number;
  code: string;
  name: string;
  description: string | null;
  type: StructureType | string;
  currency: string | null;
  status: "ACTIVE" | "ARCHIVED" | string;
  active_version: number | null;
  draft_version: number | null;
  eligibility: Eligibility;
  /** version number -> assignments (ACTIVE, SCHEDULED, PENDING_APPROVAL) */
  assignment_counts: Record<string, number>;
  versions?: StructureVersion[];
}

export interface Explanation {
  [key: string]: unknown;
}

export interface BreakdownLine {
  component: string;
  kind: string;
  method?: string | null;
  monthly: Money | null;
  annual: Money | null;
  explanation: string | Explanation | null;
}

export interface StatutoryLine {
  component: string;
  kind: string;
  monthly: Money;
  annual: Money;
  verified: boolean;
  fixture: boolean;
  explanation: string | Explanation | null;
}

export type TotalKey = "gross" | "deductions" | "employer_contributions" | "reimbursements" | "ctc" | "net_estimate";

/** structures.breakdown(): preview, employee package, compare before/after. */
export interface Breakdown {
  currency: string;
  periods_per_year: number;
  lines: BreakdownLine[];
  totals: Partial<Record<TotalKey, { monthly: Money; annual: Money }>>;
  statutory: { lines: StatutoryLine[]; verified: boolean; label: string; note: string };
  issues: StructureIssue[];
  ok: boolean;
  structure?: { id: number; code: string; name: string; type: string };
  version?: number;
  pay_basis_amount?: Money;
}

export interface MovePreviewResult {
  dry_run: boolean;
  to_version: number;
  effective_from: string;
  items: CompareResult[];
  count: number;
  created?: number[];
}

/* ------------------------------------------------------------------ compensation */

export interface StructureRef {
  id: number;
  code: string;
  name: string;
  type: string;
  version: number;
  version_id: number;
  version_status: string;
}

export interface Assignment {
  id: number;
  employee_id: number;
  assignment_id: number;
  structure: StructureRef;
  pay_basis_amount: Money;
  currency: string;
  fx_rule: Record<string, unknown> | null;
  effective_from: string;
  effective_to: string | null;
  reason: string;
  status: string;
  note: string | null;
  split_period: boolean;
  previous_assignment_id: number | null;
  revision_cycle_id: number | null;
  legacy_salary_structure_id: number | null;
  row_version: number;
  created_by_user_id: number | null;
  approved_by_user_id: number | null;
  approved_at: string | null;
  created_at: string;
  approval_request_id?: number | null;
  overrides?: Record<string, Record<string, string>>;
  warnings?: { code: string; message: string; grade_range?: GradeRange }[];
  grade_range?: GradeRange;
  change?: { from_assignment_id: number; pay_basis_before: Money; change_pct: string | null } | null;
}

export interface EmployeeRef {
  id: number;
  employee_code: string;
  name: string;
}

export interface Placement {
  assignment_id?: number;
  legal_entity?: { id: number; code: string; name: string };
  pay_group?: { id: number; code: string; name: string; currency: string } | null;
}

export type CompensationFilter = "with" | "without" | "scheduled" | "pending" | "draft";

export interface CompensationListItem extends Placement {
  employee: EmployeeRef;
  compensation: Assignment | null;
  reason?: string;
  message?: string;
}

export interface CompensationList {
  filter: CompensationFilter;
  counts: Record<CompensationFilter, number>;
  total: number;
  items: CompensationListItem[];
}

export interface GradeRange {
  status: "IN_RANGE" | "BELOW" | "ABOVE" | "NO_RANGE" | "NOT_COMPARABLE" | string;
  grade: { id: number; code: string; name: string } | null;
  range: { min: string | null; max: string | null; currency: string } | null;
  position_pct: string | null;
}

export interface EmployeeCompensation extends Placement {
  employee: EmployeeRef;
  current: Assignment | null;
  breakdown: Breakdown | null;
  scheduled: Assignment[];
  pending: Assignment[];
  history: Assignment[];
  without_salary: boolean;
  self_service: boolean;
  grade_range?: GradeRange;
}

export interface CompareLine {
  component: string;
  before_monthly: Money | null;
  after_monthly: Money | null;
  before_annual: Money | null;
  after_annual: Money | null;
  change_pct: string | null;
}

/** compensation.compare(): preview_change and move-assignments items. */
export interface CompareResult {
  assignment_id: number | null;
  employee_id: number;
  structure_before: StructureRef | null;
  structure_after: StructureRef;
  pay_basis: { before: Money | null; after: Money; change_pct: string | null };
  lines: CompareLine[];
  before: Breakdown | null;
  after: Breakdown;
  grade_range: GradeRange;
}

export interface OverrideValue {
  amount?: string;
  percent?: string;
  formula?: string;
}

export interface ImportRowResult {
  row: number;
  employee_code: string | null;
  ok: boolean;
  errors: string[];
  warnings: string[];
  values: Record<string, string>;
}

export interface ImportDryRun {
  import_id: number;
  summary: { rows: number; valid: number; invalid: number };
  rows: ImportRowResult[];
}

export interface ImportCommit {
  import_id: number;
  status: string;
  job: JobDto;
}

export interface ImportRecord {
  import_id: number;
  status: "VALIDATED" | "QUEUED" | "COMMITTED" | "FAILED" | string;
  file_name: string | null;
  summary: { rows: number; valid: number; invalid: number } | null;
  result: { rows: { row: number; ok: boolean; error?: string; compensation_id?: number }[]; created_count: number; failed_count: number } | null;
  job_id: number | null;
  created_at: string;
}

/* ------------------------------------------------------------------ revision cycles */

export interface CycleMethod {
  type: CycleMethodType;
  structure_version_id?: number;
  percent?: string;
  amounts?: Record<string, string>;
  rows?: { employee_id?: number | null; employee_code?: string | null; pay_basis_amount: string }[];
  matrix?: Record<string, Record<string, string>>;
  ratings?: Record<string, string>;
  default_percent?: string;
}

export interface CyclePopulation {
  legal_entity_ids?: number[];
  department_ids?: number[];
  grade_ids?: number[];
  employee_ids?: number[];
  hire_date_before?: string;
  hire_date_after?: string;
}

export interface CycleTotals {
  count: number;
  old: string;
  new: string;
  increase: string;
  change_pct: string | null;
}

export interface CycleItem {
  id: number;
  employee: EmployeeRef;
  status: "PROPOSED" | "EXCLUDED" | "APPLIED" | "FAILED" | string;
  old_assignment_id: number | null;
  new_assignment_id: number | null;
  proposed: {
    template_version_id: number;
    currency: string;
    old_pay_basis_amount: string;
    pay_basis_amount: string;
    change_pct: string | null;
    grade_range: string;
    position_pct: string | null;
  } | null;
  note: string | null;
}

export type CycleStatus = "DRAFT" | "PREVIEWED" | "PENDING_APPROVAL" | "APPROVED" | "APPLIED" | "REJECTED" | "CANCELLED";

export interface RevisionCycle {
  id: number;
  name: string;
  population: CyclePopulation | null;
  method: CycleMethod;
  effective_from: string;
  status: CycleStatus | string;
  /** currency -> totals; null until previewed. */
  totals: Record<string, CycleTotals> | null;
  approval_request_id: number | null;
  row_version: number;
  created_by_user_id: number | null;
  applied_by_user_id: number | null;
  applied_at: string | null;
  created_at: string;
  items?: CycleItem[];
}

/* ------------------------------------------------------------------ org options */

export interface OrgOption {
  id: number;
  code: string;
  name: string;
  status?: string;
  legal_entity_id?: number | null;
  currency?: string;
  salary_ranges?: { currency: string; min: string; mid?: string; max: string }[];
}
