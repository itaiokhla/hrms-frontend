/** Shared fixtures for the self-service tests (not a test file: jest only runs *.test.tsx). */

import { act } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import type { Claim, ClaimTypesResponse, Loan, LoanPolicyPreview, MyBankAccount, MyBankChange, MyPaymentPeriod, MyPayslip, MyPayslipDetail, MyPayslipQuestion, PayrollPreferences, PayslipContent } from "../types";

/** The default self-service grants (hrms-backend/app/core/permission_registry.py SELF_SERVICE). */
export const SELF_GRANTS: Partial<Record<PermissionCode, Scope[]>> = {
  [P.PAYROLL_PAYSLIP_READ]: ["SELF"],
  [P.PAYROLL_COMPENSATION_READ]: ["SELF"],
  [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["SELF"],
  [P.PAYROLL_BANK_DETAILS_EDIT]: ["SELF"],
  [P.PAYROLL_TAX_PROFILE_READ]: ["SELF"],
  [P.PAYROLL_LOANS_READ]: ["SELF"],
  [P.PAYROLL_REIMBURSEMENTS_READ]: ["SELF"],
  [P.OVERTIME_REQUEST]: ["SELF"],
  [P.TASK_READ]: ["SELF"],
};

export function me(permissions: Partial<Record<PermissionCode, Scope[]>> = SELF_GRANTS, employeeId: number | null = 42): Me {
  return {
    user: { id: 9, email: "asha@acme.io", full_name: "Asha Rao", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: employeeId ? { id: employeeId, employee_code: "E0042", first_name: "Asha", last_name: "Rao", position: null, department: null, has_photo: false } : null,
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

/** Strip the bidi and narrow-space characters Intl adds, for text assertions. */
export const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

export const conflict = (code = "STALE_ROW_VERSION", message = "Someone changed this.") => payrollError(409, { detail: { message }, code });
export const notFound = (what = "Document") => payrollError(404, { detail: `${what} not found` });
export const serverError = () => payrollError(500, { detail: "Database unavailable" });

export function payslip(overrides: Partial<MyPayslip> = {}): MyPayslip {
  return {
    id: 5,
    doc_type: "PAYSLIP_V2",
    number: "PS/ACME/2026-27/0005",
    title: "Payslip — November 2026",
    version: 1,
    status: "PUBLISHED",
    draft: false,
    legal_entity_id: 1,
    employee_id: 42,
    run_id: 31,
    run_employee_id: 310,
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    issue_date: "2026-11-28",
    published_at: "2026-11-28T10:00:00",
    first_viewed_at: null,
    supersedes_document_id: null,
    labels: [],
    languages: ["en"],
    sha256: "ab",
    bytes: 1200,
    file_name: "payslip-E0042-2026-11.pdf",
    row_version: 1,
    period_label: "November 2026",
    currency: "INR",
    net: { amount: "82410.00", currency: "INR" },
    payment: "Processing",
    ...overrides,
  };
}

export function content(overrides: Partial<PayslipContent> = {}): PayslipContent {
  return {
    kind: "PAYSLIP",
    schema: 1,
    title_key: "PAYSLIP",
    replaces: null,
    version: 1,
    employer: { legal_name: "Acme India Pvt Ltd", trade_name: null, code: "IN01", country_code: "IN", address_line: "Bengaluru", registration_lines: [] },
    employee: { id: 42, name: "Asha Rao", code: "E0042", designation: "Engineer", department: "R&D", branch: null, joining_date: "2024-04-01", pay_group: "Monthly IN", bank: "HDFC Bank ••••4321" },
    period: { start: "2026-11-01", end: "2026-11-30", pay_date: "2026-11-30", label: "November 2026", tax_year: "2026-27" },
    run: { id: 31, number: "R-31", run_type: "REGULAR" },
    currency: "INR",
    earnings: [
      { code: "BASIC", label: "Basic", amount: "48500.00", rate: null, units: null, period_ref_label: null, statutory: false, fixture: false, ytd: "388000.00" },
      { code: "HRA", label: "House rent allowance", amount: "48500.00", rate: null, units: null, period_ref_label: null, statutory: false, fixture: false, ytd: null },
    ],
    deductions: [
      { code: "PF_EE", label: "Provident fund", amount: "5820.00", rate: null, units: null, period_ref_label: null, statutory: true, fixture: true },
      { code: "TDS", label: "Income tax", amount: "8770.00", rate: null, units: null, period_ref_label: null, statutory: true, fixture: false },
    ],
    reimbursements: [],
    employer_contributions: [{ code: "PF_ER", label: "Employer PF", amount: "5820.00", rate: null, units: null, period_ref_label: null, statutory: true, fixture: true }],
    employer_note: "Paid by your employer — not part of your take-home pay",
    totals: { gross: "97000.00", deductions: "14590.00", reimbursements: "0.00", net: "82410.00", net_words: "Eighty-two thousand four hundred ten rupees" },
    payment: { key: "PROCESSING", text: "Processing", method: null, reference: null },
    attendance: { days_in_period: "30", paid_days: "30", lop_days: "0", overtime_hours: "0", leave_days: "0" },
    leave_balances: null,
    tax_summary: null,
    show_ytd: true,
    labels: ["FIXTURE — not law"],
    languages: ["en"],
    locale: "en-IN",
    template: null,
    ...overrides,
  };
}

export function payslipDetail(overrides: Partial<MyPayslipDetail> = {}): MyPayslipDetail {
  return { ...payslip(), content: content(), ...overrides };
}

export function period(overrides: Partial<MyPaymentPeriod> = {}): MyPaymentPeriod {
  return {
    id: 71,
    run_id: 31,
    employee_id: 42,
    amount: { amount: "82410.00", currency: "INR" },
    status: "OPEN",
    pay_date: "2026-11-30",
    paid_to_date: { amount: "0.00", currency: "INR" },
    returned: { amount: "0.00", currency: "INR" },
    outstanding: { amount: "82410.00", currency: "INR" },
    run_label: "Monthly IN · Nov 2026",
    instructions: [
      {
        id: 501,
        reference: "PAY-501",
        obligation_id: 71,
        run_id: 31,
        employee_id: 42,
        batch_id: 9,
        sequence: 1,
        amount: { amount: "82410.00", currency: "INR" },
        account_amount: { amount: "82410.00", currency: "INR" },
        beneficiary: { holder_name_masked: "A••• R••", account_masked: "••••4321", bank_name: "HDFC Bank", country: "IN", currency: "INR", routing_scheme: "IFSC", routing_code_masked: "HDFC••••234" },
        status: "SUBMITTED",
        label: { key: "SUBMITTED_MANUAL_UNVERIFIED", text: "Submitted for manual payment — unverified", badge: null },
        submission_channel: "MANUAL",
        evidence_status: "UNVERIFIED",
        sandbox: false,
        submitted_at: "2026-11-28T09:00:00",
        settled_at: null,
        settled: null,
        reconciled_at: null,
        returned_at: null,
        failure_message: null,
        expected_settlement_date: "2026-11-30",
        reissue_of_instruction_id: null,
        events: [{ status: "SUBMITTED", label: "Submitted for manual payment — unverified", at: "2026-11-28T09:00:00" }],
      },
    ],
    ...overrides,
  };
}

export function account(overrides: Partial<MyBankAccount> = {}): MyBankAccount {
  return {
    id: 3,
    payee_type: "EMPLOYEE",
    payee_id: 42,
    employee_id: 42,
    holder_name: "Asha Rao",
    country: "IN",
    currency: "INR",
    account_masked: "••••4321",
    last4: "4321",
    has_iban: false,
    routing: { ifsc: "HDFC0001234" },
    bank_name: "HDFC Bank",
    branch_name: null,
    account_type: "SAVINGS",
    allocation: { type: "PRIMARY", value: null, order: 0 },
    status: "ACTIVE",
    verification_status: "VERIFIED",
    verification_method: "DOCUMENT_REVIEW",
    verified_at: "2026-01-10T10:00:00",
    approved_at: "2026-01-10T10:00:00",
    usable_from: null,
    cooling_off: false,
    ended_at: null,
    effective_from: "2026-01-10",
    effective_to: null,
    replaces_account_id: null,
    replaced_by_account_id: null,
    status_reason: null,
    row_version: 2,
    created_at: "2026-01-09T10:00:00",
    under_review: false,
    update_required: false,
    ...overrides,
  };
}

export function change(overrides: Partial<MyBankChange> = {}): MyBankChange {
  return {
    id: 12,
    bank_account_id: 4,
    payee_type: "EMPLOYEE",
    payee_id: 42,
    employee_id: 42,
    kind: "REPLACE",
    replaces_account_id: 3,
    channel: "SELF",
    status: "PENDING_APPROVAL",
    approval_request_id: 90,
    decided_at: null,
    decision_reason: null,
    cooling_off_waived: false,
    after: account({ id: 4, account_masked: "••••9876", bank_name: "ICICI Bank", status: "DRAFT", verification_status: "PENDING" }),
    before: [account()],
    row_version: 1,
    created_at: "2026-11-20T10:00:00",
    ...overrides,
  };
}

export function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 8,
    employee_id: 42,
    legal_entity_id: 1,
    pay_group_id: 3,
    kind: "LOAN",
    principal: { amount: "60000.00", currency: "INR" },
    currency: "INR",
    purpose: "Laptop",
    tenure: 6,
    interest: { rate_percent: "0", method: "FLAT" },
    status: "ACTIVE",
    balance: { amount: "40000.00", currency: "INR" },
    schedule_version: 1,
    recover_balance_on_exit: true,
    application_issues: [],
    approval_request_id: 77,
    applied_by_user_id: 9,
    decided_at: "2026-09-01T10:00:00",
    disbursed_on: "2026-09-05",
    closed_at: null,
    status_reason: null,
    row_version: 3,
    created_at: "2026-08-30T10:00:00",
    schedule: {
      kind: "LOAN",
      method: "FLAT",
      currency: "INR",
      principal: "60000.00",
      annual_rate_percent: "0",
      total_interest: "0.00",
      total_payable: "60000.00",
      instalments: [
        { number: 1, principal: "10000.00", interest: "0.00", total: "10000.00", balance_after: "50000.00" },
        { number: 2, principal: "10000.00", interest: "0.00", total: "10000.00", balance_after: "40000.00" },
      ],
      explanation: "6 equal monthly instalments, no interest.",
    },
    transactions: [
      { id: 1, kind: "DISBURSEMENT", amount: { amount: "60000.00", currency: "INR" }, schedule_version: 1, run_employee_id: null, scheduled: null, effective_on: "2026-09-05", reference: null, note: null, action_id: null, created_at: null },
    ],
    actions: [],
    ...overrides,
  };
}

export function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 21,
    employee_id: 42,
    legal_entity_id: 1,
    pay_group_id: 3,
    claim_type: "TRAVEL",
    claim_type_name: "Travel",
    taxability: "EXEMPT",
    expense_date: "2026-11-10",
    amount: { amount: "1250.50", currency: "INR" },
    merchant: "Uber",
    description: "Client visit",
    payout_route: "PAYROLL",
    payout: null,
    approved: null,
    fx_conversion: null,
    status: "SUBMITTED",
    flags: [],
    approval_request_id: 80,
    receipts: [{ id: 1, file_name: "uber.pdf", sha256: "x", mime: "application/pdf", bytes: 2000, uploaded_at: null }],
    paid_ref: null,
    decided_at: null,
    status_reason: null,
    row_version: 1,
    created_at: "2026-11-11T10:00:00",
    ...overrides,
  };
}

