/** Shared fixtures for the overview and pay-run tests (not a test file: jest only runs *.test.tsx). */

import { act } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import type { Overview, Run, RunEmployeeDetail, RunSummary } from "../types";

export function me(permissions: Partial<Record<PermissionCode, Scope[]>>, userId = 7): Me {
  return {
    user: { id: userId, email: "pm@acme.io", full_name: "Pat Manager", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  } as Me;
}

const all = (codes: PermissionCode[]) => Object.fromEntries(codes.map((c) => [c, ["COMPANY"] as Scope[]])) as Partial<Record<PermissionCode, Scope[]>>;

/** Prepares, calculates, reviews and finalizes; no approve. */
export const PAYROLL_ADMIN = me(
  all([P.PAYROLL_RUN_READ, P.PAYROLL_RUN_CREATE, P.PAYROLL_RUN_CALCULATE, P.PAYROLL_RUN_REVIEW, P.PAYROLL_RUN_FINALIZE, P.PAYROLL_RUN_CLOSE, P.PAYROLL_RUN_REVERSE, P.PAYROLL_INPUTS_EDIT, P.PAYROLL_CONFIGURATION_READ, P.PAYROLL_STATUTORY_REVIEW]),
);
/** Reads runs only. */
export const VIEWER = me(all([P.PAYROLL_RUN_READ]));
/** Approver (different user). */
export const APPROVER = me(all([P.PAYROLL_RUN_READ, P.PAYROLL_RUN_APPROVE]), 9);
/** Payroll workspace without pay-run access (inputs only). */
export const INPUTS_ONLY = me(all([P.PAYROLL_INPUTS_READ, P.PAYROLL_CONFIGURATION_READ]));

export function signIn(user: Me) {
  act(() => {
    useSession.setState({ me: user, status: "authenticated" });
  });
}

/** Strip the bidi and narrow-space characters Intl adds, for text assertions. */
export const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜]/g, "");

export const conflict = (message = "The run was changed by someone else. Reload and try again.") =>
  payrollError(409, { detail: { message, code: "ROW_VERSION_CONFLICT" } });
export const forbidden = () => payrollError(403, { detail: "Forbidden" });
export const notFound = () => payrollError(404, { detail: "Pay run not found" });

export function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 41,
    number: "PR-2026-0041",
    label: "Nov 2026 · Monthly IN",
    run_type: "REGULAR",
    status: "REVIEW_REQUIRED",
    stage: 4,
    legal_entity_id: 1,
    pay_group: { id: 3, code: "IN-M", name: "Monthly IN" },
    period: { id: 5, start: "2026-11-01", end: "2026-11-30", pay_date: "2026-11-30", status: "PROCESSING", tax_year: "2026-27", input_cutoff: "2026-11-25", approval_deadline: "2026-11-27" },
    currency: "INR",
    stale: false,
    stale_reasons: [],
    population: { eligible: 12, included: 10, excluded: 2, on_hold: 0, excluded_by_reason: { NO_SALARY: 2 } },
    totals: { INR: { gross: "612500.00", net: "548250.75", employees: 10 } },
    reverses_run_id: null,
    environment: "production",
    row_version: 6,
    created_at: "2026-11-20T09:00:00",
    available_actions: ["SUBMIT_FOR_APPROVAL", "RECALCULATE", "CANCEL"],
    exceptions: { open: 2, blocking: 0 },
    approval_request_id: null,
    calculation_job_id: null,
    calculated_at: "2026-11-21T10:00:00",
    calculated_by_user_id: 7,
    created_by_user_id: 7,
    status_reason: null,
    ...overrides,
  };
}

export function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run: run(),
    totals: {
      INR: { gross: "612500.00", deductions: "64249.25", reimbursements: "0.00", net: "548250.75", employer_cost: "655000.00", employees: 10 },
      USD: { gross: "8000.00", deductions: "0.00", reimbursements: "0.00", net: "8000.00", employer_cost: "8000.00", employees: 1 },
    },
    population: { eligible: 12, included: 10, excluded: 2, on_hold: 0, excluded_by_reason: { NO_SALARY: 2 }, calculated: 10, errors: 0, pending: 0 },
    reconciles: true,
    liabilities: [
      { scheme: "PF", payee_authority: "EPFO", currency: "INR", employee_amount: "18000.00", employer_amount: "18000.00", due_date: "2026-12-15", fixture: true, label: "FIXTURE — not law" },
    ],
    settings: {},
    pack: { country: "IN", capability: "FIXTURE", verified: false, versions: [{ code: "IN", version: "0.1", is_fixture: true, label: "FIXTURE — not law" }], evaluated: [], labels: ["Compliance not verified", "FIXTURE — not law"], attestation_id: null, country_confirmed: true },
    fx: null,
    exceptions: { open: 2, by_severity: { FLAG: 2 }, by_code: { NET_VARIANCE: 2 }, variance_pending: 2 },
    calculation: { engine_version: "2.0.0", calculated_at: "2026-11-21T10:00:00", calculated_by_user_id: 7, progress: null, stale: false, stale_reasons: [] },
    ...overrides,
  };
}

