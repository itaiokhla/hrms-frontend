/**
 * Response shapes of the employee self-service pay pages, read from the FastAPI routes and services
 * (never guessed):
 *
 * - payslips: hrms-backend/app/payroll/routes/payslips.py `my_payslips` / `my_payslip` = services/documents.py
 *   `document_json(as_staff=False)` + routes/payslips.py `_summary` (+ `content` = services/payslips.py `build`)
 * - payslip password: services/publication.py `secret_status`
 * - downloads: services/downloads.py `download_link` ({url, expires_at, expires_in_seconds})
 * - my payments: routes/my_payments.py = services/obligations.py `my_payments` / `obligation_json(for_self)`
 *   + services/payment_events.py `instruction_json(for_self)`
 * - documents: routes/documents.py `my_documents`, `my_document_requests` (services/registers.py `request_json`)
 * - bank accounts: routes/bank_accounts.py self routes = services/bank_accounts.py `serialize_account(for_self)`,
 *   `serialize_change_request(for_self)`, `_change_result(for_self)`, `_evidence_result`
 * - compensation: routes/compensation.py `employee_compensation` (types reused from the compensation area)
 * - preferences: routes/me_payroll.py `my_payroll_preferences` = services/self_service.py `preferences`
 * - loan policy: routes/me_payroll.py `my_loan_policy` = services/loans.py `policy_preview`
 * - payslip questions: routes/payslip_queries.py = services/payslip_queries.py `query_json(as_staff=False)`
 * - loans / claims: types reused from the inputs area (services/loans.py `serialize`, services/claims.py
 *   `serialize`); claim types = services/claims.py `claim_types`
 *
 * Amounts are `{amount: "<decimal string>", currency}` (EC-MON-15); never do Number arithmetic on them.
 */

import type { Money } from "@/lib/money";

export type { Claim, ClaimReceipt, ListPage, Loan, LoanInstalment, LoanSchedule, LoanTransaction } from "../inputs/types";
export type { Assignment, Breakdown, EmployeeCompensation } from "../compensation/types";

/* ------------------------------------------------------------------ documents and payslips */

/** services/documents.py `document_json(doc, as_staff=False)`. */
export interface PayDocumentDto {
  id: number;
  doc_type: string;
  number: string | null;
  title: string;
  version: number;
  status: string;
  draft: boolean;
  legal_entity_id: number;
  employee_id: number | null;
  run_id: number | null;
  run_employee_id: number | null;
  period_start: string | null;
  period_end: string | null;
  issue_date: string;
  published_at: string | null;
  first_viewed_at: string | null;
  supersedes_document_id: number | null;
  labels: string[];
  languages: string[];
  sha256: string;
  bytes: number;
  file_name: string;
  row_version: number;
}

/** A payslip in the list: the document plus routes/payslips.py `_summary`. */
export interface MyPayslip extends PayDocumentDto {
  period_label: string | null;
  currency: string | null;
  net: Money | null;
  /** The payment sentence frozen on the payslip ("Scheduled", "Paid on 2026-11-30", ...). */
  payment: string | null;
}

/** One line of a payslip section (services/payslips.py `build`): amounts are decimal strings in `content.currency`. */
export interface PayslipLine {
  code: string;
  label: string;
  amount: string;
  rate: string | null;
  units: string | null;
  period_ref_label: string | null;
  statutory: boolean;
  fixture: boolean;
  ytd?: string | null;
  /**
   * The engine's plain-language "Why this amount?" for an employee-visible line (services/payslips.py
   * `employee_explanation`: whitespace-normalised, at most 500 characters). Absent on payslips generated
   * before explanations were frozen into the content, and null when the engine recorded none.
   */
  explanation?: string | null;
}

export interface PayslipPayment {
  key: string;
  text: string;
  method: string | null;
  reference: string | null;
  sandbox?: boolean;
}

/** `content` of a payslip document (services/payslips.py `build`, schema 1). */
export interface PayslipContent {
  kind: string;
  schema: number;
  title_key: "PAYSLIP" | "REVISED_PAYSLIP" | string;
  replaces: string | null;
  version: number;
  employer: {
    legal_name: string | null;
    trade_name: string | null;
    code: string | null;
    country_code: string | null;
    address_line: string | null;
    registration_lines: { label: string; value: string }[];
  };
  employee: {
    id: number;
    name: string;
    code: string;
    designation: string | null;
    department: string | null;
    branch: string | null;
    joining_date: string | null;
    pay_group: string | null;
    /** Masked bank line ("HDFC Bank ••••4321"); absent when the payslip hides it. */
    bank?: string | null;
  };
  period: { start: string; end: string; pay_date: string; label: string; tax_year: string | number | null };
  run: { id: number; number: string | null; run_type: string };
  currency: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  reimbursements: PayslipLine[];
  employer_contributions?: PayslipLine[];
  employer_note: string;
  totals: { gross: string; deductions: string; reimbursements: string; net: string; net_words: string | null };
  payment: PayslipPayment;
  attendance: {
    days_in_period: string | null;
    paid_days: string | null;
    lop_days: string | null;
    overtime_hours: string | null;
    leave_days: string | null;
  } | null;
  leave_balances: { code: string; name: string; used: string; remaining: string | null }[] | null;
  tax_summary: unknown;
  show_ytd: boolean;
  labels: string[];
  languages: string[];
  locale: string;
  template?: { footer_note?: string | null; signature?: { name: string | null; title: string | null } | null } | null;
}

