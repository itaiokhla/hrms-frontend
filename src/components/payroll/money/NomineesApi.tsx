/**
 * Nominees and legal heirs of a deceased employee's final settlement (3.5 §15, 3.7 §2.1; EC-BNK-15):
 * types and requests of the Nominees workspace. Writes go through `payrollApi` (Idempotency-Key, step-up
 * prompt and one retry on STEP_UP_REQUIRED, structured 409s). Account numbers are masked in every response;
 * the full number is revealed only through the bank-account Reveal flow (read_full, reason, step-up).
 */

import { payrollApi } from "@/lib/payroll/api";

import { cleanParams } from "./api";
import type { BankAccount, BankChangeRequest, PageOf } from "./types";

export const NOMINEE_KINDS = ["NOMINEE", "LEGAL_HEIR"] as const;
export type NomineeKind = (typeof NOMINEE_KINDS)[number];
export const KIND_LABELS: Record<string, string> = { NOMINEE: "Nominee", LEGAL_HEIR: "Legal heir" };

export interface ShareIssue {
  code: string;
  message: string;
}

export interface ShareSummary {
  active: number;
  /** Plain text, e.g. "66.666666". */
  share_total: string;
  complete: boolean;
  issues: ShareIssue[];
  /** False once the settlement run exists: the nominees are frozen. */
  editable: boolean;
}

export interface Nominee {
  id: number;
  employee_id: number;
  final_settlement_case_id: number;
  kind: NomineeKind | string;
  name: string;
  relationship: string;
  proof_ref: string;
  share_percent: string;
  country: string;
  email_masked: string | null;
  status: "ACTIVE" | "ENDED" | string;
  ended_at: string | null;
  ended_reason: string | null;
  created_by_user_id: number;
  created_at: string;
  row_version: number;
  bank_accounts?: BankAccount[];
  has_usable_account?: boolean;
  case?: { id: number; status: string; termination_type: string; currency: string; run_id: number | null };
  editable?: boolean;
}

export interface CaseNominees {
  case: { id: number; employee_id: number; termination_type: string; status: string; currency: string; run_id: number | null };
  summary: ShareSummary | null;
  items: Nominee[];
}

export interface NomineePaymentLine {
  id: number;
  reference: string | null;
  status: string;
  reason: string | null;
  amount: { amount: string; currency: string };
  nominee_id: number | null;
  share_percent: string | null;
  account_masked: string | null;
  holder_name_masked: string | null;
}

export interface NomineePayments {
  case_id: number;
  obligations: { obligation_id: number; status: string; amount: { amount: string; currency: string }; instructions: NomineePaymentLine[] }[];
}

export interface NomineeStatement {
  document_id: number;
  number: string | null;
  title: string;
  status: string;
  issue_date: string;
  sha256: string;
  bytes: number;
}

/** A final-settlement case as listed by GET /payroll/final-settlements (only what the picker shows). */
export interface SettlementCaseRow {
  id: number;
  employee: { id: number; code: string | null; name: string | null };
  termination_type: string;
  status: string;
  last_working_day: string;
  currency: string;
  due_date: string | null;
  overdue: boolean;
  nominees?: ShareSummary;
}

export interface NomineeInput {
  kind: NomineeKind;
  name: string;
  relationship: string;
  proof_ref: string;
  share_percent: string;
  country: string;
  email: string | null;
}

export interface NomineeAccountBody {
  holder_name: string;
  country: string;
  currency: string;
  account_number: string | null;
  iban: string | null;
  routing: Record<string, string>;
  account_type: string | null;
  bank_name: string | null;
  branch_name: string | null;
  bank_address: string | null;
}

export interface NomineeChangeResult {
  id: number;
  change_request_id: number;
  bank_account_id: number;
  status: string;
  approval_request_id: number | null;
  risk_flags?: string[];
}