export function claimTypes(overrides: Partial<ClaimTypesResponse> = {}): ClaimTypesResponse {
  return {
    employee_id: 42,
    date: "2026-11-20",
    enabled: true,
    currency: "INR",
    status: "RESOLVED",
    policy: { id: 4, name: "Default" },
    policy_version: 1,
    submission_window_days: 60,
    claim_types: [
      {
        code: "TRAVEL",
        name: "Travel",
        taxability: "EXEMPT",
        limit_per_claim: { amount: "5000.00", currency: "INR" },
        limit_per_month: { amount: "20000.00", currency: "INR" },
        limit_per_year: null,
        receipt_required_above: { amount: "500.00", currency: "INR" },
      },
    ],
    ...overrides,
  };
}

/** GET /me/payroll/preferences (services/self_service.py `preferences`). */
export function preferences(overrides: Partial<PayrollPreferences> = {}): PayrollPreferences {
  return {
    employee_id: 42,
    as_of: "2026-10-22",
    time_zone: "Asia/Kolkata",
    legal_entity: { id: 1, name: "Acme India Pvt Ltd", country_code: "IN" },
    payslip: { queries_enabled: true, pdf_protection: "EMPLOYEE_SECRET" },
    pay_group: { id: 3, code: "IN-M", name: "Monthly IN", currency: "INR", next_pay_date: "2026-10-31", next_period: { id: 5, start: "2026-10-01", end: "2026-10-31", status: "OPEN" } },
    bank_accounts: {
      self_service_enabled: true,
      change_requires_approval: true,
      cooling_off_hours: 48,
      verification_methods: ["DOCUMENT_REVIEW"],
      split_payments_enabled: false,
      max_accounts_per_payee: 1,
      effective_max_accounts: 1,
      allowed_countries: null,
    },
    unavailable: [],
    ...overrides,
  };
}

