/** Fixtures for the bank-details / payments / reconciliation tests (not a test file). */

import { act } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import { type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import type {
  BankAccountDetail,
  BankChangeRequest,
  FundingAccount,
  PaymentBatchDetail,
  PaymentInstruction,
  ReconciliationMatch,
  StatementImport,
} from "../types";

export const ME_ID = 7;

export function me(permissions: Partial<Record<PermissionCode, Scope[]>>, employeeId: number | null = null): Me {
  return {
    user: { id: ME_ID, email: "fin@acme.io", full_name: "Fin Ops", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: employeeId ? { id: employeeId, employee_code: "E0007", first_name: "Fin", last_name: "Ops", position: null, department: null, has_photo: false } : null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  } as Me;
}

export function signIn(user: Me) {
  act(() => {
    useSession.setState({ me: user, status: "authenticated" });
  });
}

/** Strip bidi marks and narrow spaces Intl adds, for text assertions. */
export const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

export const conflict = (message = "The payment batch was changed by someone else.") => payrollError(409, { detail: message, code: "ROW_VERSION_CONFLICT" });
export const notFound = (what = "Payment batch") => payrollError(404, { detail: `${what} not found` });

type Handler = unknown | ((url: string, options?: { params?: Record<string, unknown> }) => unknown);

/** `mockGet.mockImplementation(routes({...}))`: exact URL → value (or function); unknown URLs reject with 404. */
export function routes(map: Record<string, Handler>) {
  return async (url: string, options?: { params?: Record<string, unknown> }) => {
    if (!(url in map)) throw payrollError(404, { detail: `No mock for ${url}` });
    const value = map[url];
    const result = typeof value === "function" ? (value as (u: string, o?: unknown) => unknown)(url, options) : value;
    if (result instanceof Error) throw result;
    return result;
  };
}

export function account(overrides: Partial<BankAccountDetail> = {}): BankAccountDetail {
  return {
    id: 31,
    payee_type: "EMPLOYEE",
    payee_id: 142,
    employee_id: 142,
    holder_name: "Asha Rao",
    country: "IN",
    currency: "INR",
    account_masked: "••••4321",
    last4: "4321",
    has_iban: false,
    routing: { ifsc: "HDFC0001234" },
    bank_name: "HDFC Bank",
    branch_name: "Indiranagar",
    account_type: null,
    allocation: { type: "PRIMARY", value: null, order: 0 },
    status: "PENDING_APPROVAL",
    verification_status: "PENDING",
    verification_method: null,
    verified_at: null,
    approved_at: null,
    usable_from: null,
    cooling_off: false,
    ended_at: null,
    effective_from: null,
    effective_to: null,
    replaces_account_id: null,
    replaced_by_account_id: null,
    status_reason: null,
    row_version: 3,
    created_at: "2026-10-20T09:00:00",
    payment_hold: false,
    hold_reason: null,
    risk_flags: [],
    failure_reason: null,
    last_failed_at: null,
    first_paid_at: null,
    created_by_user_id: 9,
    approved_by_user_id: null,
    verifications: [
      {
        id: 501,
        method: "DOCUMENT_REVIEW",
        result: "EVIDENCE_SUBMITTED",
        provider: null,
        sandbox: false,
        provider_ref: null,
        name_match_score: null,
        evidence_of_id: null,
        has_evidence: true,
        evidence_file_name: "cheque.pdf",
        evidence_mime: "application/pdf",
        evidence_sha256: "a".repeat(64),
        evidence_bytes: 20480,
        reason: null,
        details: {},
        performed_by_user_id: 9,
        at: "2026-10-20T09:05:00",
      },
    ],
    change_requests: [],
    ...overrides,
  };
}

export function change(overrides: Partial<BankChangeRequest> = {}): BankChangeRequest {
  const after = account({ id: 32, account_masked: "••••9876", last4: "9876", routing: { ifsc: "ICIC0000042" }, bank_name: "ICICI Bank", branch_name: null });
  const before = account({ id: 31, status: "ACTIVE", verification_status: "VERIFIED" });
  return {
    id: 77,
    bank_account_id: 32,
    payee_type: "EMPLOYEE",
    payee_id: 142,
    employee_id: 142,
    kind: "REPLACE",
    replaces_account_id: 31,
    channel: "SELF",
    status: "PENDING_APPROVAL",
    approval_request_id: 90,
    decided_at: null,
    decision_reason: null,
    cooling_off_waived: false,
    after,
    before: [before],
    row_version: 1,
    created_at: "2026-10-21T08:00:00",
    requested_by_user_id: 55,
    step_up_at: "2026-10-21T07:59:00",
    step_up_method: "TOTP",
    ip_address: "10.0.0.1",
    user_agent: "jest",
    risk_flags: [{ code: "NEW_DEVICE", detail: "First change from this browser or device" }],
    alert_recipients: ["a***@acme.io"],
    security_reviewed_by_user_id: null,
    security_reviewed_at: null,
    security_review_reason: null,
    decided_by_user_id: null,
    cooling_off_waived_reason: null,
    cooling_off_waived_by_user_id: null,
    ...overrides,
  };
}

export function instruction(overrides: Partial<PaymentInstruction> = {}): PaymentInstruction {
  return {
    id: 901,
    reference: "PI000000901",
    obligation_id: 801,
    run_id: 12,
    employee_id: 142,
    batch_id: 41,
    sequence: 1,
    amount: { amount: "123456.78", currency: "INR" },
    account_amount: null,
    beneficiary: { holder_name_masked: "A*** R**", account_masked: "••••4321", bank_name: "HDFC Bank", country: "IN", currency: "INR", routing_scheme: "IFSC", routing_code_masked: "HDFC•••234" },
    status: "APPROVED",
    label: { key: "SCHEDULED", text: "Scheduled", badge: null },
    submission_channel: null,
    evidence_status: "UNVERIFIED",
    sandbox: false,
    submitted_at: null,
    settled_at: null,
    settled: null,
    reconciled_at: null,
    returned_at: null,
    failure_message: null,
    expected_settlement_date: null,
    reissue_of_instruction_id: null,
    legal_entity_id: 1,
    funding_account_id: 5,
    bank_account_id: 31,
    status_reason: null,
    status_note: null,
    row_version: 2,
    created_at: "2026-10-21T10:00:00",
    ...overrides,
  };
}

export function batch(overrides: Partial<PaymentBatchDetail> = {}): PaymentBatchDetail {
  return {
    id: 41,
    reference: "PB00000041",
    run_id: 12,
    legal_entity_id: 1,
    funding_account_id: 5,
    method: "BANK_FILE",
    file_format: "GENERIC_CSV",
    adapter: null,
    sandbox: false,
    badge: null,
    currency: "INR",
    status: "APPROVAL_PENDING",
    item_count: 2,
    total: { amount: "246913.56", currency: "INR" },
    value_date: "2026-10-31",
    prepared_by_user_id: 9,
    approved_by_user_id: null,
    approved_at: null,
    released_by_user_id: null,
    released_at: null,
    submission_channel: null,
    cancelled_at: null,
    status_reason: null,
    exclusions: [
      { instruction_id: 950, reference: "PI000000950", employee_id: 150, status: "ON_HOLD", reason: "MISSING_BANK_ACCOUNT", message: "No active bank account on file", amount: { amount: "50000.00", currency: "INR" }, account: null },
    ],
    bank_change_decisions: [],
    figures: {
      intended: { amount: "246913.56", currency: "INR" },
      submitted: { amount: "0.00", currency: "INR" },
      settled: { amount: "0.00", currency: "INR" },
      returned: { amount: "0.00", currency: "INR" },
      failed: { amount: "0.00", currency: "INR" },
      outstanding: { amount: "246913.56", currency: "INR" },
    },
    file: null,
    row_version: 4,
    created_at: "2026-10-21T10:00:00",
    instructions: [instruction(), instruction({ id: 902, employee_id: 143, reference: "PI000000902" })],
    bank_changes: [],
    ...overrides,
  };
}

export function funding(overrides: Partial<FundingAccount> = {}): FundingAccount {
  return {
    id: 5,
    legal_entity_id: 1,
    name: "Payroll — HDFC",
    holder_name: "Acme India Pvt Ltd",
    country: "IN",
    currency: "INR",
    account_masked: "••••7788",
    last4: "7788",
    has_iban: false,
    routing: { ifsc: "HDFC0000001" },
    bank_name: "HDFC Bank",
    account_type: null,
    purpose: "PAYROLL",
    signatory_user_ids: [ME_ID],
    formats: ["GENERIC_CSV"],
    provider_profile: null,
    sandbox: false,
    status: "ACTIVE",
    status_reason: null,
    row_version: 2,
    created_at: "2026-10-01T10:00:00",
    updated_at: null,
    ...overrides,
  };
}

export function match(overrides: Partial<ReconciliationMatch> = {}): ReconciliationMatch {
  return {
    id: 61,
    status: "MISMATCH",
    reason: "AMOUNT_DIFFERS",
    message: "The amount differs from the payment",
    funding_account_id: 5,
    candidate_ids: [901],
    variance: { amount: "-10.00", currency: "INR" },
    decided_by_user_id: null,
    decided_at: null,
    decision_reason: null,
    row_version: 1,
    line: { id: 7001, import_id: 3, source_row: 2, value_date: "2026-10-31", booking_date: null, amount: { amount: "123446.78", currency: "INR" }, direction: "DEBIT", reference: "PI000000901", end_to_end_id: null, counterparty: "ASHA RAO", counterparty_account: "••••4321", return_reason: null, return_message: null },
    instruction: { id: 901, reference: "PI000000901", status: "SUBMITTED", employee_id: 142, amount: { amount: "123456.78", currency: "INR" }, account: "••••4321" },
    ...overrides,
  };
}

export function statement(overrides: Partial<StatementImport> = {}): StatementImport {
  return {
    id: 3,
    funding_account_id: 5,
    format: "CSV",
    file_name: "hdfc-oct.csv",
    file_sha256: "b".repeat(64),
    statement_ref: null,
    account_masked: null,
    line_count: 4,
    new_line_count: 4,
    rejected: [],
    counts: { MATCHED: 3, MISMATCH: 1 },
    imported_by_user_id: ME_ID,
    created_at: "2026-11-01T09:00:00",
    ...overrides,
  };
}
