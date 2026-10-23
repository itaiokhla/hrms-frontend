/** Shared fixtures for the inputs-area tests (not a test file: jest only runs *.test.tsx). */

import { act } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import { type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import type { ApprovalRequest, ArrearsProposal, Claim, Loan, OvertimeEntry, Task, WageInput } from "../types";

export function me(permissions: Partial<Record<PermissionCode, Scope[]>>, employeeId: number | null = null): Me {
  return {
    user: { id: 7, email: "pm@acme.io", full_name: "Pat Manager", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: employeeId ? { id: employeeId, employee_code: "E0042", first_name: "Pat", last_name: "Manager", position: null, department: null, has_photo: false } : null,
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

export const conflict = () => payrollError(409, { detail: { message: "The input changed since you loaded it." }, code: "STALE_ROW_VERSION" });
export const notFound = () => payrollError(404, { detail: "Wage input not found" });

export function wageInput(overrides: Partial<WageInput> = {}): WageInput {
  return {
    id: 11,
    employee_id: 142,
    legal_entity_id: 1,
    pay_group_id: 3,
    component_id: 9,
    component_code: "BONUS",
    amount: { amount: "12500.50", currency: "INR" },
    units: null,
    rate: null,
    currency: "INR",
    fx_rule: null,
    target_period: { id: 5, start: "2026-11-01", end: "2026-11-30" },
    reason: "Festival bonus",
    source: "MANUAL",
    status: "PENDING_APPROVAL",
    recurrence: null,
    recurrence_parent_id: null,
    external_ref: null,
    import_id: null,
    flags: [],
    approval_request_id: 70,
    reserved_by_run_employee_id: null,
    consumed_by_run_employee_id: null,
    created_by_user_id: 7,
    submitted_at: "2026-10-20T10:00:00",
    decided_at: null,
    status_reason: null,
    row_version: 2,
    created_at: "2026-10-20T09:00:00",
    ...overrides,
  };
}

export function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 70,
    module: "wage_input",
    module_label: "payroll input",
    subject_type: "wage_input",
    subject_id: 11,
    subject_employee_id: 142,
    subject_employee_name: "Asha Rao",
    status: "PENDING",
    current_step: 1,
    pending_reason: null,
    amount: { amount: "12500.50", currency: "INR" },
    requested_by_user_id: 9,
    requested_by: "Ravi Payroll",
    context: {},
    created_at: "2026-10-20T10:00:00",
    decided_at: null,
    steps: [
      { step_order: 1, approver_type: "permission_holders", approver_label: "Approvers", approver: "Payroll input approvers", role_id: null, specific_user_id: null, status: "pending", acted_by: null, acted_as: null, acted_at: null, remarks: null },
    ],
    can_act: true,
    acting_as: "approver",
    ...overrides,
  };
}

export function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 21,
    employee_id: 142,
    legal_entity_id: 1,
    pay_group_id: 3,
    kind: "LOAN",
    principal: { amount: "60000.00", currency: "INR" },
    currency: "INR",
    purpose: "Medical",
    tenure: 3,
    interest: null,
    status: "ACTIVE",
    balance: { amount: "40000.00", currency: "INR" },
    schedule_version: 1,
    recover_balance_on_exit: true,
    application_issues: [],
    approval_request_id: 71,
    applied_by_user_id: 7,
    decided_at: "2026-09-01T10:00:00",
    disbursed_on: "2026-09-05",
    closed_at: null,
    status_reason: null,
    row_version: 3,
    created_at: "2026-08-30T10:00:00",
    schedule: {
      kind: "LOAN",
      method: "EQUAL",
      currency: "INR",
      principal: "60000.00",
      annual_rate_percent: "0",
      total_interest: "0.00",
      total_payable: "60000.00",
      instalments: [
        { number: 1, principal: "20000.00", interest: "0.00", total: "20000.00", balance_after: "40000.00" },
        { number: 2, principal: "20000.00", interest: "0.00", total: "20000.00", balance_after: "20000.00" },
        { number: 3, principal: "20000.00", interest: "0.00", total: "20000.00", balance_after: "0.00" },
      ],
      explanation: "60,000.00 repaid in 3 equal monthly instalments without interest.",
    },
    transactions: [
      { id: 1, kind: "DISBURSEMENT", amount: { amount: "60000.00", currency: "INR" }, schedule_version: 1, run_employee_id: null, scheduled: null, effective_on: "2026-09-05", reference: "UTR123", note: null, action_id: null, created_at: "2026-09-05T10:00:00" },
    ],
    actions: [],
    ...overrides,
  };
}