/** GET /me/payroll/loan-policy (services/loans.py `policy_preview`). */
export function loanPolicy(overrides: Partial<LoanPolicyPreview> = {}): LoanPolicyPreview {
  return {
    employee_id: 42,
    as_of: "2026-10-22",
    currency: "INR",
    protected_net_percent: "50",
    loan: {
      enabled: true,
      policy_status: "RESOLVED",
      policy: { name: "Staff loans", version: 2, effective_from: "2026-04-01" },
      limits: {
        max_amount_formula: "3 * monthly_gross",
        max_amount: { amount: "200000.00", currency: "INR" },
        max_tenure_months: 24,
        interest_rate_percent: "0",
        interest_method: "FLAT",
        max_instalment_percent_of_net: "30",
        min_service_months: 6,
        max_active_loans: 1,
        recover_balance_on_exit: true,
      },
      usage: { open: 0, service_months: 18 },
    },
    advance: {
      enabled: false,
      policy_status: "RESOLVED",
      policy: { name: "Advances", version: 1, effective_from: "2026-04-01" },
      limits: { max_percent_of_monthly_net: "50", max_amount: null, recover_in_runs: 2, max_per_year: 2 },
      usage: { open: 0, this_year: 0 },
    },
    ...overrides,
  };
}

/** One own payslip question (services/payslip_queries.py `query_json(as_staff=False)`). */
export function myQuestion(overrides: Partial<MyPayslipQuestion> = {}): MyPayslipQuestion {
  return {
    id: 7,
    document_id: 5,
    payslip: { id: 5, number: "PS-2026-11-0042", version: 1, period_label: "November 2026", period_start: "2026-11-01", period_end: "2026-11-30" },
    question: "Why is my HRA lower than last month?",
    status: "ANSWERED",
    answer: "HRA was prorated for 2 days of unpaid leave.",
    answered_at: "2026-12-02T10:00:00",
    closed_at: null,
    created_at: "2026-12-01T09:00:00",
    row_version: 2,
    ...overrides,
  };
}