export const nomineesApi = {
  /** The cases an HR user can open (DEATH ones are filtered by the caller; the list endpoint has no type filter). */
  cases: (params: { status?: string; limit?: number } = {}) =>
    payrollApi.get<{ total: number; items: SettlementCaseRow[] }>("/payroll/final-settlements", { params: cleanParams({ limit: 200, ...params }) }),
  forCase: (caseId: number | string) => payrollApi.get<CaseNominees>(`/payroll/nominees/cases/${caseId}`),
  payments: (caseId: number | string) => payrollApi.get<NomineePayments>(`/payroll/nominees/cases/${caseId}/payments`),
  changes: (params: { status?: string; skip?: number; limit?: number } = {}) =>
    payrollApi.get<PageOf<BankChangeRequest>>("/payroll/nominees/bank-change-requests", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<Nominee>(`/payroll/nominees/${id}`),
  create: (caseId: number, body: NomineeInput, idempotencyKey?: string) =>
    payrollApi.post<{ id: number; final_settlement_case_id: number; status: string; row_version: number }>(
      "/payroll/nominees",
      { final_settlement_case_id: caseId, ...body },
      { idempotencyKey },
    ),
  update: (id: number, body: Partial<NomineeInput>, rowVersion: number) =>
    payrollApi.patch<{ id: number; status: string; row_version: number }>(`/payroll/nominees/${id}`, body, { rowVersion }),
  end: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<{ id: number; status: string; row_version: number }>(`/payroll/nominees/${id}/end`, { reason }, { rowVersion }),
  submitAccount: (id: number, body: NomineeAccountBody, idempotencyKey?: string) =>
    payrollApi.post<NomineeChangeResult>(`/payroll/nominees/${id}/bank-accounts`, body, { idempotencyKey }),
  statements: (id: number | string) => payrollApi.get<{ items: NomineeStatement[] }>(`/payroll/nominees/${id}/statements`),
  issueStatement: (id: number) => payrollApi.post<{ items: NomineeStatement[] }>(`/payroll/nominees/${id}/statements`, {}),
};

/** Client-side mirror of the server rules, so people see a problem while typing (the server decides). */
export function validateNomineeDraft(
  d: { name: string; relationship: string; proof_ref: string; share_percent: string; country: string; email: string },
  otherShares: number,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.name.trim().length < 2) e.name = "Enter the person's full legal name.";
  if (d.relationship.trim().length < 2) e.relationship = "Say how the person is related, such as Spouse or Son.";
  if (d.proof_ref.trim().length < 3) e.proof_ref = "Reference the nomination, succession or court document that names this person.";
  if (!/^[A-Za-z]{2}$/.test(d.country.trim())) e.country = "Choose the person's country.";
  const share = d.share_percent.trim();
  if (!/^[0-9]{1,3}(\.[0-9]{1,6})?$/.test(share)) e.share_percent = "Enter a percentage such as 40 or 33.333333 (at most 6 decimals).";
  else if (!(Number(share) > 0 && Number(share) <= 100)) e.share_percent = "A share is more than 0 and at most 100 percent.";
  else if (Math.round((otherShares + Number(share)) * 1e6) > 100 * 1e6) e.share_percent = `The shares of one settlement add up to at most 100 percent (${formatShare(otherShares)} is already given).`;
  if (d.email.trim() && !/^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(d.email.trim())) e.email = "Enter a valid e-mail address, or leave it empty.";
  return e;
}

/** "66.666666" without trailing zeros. */
export function formatShare(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Number(n.toFixed(6)));
}

/** The accounts a person is paid to: active first, then pending, newest first. */
export function accountState(a: BankAccount): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (a.status === "INACTIVE") return { label: "Replaced or removed", tone: "neutral" };
  if (a.status === "PENDING_APPROVAL" || a.status === "DRAFT") return { label: "Awaiting approval", tone: "warning" };
  if (a.payment_hold) return { label: "Payments held", tone: "danger" };
  if (a.verification_status === "FAILED") return { label: "Verification failed", tone: "danger" };
  if (a.verification_status === "REQUIRES_REVIEW") return { label: "Needs review", tone: "warning" };
  if (a.cooling_off) return { label: "Cooling-off", tone: "warning" };
  if (a.verification_status !== "VERIFIED") return { label: "Not verified yet", tone: "warning" };
  return { label: "Ready to pay", tone: "success" };
}