export function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    filters: { period_from: "2026-11-01", period_to: "2026-11-30" },
    kpis: { eligible: 12, with_salary: 10, without_salary: 2, processed: 0, paid: 0, on_hold: 1 },
    consistency: { eligible_equals_with_plus_without: true },
    money: [
      { currency: "INR", stage: "Draft", gross: "612500.00", net: "548250.75", employer_cost: "655000.00", employees: 10, runs: 1 },
      { currency: "USD", stage: "Draft", gross: "8000.00", net: "7650.25", employer_cost: "8000.00", employees: 1, runs: 1 },
    ],
    converted: null,
    statutory: [],
    exceptions: { open: 2, blocking: 1, by_code: { MISSING_BANK: 1, NET_VARIANCE: 1 } },
    deadlines: [
      {
        pay_group_id: 3,
        pay_group: "IN-M",
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        input_cutoff: "2026-11-25",
        approval_deadline: "2026-11-27",
        pay_date: "2026-11-30",
        run: { id: 41, number: "PR-2026-0041", status: "REVIEW_REQUIRED", stage: "Draft" },
      },
    ],
    empty_state: null,
    processing_disabled_reason: null,
    definitions: { paid: "Every payment instruction settled or reconciled with verified evidence." },
    ...overrides,
  };
}

export function employeeDetail(overrides: Partial<RunEmployeeDetail> = {}): RunEmployeeDetail {
  return {
    run: { id: 41, number: "PR-2026-0041", status: "REVIEW_REQUIRED", currency: "INR" },
    id: 501,
    employee: { id: 142, code: "E0142", name: "Asha Rao", hire_date: "2024-01-10", termination_date: null },
    employee_assignment_id: 88,
    status: "CALCULATED",
    exclusion_reason: null,
    exclusion_note: null,
    hold_type: null,
    hold: null,
    error: null,
    currency: "INR",
    totals: {
      gross: { amount: "61250.00", currency: "INR" },
      deductions: { amount: "6125.50", currency: "INR" },
      reimbursements: { amount: "0.00", currency: "INR" },
      net: { amount: "55124.50", currency: "INR" },
      employer_cost: { amount: "65000.00", currency: "INR" },
    },
    previous: { net: "54000.00", currency: "INR", period_ref: "2026-10" },
    net_change_percent: "2.08",
    lines: [
      {
        id: 9001,
        component: "BASIC",
        component_id: 1,
        name: "Basic salary",
        kind: "EARNING",
        category: null,
        stage: 2,
        amount: { amount: "41250.00", currency: "INR" },
        units: "27.5",
        rate: "1500",
        period_ref: null,
        segment: null,
        tags: [],
        visibility: "EMPLOYEE",
        explanation: "Monthly basic prorated for 27.5 of 30 paid days.",
        trace: { formula: "45000 × 27.5 / 30", rounding: { mode: "HALF_UP", increment: "0.01" }, unrounded: "41250.000" },
        sources: [{ type: "compensation_assignment", id: 12, link: "/payroll/compensation/12" }, { type: "attendance", restricted: true }],
        sort_order: 1,
        statutory: false,
        fixture: false,
      },
      {
        id: 9002,
        component: "PF_EE",
        component_id: 5,
        name: "Provident fund",
        kind: "DEDUCTION",
        category: null,
        stage: 5,
        amount: { amount: "1800.00", currency: "INR" },
        units: null,
        rate: null,
        period_ref: null,
        segment: null,
        tags: [],
        visibility: "EMPLOYEE",
        explanation: null,
        trace: {},
        sources: [],
        sort_order: 2,
        statutory: true,
        fixture: true,
        label: "FIXTURE — not law",
      },
    ],
    hidden_lines: 1,
    ledger: null,
    flags: [],
    exceptions: [],
    snapshot: { id: 3, version: 2, content_hash: "abc" },
    calc_hash: "h",
    content_hash: "c",
    engine_version: "2.0.0",
    calculated_at: "2026-11-21T10:00:00",
    row_version: 3,
    ...overrides,
  };
}