export function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 31,
    employee_id: 142,
    legal_entity_id: 1,
    pay_group_id: 3,
    claim_type: "TRAVEL",
    claim_type_name: "Travel",
    taxability: "EXEMPT",
    expense_date: "2026-10-10",
    amount: { amount: "1840.00", currency: "INR" },
    merchant: "Metro Cabs",
    description: "Client visit",
    payout_route: "PAYROLL",
    payout: null,
    approved: null,
    fx_conversion: null,
    status: "SUBMITTED",
    flags: [],
    approval_request_id: 72,
    receipts: [{ id: 5, file_name: "cab.pdf", sha256: "abcdef0123456789abcdef0123456789", mime: "application/pdf", bytes: 20480, uploaded_at: "2026-10-10T12:00:00" }],
    paid_ref: null,
    decided_at: null,
    status_reason: null,
    row_version: 1,
    created_at: "2026-10-10T11:00:00",
    ...overrides,
  };
}

export function overtime(overrides: Partial<OvertimeEntry> = {}): OvertimeEntry {
  return {
    id: 41,
    employee_id: 142,
    employee_name: "Asha Rao",
    date: "2026-10-18",
    start_at: null,
    end_at: null,
    minutes_requested: 150,
    minutes_computed: null,
    minutes_approved: null,
    bucket: "WORKDAY",
    source: "APPROVED_REQUESTS",
    status: "PENDING_APPROVAL",
    comp_off: false,
    pre_approval: false,
    reason: "Release night",
    version: 1,
    supersedes_id: null,
    approval_request_id: 73,
    requested_by_user_id: 8,
    decided_at: null,
    consumed_by_run_employee_id: null,
    row_version: 1,
    created_at: "2026-10-18T20:00:00",
    approval: { status: "PENDING", current_step: 1, pending_reason: null },
    ...overrides,
  };
}

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 51,
    title: "Install 40 meters",
    description: null,
    project: "Metro",
    category: null,
    task_type: "INSTALL",
    quantity: "40.0000",
    accepted_quantity: null,
    unit: "pieces",
    rate: { amount: "25.50", currency: "INR" },
    due_date: "2026-10-31",
    completed_on: null,
    status: "SUBMITTED",
    external_ref: null,
    approval_request_id: 74,
    approved_on: null,
    paid_in_run_id: null,
    created_by_user_id: 7,
    submitted_at: "2026-10-19T10:00:00",
    decided_at: null,
    reversed_at: null,
    status_reason: null,
    row_version: 2,
    assignees: [
      { employee_id: 142, employee_name: "Asha Rao", split_percent: "60.00" },
      { employee_id: 143, employee_name: "Vik Singh", split_percent: "40.00" },
    ],
    evidence: [],
    warnings: [],
    created_at: "2026-10-18T10:00:00",
    approval: { status: "PENDING", current_step: 1, pending_reason: null },
    ...overrides,
  };
}

/** An arrears proposal as services/retro.py `proposal_json` returns it (lines only on the detail GET). */
export function arrearsProposal(overrides: Partial<ArrearsProposal> = {}, withLines = true): ArrearsProposal {
  const base: ArrearsProposal = {
    id: 5,
    employee_id: 142,
    legal_entity_id: 1,
    pay_group_id: 3,
    original_run_id: 12,
    original_run_employee_id: 340,
    original_period: { id: 9, start: "2026-08-01", end: "2026-08-31" },
    currency: "INR",
    trigger: "COMPENSATION",
    trigger_ref: { type: "compensation_assignment", id: 77 },
    changed_sources: ["segments", "components"],
    base_proposal_id: null,
    superseded_by_id: null,
    totals: {
      arrears: { amount: "4500.50", currency: "INR" },
      recovery: { amount: "-1200.00", currency: "INR" },
      net_change: { amount: "3300.50", currency: "INR" },
    },
    issues: [],
    status: "PENDING_APPROVAL",
    payment_mode: "NEXT_REGULAR_RUN",
    recovery_mode: "NEXT_RUN",
    retro_run_id: null,
    approval_request_id: 81,
    reason: "Back-dated increment from 1 Aug",
    decision_note: null,
    engine_version: "1.0.0",
    calc_hash: "a".repeat(64),
    created_at: "2026-10-20T10:00:00",
    decided_at: null,
    settled_at: null,
    row_version: 3,
  };
  const lines = withLines
    ? {
        lines: [
          {
            id: 51, component_code: "BASIC", kind: "EARNING", category: null, tags: [], direction: "ARREARS",
            original: { amount: "30000.00", currency: "INR" }, recalculated: { amount: "34500.50", currency: "INR" },
            delta: { amount: "4500.50", currency: "INR" }, period_ref: { start: "2026-08-01", end: "2026-08-31" },
            explanation: "Basic went up from 1 Aug 2026.", instalments: [],
          },
          {
            id: 52, component_code: "PF_EE", kind: "DEDUCTION", category: null, tags: [], direction: "RECOVERY",
            original: { amount: "-3600.00", currency: "INR" }, recalculated: { amount: "-4800.00", currency: "INR" },
            delta: { amount: "-1200.00", currency: "INR" }, period_ref: { start: "2026-08-01", end: "2026-08-31" },
            explanation: null, instalments: [],
          },
        ],
        outstanding: { amount: "0.00", currency: "INR" },
      }
    : {};
  return { ...base, ...lines, ...overrides };
}