export interface MyPayslipDetail extends MyPayslip {
  content: PayslipContent | null;
}

export interface DownloadLink {
  url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export interface PayslipPasswordStatus {
  set: boolean;
  set_at: string | null;
}

/** services/registers.py `request_json`. */
export interface DocumentRequestDto {
  id: number;
  employee_id: number;
  doc_type: "SALARY_CERTIFICATE" | "EMPLOYMENT_LETTER" | string;
  include_amounts: boolean;
  purpose: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ISSUED" | string;
  decided_at: string | null;
  decision_note: string | null;
  document_id: number | null;
  row_version: number;
  created_at: string | null;
}

/* ------------------------------------------------------------------ my payments */

export interface EmployeeLabelDto {
  key: string;
  text: string;
  badge: string | null;
}

/** services/payment_events.py `instruction_json(for_self=True)` + the employee timeline of obligations.my_payments. */
export interface MyInstruction {
  id: number;
  reference: string | null;
  obligation_id: number;
  run_id: number | null;
  employee_id: number | null;
  batch_id: number | null;
  sequence: number | null;
  amount: Money | null;
  account_amount: Money | null;
  beneficiary: {
    holder_name_masked: string | null;
    account_masked: string | null;
    bank_name: string | null;
    country: string | null;
    currency: string | null;
    routing_scheme: string | null;
    routing_code_masked: string | null;
  };
  status: string;
  label: EmployeeLabelDto;
  submission_channel: string | null;
  evidence_status: string;
  sandbox: boolean;
  submitted_at: string | null;
  settled_at: string | null;
  settled: Money | null;
  reconciled_at: string | null;
  returned_at: string | null;
  failure_message: string | null;
  expected_settlement_date: string | null;
  reissue_of_instruction_id: number | null;
  /** Applied/recorded events in order, each with the employee's wording of that step. */
  events?: { status: string; label: string; at: string }[];
}

/** services/obligations.py `obligation_json(for_self=True)` + run_label. */
export interface MyPaymentPeriod {
  id: number;
  run_id: number | null;
  employee_id: number;
  amount: Money | null;
  status: string;
  pay_date: string | null;
  paid_to_date: Money | null;
  returned: Money | null;
  outstanding: Money | null;
  instructions: MyInstruction[];
  run_label: string | null;
}

export interface MyPaymentsResponse {
  items: MyPaymentPeriod[];
  years: number[];
}

/* ------------------------------------------------------------------ bank accounts */

export interface BankAllocation {
  type: "PRIMARY" | "PERCENT" | "FIXED" | "REMAINDER" | string;
  value: string | null;
  order: number;
}

/** services/bank_accounts.py `serialize_account(for_self=True)`. Numbers are always masked. */
export interface MyBankAccount {
  id: number;
  payee_type: string;
  payee_id: number;
  employee_id: number | null;
  holder_name: string;
  country: string;
  currency: string;
  account_masked: string;
  last4: string | null;
  has_iban: boolean;
  routing: Record<string, string>;
  bank_name: string | null;
  branch_name: string | null;
  account_type: string | null;
  allocation: BankAllocation;
  status: string;
  verification_status: string;
  verification_method: string | null;
  verified_at: string | null;
  approved_at: string | null;
  usable_from: string | null;
  cooling_off: boolean;
  ended_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  replaces_account_id: number | null;
  replaced_by_account_id: number | null;
  status_reason: string | null;
  row_version: number;
  created_at: string | null;
  under_review?: boolean;
  update_required?: boolean;
}

/** services/bank_accounts.py `serialize_change_request(for_self=True)`. */
export interface MyBankChange {
  id: number;
  bank_account_id: number;
  payee_type: string;
  payee_id: number;
  employee_id: number | null;
  kind: "ADD" | "REPLACE" | string;
  replaces_account_id: number | null;
  channel: string;
  status: "SECURITY_REVIEW" | "PENDING_APPROVAL" | "APPLIED" | "REJECTED" | "CANCELLED" | string;
  approval_request_id: number | null;
  decided_at: string | null;
  decision_reason: string | null;
  cooling_off_waived: boolean;
  after: MyBankAccount;
  before: MyBankAccount[];
  row_version: number;
  created_at: string | null;
}

/** routes/bank_accounts.py `_change_result(for_self=True)`. */
export interface BankChangeResult {
  id: number;
  change_request_id: number;
  bank_account_id: number;
  status: string;
  approval_request_id: number | null;
  row_version: number;
}

export interface BankRoutingIn {
  ifsc?: string;
  sort_code?: string;
  aba?: string;
  bsb?: string;
  wps_routing_code?: string;
  bic?: string;
  bank_code?: string;
  branch_code?: string;
}

/** routes/bank_accounts.py `BankAccountIn`. */
export interface BankAccountIn {
  holder_name: string;
  country: string;
  currency: string;
  account_number?: string | null;
  iban?: string | null;
  routing: BankRoutingIn;
  account_type?: string | null;
  bank_name?: string | null;
  bank_address?: string | null;
  branch_name?: string | null;
  allocation?: { type: string; value?: string | null; order?: number } | null;
  replaces_account_id?: number | null;
}

/* ------------------------------------------------------------------ claims */

export interface ClaimTypeDto {
  code: string;
  name: string;
  taxability: string;
  limit_per_claim: Money | null;
  limit_per_month: Money | null;
  limit_per_year: Money | null;
  receipt_required_above: Money | null;
}

/** services/claims.py `claim_types`. */
export interface ClaimTypesResponse {
  employee_id: number;
  date: string;
  enabled: boolean;
  currency: string;
  status: string | null;
  policy: unknown;
  claim_types: ClaimTypeDto[];
  reason?: string | null;
  policy_version?: number | null;
  submission_window_days?: number | null;
}

/** routes/uploads.py `upload_limits`. */
export interface UploadLimits {
  max_upload_bytes: number;
  kinds: Record<string, { max_bytes?: number; max_files?: number; max_rows?: number; mime_types: string[] }>;
}

/* ------------------------------------------------------------------ preferences (GET /me/payroll/preferences) */

/**
 * Settings resolved by the server for the caller's own employee. A value that did not resolve is null
 * and its key is listed in `unavailable`: the page then says so instead of assuming a default.
 */
export interface PayrollPreferences {
  employee_id: number;
  as_of: string;
  time_zone: string | null;
  legal_entity: { id: number; name: string; country_code: string | null } | null;
  payslip: {
    queries_enabled: boolean | null;
    pdf_protection: "NONE" | "EMPLOYEE_SECRET" | null;
  };
  pay_group: {
    id: number;
    code: string;
    name: string;
    currency: string;
    next_pay_date: string | null;
    next_period: { id: number; start: string; end: string; status: string } | null;
  } | null;
  bank_accounts: {
    self_service_enabled: boolean | null;
    change_requires_approval: boolean | null;
    cooling_off_hours: number | null;
    verification_methods: string[] | null;
    split_payments_enabled: boolean | null;
    max_accounts_per_payee: number | null;
    /** 1 while split payments are off; the configured maximum when on; null when unknown. */
    effective_max_accounts: number | null;
    /** ISO 3166 codes, or null: no setting restricts the country (any country is accepted). */
    allowed_countries: string[] | null;
  };
  unavailable: string[];
}

/* ------------------------------------------------------------------ loan policy preview (GET /me/payroll/loan-policy) */

export interface LoanPolicyRef {
  name: string | null;
  version: number | null;
  effective_from: string | null;
}

/** One kind (loan or advance) of services/loans.py `policy_preview`. Maximums are null when not computable. */
export interface LoanKindPolicy<L, U> {
  enabled: boolean;
  /** "RESOLVED" when a policy applies; anything else means no usable policy (limits/usage are null). */
  policy_status: string | null;
  policy: LoanPolicyRef | null;
  limits: L | null;
  usage: U | null;
}

export interface LoanLimits {
  max_amount_formula: string | null;
  max_amount: Money | null;
  max_tenure_months: number | null;
  interest_rate_percent: string | null;
  interest_method: string | null;
  max_instalment_percent_of_net: string | null;
  min_service_months: number | null;
  max_active_loans: number | null;
  recover_balance_on_exit: boolean | null;
}

export interface AdvanceLimits {
  max_percent_of_monthly_net: string | null;
  max_amount: Money | null;
  recover_in_runs: number | null;
  max_per_year: number | null;
}

export interface LoanPolicyPreview {
  employee_id: number;
  as_of: string;
  currency: string;
  protected_net_percent: string | null;
  loan: LoanKindPolicy<LoanLimits, { open: number; service_months: number | null }>;
  advance: LoanKindPolicy<AdvanceLimits, { open: number; this_year: number }>;
}

/* ------------------------------------------------------------------ payslip questions */

export type PayslipQuestionStatus = "OPEN" | "ANSWERED" | "CLOSED";

/** services/payslip_queries.py `query_json(as_staff=False)`: never staff user ids. */
export interface MyPayslipQuestion {
  id: number;
  document_id: number;
  payslip: { id: number; number: string | null; version: number; period_label: string | null; period_start: string | null; period_end: string | null } | null;
  question: string;
  status: PayslipQuestionStatus | string;
  answer: string | null;
  answered_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  row_version: number;
}

/** routes/payslip_queries.py `_result`. */
export interface PayslipQuestionResult {
  id: number;
  document_id: number;
  status: string;
  row_version: number;
}

/** Limits from app/models/payslip_queries.py (QUESTION_MAX / ANSWER_MAX). */
export const QUESTION_MAX = 2000;
export const ANSWER_MAX = 4000;
