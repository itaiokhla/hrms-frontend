/**
 * DTOs of the bank-details, payments, reconciliation and funding-account APIs, written from the
 * real serializers (read on 21 Oct 2026):
 *
 * - `app/payroll/services/bank_accounts.py` (serialize_account, serialize_change_request, _verification_json, reveal_account)
 * - `app/payroll/services/payment_batches.py` (propose/_group_json, batch_json, list_batches, list_instructions)
 * - `app/payroll/services/payment_events.py` (instruction_json, event_json, manual_proof_json, get_instruction)
 * - `app/payroll/services/reconciliation.py` (import_json, match_json, overdue)
 * - `app/payroll/services/funding_accounts.py` (serialize, reveal)
 *
 * Money is always `{amount: "<decimal string>", currency}`; amounts are never JSON numbers.
 */

import type { Money } from "@/lib/money";

export interface PageOf<T> {
  total: number;
  items: T[];
}

/* ------------------------------------------------------------------ bank accounts */

export const ACCOUNT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE"] as const;
export const VERIFICATION_STATUSES = ["NOT_SUBMITTED", "PENDING", "VERIFIED", "FAILED", "EXPIRED", "REQUIRES_REVIEW"] as const;
export const CHANGE_STATUSES = ["SECURITY_REVIEW", "PENDING_APPROVAL", "APPLIED", "REJECTED", "CANCELLED"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** A risk flag on an account (`_add_flag`) or a change request (code + detail). */
export interface RiskFlag {
  code: string;
  open?: boolean;
  at?: string;
  detail?: string | null;
  role?: string;
  score?: string;
  source?: string;
  closed_at?: string;
  closed_reason?: string;
}

export interface BankAllocation {
  type: "PRIMARY" | "PERCENT" | "FIXED" | "REMAINDER" | string;
  value: string | null;
  order: number;
}

export interface BankAccount {
  id: number;
  payee_type: string;
  payee_id: number;
  employee_id: number | null;
  /** The nominee of a deceased employee's final settlement (payee_type NOMINEE), else null. */
  nominee_id?: number | null;
  holder_name: string;
  country: string;
  currency: string;
  account_masked: string;
  last4: string;
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
  created_at: string;
  // staff view only
  payment_hold?: boolean;
  hold_reason?: string | null;
  risk_flags?: RiskFlag[];
  failure_reason?: string | null;
  last_failed_at?: string | null;
  first_paid_at?: string | null;
  created_by_user_id?: number | null;
  approved_by_user_id?: number | null;
}

export interface BankVerification {
  id: number;
  method: string;
  result: string;
  provider: string | null;
  sandbox: boolean;
  provider_ref: string | null;
  name_match_score: string | null;
  evidence_of_id: number | null;
  has_evidence: boolean;
  evidence_file_name: string | null;
  evidence_mime: string | null;
  evidence_sha256: string | null;
  evidence_bytes: number | null;
  reason: string | null;
  details: Record<string, unknown>;
  performed_by_user_id: number | null;
  at: string;
}

export interface BankAccountDetail extends BankAccount {
  verifications: BankVerification[];
  change_requests: { id: number; status: string; channel: string; kind: string; created_at: string; decided_at: string | null }[];
}

export interface BankChangeRequest {
  id: number;
  bank_account_id: number;
  payee_type: string;
  payee_id: number;
  employee_id: number | null;
  nominee_id?: number | null;
  /** Who a NOMINEE account is for, what the proof document is and the share (staff view only). */
  nominee?: { id: number; kind: string; name: string; relationship: string; proof_ref: string; share_percent: string; country: string; status: string; employee_id: number; final_settlement_case_id: number } | null;
  kind: "ADD" | "REPLACE" | string;
  replaces_account_id: number | null;
  channel: "SELF" | "HR" | "BUREAU" | string;
  status: ChangeStatus | string;
  approval_request_id: number | null;
  decided_at: string | null;
  decision_reason: string | null;
  cooling_off_waived: boolean;
  after: BankAccount;
  before: BankAccount[];
  row_version: number;
  created_at: string;
  // staff view only
  requested_by_user_id?: number | null;
  step_up_at?: string | null;
  step_up_method?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  risk_flags?: RiskFlag[];
  alert_recipients?: string[];
  security_reviewed_by_user_id?: number | null;
  security_reviewed_at?: string | null;
  security_review_reason?: string | null;
  decided_by_user_id?: number | null;
  cooling_off_waived_reason?: string | null;
  cooling_off_waived_by_user_id?: number | null;
}

/** POST /payroll/bank-accounts/{id}/reveal (no-store; never cached by the UI). */
export interface RevealedAccount {
  id: number;
  holder_name: string;
  account_number: string | null;
  iban: string | null;
  routing: Record<string, string>;
  account_masked: string;
  revealed_at?: string;
}

export interface AccountActionResult {
  id: number;
  status: string;
  verification_status: string;
  account_masked: string;
  usable_from: string | null;
  payment_hold: boolean;
  row_version: number;
  verification?: { id: number; method: string; result: string; provider: string | null; sandbox: boolean; label: string | null; name_match_score: string | null };
}

export interface ChangeActionResult {
  id: number;
  change_request_id: number;
  bank_account_id: number;
  status: string;
  approval_request_id: number | null;
  row_version: number;
  risk_flags?: string[];
}

/* ------------------------------------------------------------------ payments */

export interface ExclusionItem {
  instruction_id: number;
  reference: string | null;
  employee_id: number | null;
  status: string;
  reason: string;
  message: string;
  amount: Money | null;
  account: string | null;
}

export interface BankChangeWarning {
  instruction_id: number;
  employee_id: number | null;
  change: "ACCOUNT_REPLACED" | "ACCOUNT_DETAILS_CHANGED" | "BANK_DETAILS_CHANGED" | string;
  snapshot_account: string | null;
  message: string;
  options: string[];
}

export interface ProposedBatch {
  funding_account_id: number;
  method: "BANK_FILE" | "API" | string;
  currency: string;
  file_format: string | null;
  adapter: string | null;
  sandbox: boolean;
  item_count: number;
  total: Money;
  instruction_ids: number[];
}

/** `_value_date_json` (payment_batches.py, EC-PAY-10): the date rolled off weekends and bank holidays. */
export interface ValueDateInfo {
  requested: string;
  value_date: string;
  shifted: boolean;
  /** VALUE_DATE_SHIFTED, VALUE_DATE_AFTER_PAY_DATE */
  warnings: string[];
}

export interface BatchProposal {
  run_id: number;
  batches: ProposedBatch[];
  exclusions: ExclusionItem[];
  bank_changes: BankChangeWarning[];
  /** For the default date (the period's pay date, or today for a late run). */
  value_date?: ValueDateInfo | null;
}

export interface BatchFigures {
  intended: Money | null;
  submitted: Money | null;
  settled: Money | null;
  returned: Money | null;
  failed: Money | null;
  outstanding: Money | null;
}

export interface PaymentFileInfo {
  format: string;
  filename: string;
  sha256: string;
  record_count: number;
  totals: Record<string, string>;
  generated_at: string | null;
  download_count: number;
  last_downloaded_at: string | null;
}

export interface Beneficiary {
  holder_name_masked: string | null;
  account_masked: string | null;
  bank_name: string | null;
  country: string | null;
  currency: string | null;
  routing_scheme: string | null;
  routing_code_masked: string | null;
}

export interface PaymentInstruction {
  id: number;
  reference: string | null;
  obligation_id: number | null;
  run_id: number | null;
  employee_id: number | null;
  batch_id: number | null;
  sequence: number | null;
  amount: Money | null;
  account_amount: Money | null;
  beneficiary: Beneficiary;
  status: string;
  label: { key: string; text: string; badge: string | null };
  submission_channel: string | null;
  evidence_status: string | null;
  sandbox: boolean;
  submitted_at: string | null;
  settled_at: string | null;
  settled: Money | null;
  reconciled_at: string | null;
  returned_at: string | null;
  failure_message: string | null;
  expected_settlement_date: string | null;
  reissue_of_instruction_id: number | null;
  legal_entity_id?: number;
  funding_account_id?: number | null;
  bank_account_id?: number | null;
  status_reason?: string | null;
  status_note?: string | null;
  evidence_source?: string | null;
  evidence_ref?: string | null;
  provider_ref?: string | null;
  variance?: Money | null;
  variance_reason?: string | null;
  failure_code?: string | null;
  reissue_request?: Record<string, unknown> | null;
  carried_at?: string | null;
  fx_conversion_id?: number | null;
  row_version?: number;
  created_at?: string;
  /** Only in GET /payroll/reconciliation/overdue. */
  business_days_overdue?: number;
}

export interface ManualProof {
  id: number;
  instruction_id: number;
  method: string;
  evidence_reference: string | null;
  evidence_name: string | null;
  evidence_mime: string | null;
  evidence_sha256: string | null;
  note: string | null;
  status: string;
  submitted_by_user_id: number | null;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  row_version: number;
  created_at: string;
}

export interface InstructionDetail extends PaymentInstruction {
  manual_proofs: ManualProof[];
  replaced_by_instruction_ids: number[];
}

export interface PaymentEvent {
  id: number;
  event_status: string | null;
  outcome: string | null;
  from_status: string | null;
  to_status: string | null;
  source: string | null;
  external_event_id: string | null;
  evidence_ref: string | null;
  sandbox: boolean;
  actor_user_id: number | null;
  details: Record<string, unknown>;
  at: string;
}

export interface PaymentBatch {
  id: number;
  reference: string;
  run_id: number | null;
  legal_entity_id: number;
  funding_account_id: number | null;
  method: "BANK_FILE" | "API" | string;
  file_format: string | null;
  adapter: string | null;
  sandbox: boolean;
  badge: string | null;
  currency: string;
  status: string;
  item_count: number;
  total: Money | null;
  value_date: string | null;
  /** VALUE_DATE_SHIFTED / VALUE_DATE_AFTER_PAY_DATE recorded when the batch was created. */
  value_date_warnings?: string[];
  prepared_by_user_id: number | null;
  approved_by_user_id: number | null;
  approved_at: string | null;
  released_by_user_id: number | null;
  released_at: string | null;
  submission_channel: string | null;
  cancelled_at: string | null;
  status_reason: string | null;
  exclusions: ExclusionItem[];
  bank_change_decisions: { decision: string; instruction_ids: number[]; by_user_id: number; at: string; reason: string }[];
  figures: BatchFigures;
  file: PaymentFileInfo | null;
  row_version: number;
  created_at: string;
}

export interface PaymentBatchDetail extends PaymentBatch {
  instructions: PaymentInstruction[];
  bank_changes: BankChangeWarning[];
}

/** Compact action result (`_batch_result`). */
export interface BatchActionResult {
  id: number;
  reference: string;
  status: string;
  run_id: number | null;
  method: string;
  currency: string;
  item_count: number;
  total: Money | null;
  sandbox: boolean;
  row_version: number;
  file: PaymentFileInfo | null;
  value_date?: string | null;
  value_date_warnings?: string[];
}

export interface CreateBatchesResult {
  run_id: number;
  batches: BatchActionResult[];
  exclusions: ExclusionItem[];
  bank_changes: BankChangeWarning[];
}

/** GET /payroll/runs list item (fields this area uses). */
export interface RunOption {
  id: number;
  number?: number | null;
  label: string | null;
  run_type: string;
  status: string;
  legal_entity_id: number;
  currency: string | null;
  pay_group: { id: number; code: string; name: string } | null;
  period: { id: number; start: string; end: string; pay_date: string; status: string } | null;
}

/* ------------------------------------------------------------------ reconciliation */

export const MATCH_QUEUES = ["review", "mismatch", "unmatched", "duplicate", "escalated", "resolved", "ignored"] as const;
export type MatchQueue = (typeof MATCH_QUEUES)[number];

export interface StatementImport {
  id: number;
  funding_account_id: number;
  format: "CSV" | "CAMT053" | string;
  file_name: string;
  file_sha256: string;
  statement_ref: string | null;
  account_masked: string | null;
  line_count: number;
  new_line_count: number;
  rejected: { source_row: number | null; code: string; message: string }[];
  counts: Record<string, number>;
  imported_by_user_id: number | null;
  created_at: string;
}

export interface StatementLine {
  id: number;
  import_id: number;
  source_row: number | null;
  value_date: string | null;
  booking_date: string | null;
  amount: Money | null;
  direction: string | null;
  reference: string | null;
  end_to_end_id: string | null;
  counterparty: string | null;
  counterparty_account: string | null;
  return_reason: string | null;
  return_message: string | null;
}

export interface ReconciliationMatch {
  id: number;
  status: string;
  reason: string | null;
  message: string | null;
  funding_account_id: number;
  candidate_ids: number[];
  variance: Money | null;
  decided_by_user_id: number | null;
  decided_at: string | null;
  decision_reason: string | null;
  row_version: number;
  line: StatementLine;
  instruction: { id: number; reference: string | null; status: string; employee_id: number | null; amount: Money | null; account: string | null } | null;
}

export interface ImportStatementResult {
  import: StatementImport;
  duplicate: boolean;
  matches: ReconciliationMatch[];
}

export interface OverdueResult {
  as_of: string;
  items: PaymentInstruction[];
}

/** The CSV column mapping (`CsvColumnMapping` in app/payroll/banking/statements.py). */
export interface CsvMapping {
  date: string;
  amount?: string;
  debit?: string;
  credit?: string;
  direction?: string;
  currency?: string;
  default_currency?: string;
  reference?: string;
  counterparty?: string;
  counterparty_account?: string;
  remittance?: string;
  booking_date?: string;
  date_format?: string;
  decimal_separator?: string;
  thousands_separator?: string | null;
  delimiter?: string;
  skip_rows?: number;
}

/* ------------------------------------------------------------------ funding accounts */

export const FUNDING_PURPOSES = ["PAYROLL", "STATUTORY", "CONTRACTORS", "REIMBURSEMENTS"] as const;

export interface FundingAccount {
  id: number;
  legal_entity_id: number;
  name: string;
  holder_name: string;
  country: string;
  currency: string;
  account_masked: string;
  last4: string;
  has_iban: boolean;
  routing: Record<string, string>;
  bank_name: string | null;
  account_type: string | null;
  purpose: string;
  signatory_user_ids: number[];
  formats: string[];
  provider_profile: string | null;
  sandbox: boolean;
  status: "ACTIVE" | "INACTIVE" | string;
  status_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string | null;
}

/**
 * services/funding_accounts.py `option_json` (GET /payroll/funding-accounts/options): what payment users
 * need to pick and recognise an account. Masked; no signatory list, routing, holder name or provider.
 */
export interface FundingAccountOption {
  id: number;
  name: string;
  currency: string;
  purpose: string;
  legal_entity: { id: number; name: string | null; code: string | null };
  account_masked: string;
  bank_name: string | null;
  status: "ACTIVE" | "INACTIVE" | string;
  active: boolean;
  sandbox: boolean;
  /** Whether the signed-in user is a signatory of this account. */
  is_signatory: boolean;
}

/** One funding account as the payment pages use it, from the options list. */
export interface FundingChoice {
  id: number;
  legal_entity_id: number;
  legal_entity_name: string | null;
  name: string;
  currency: string;
  account_masked: string;
  bank_name: string | null;
  status: string;
  sandbox: boolean;
  is_signatory: boolean;
}

export interface BankDetailsInput {
  holder_name: string;
  country: string;
  currency: string;
  account_number?: string | null;
  iban?: string | null;
  routing?: Record<string, string>;
  account_type?: string | null;
  bank_name?: string | null;
  bank_address?: string | null;
}

export interface FundingAccountInput {
  name: string;
  purpose: string;
  signatory_user_ids: number[];
  formats: string[];
  provider_profile?: string | null;
  details: BankDetailsInput;
}

/* ------------------------------------------------------------------ lookups */

export interface LegalEntityOption {
  id: number;
  code: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  base_currency: string | null;
}

export interface UserOption {
  id: number;
  email: string;
  full_name: string;
  status: string;
}
