/** Shared fixtures for the leave v2 component tests (not a test file: jest only runs *.test.tsx). */

import type {
  ApprovalsInbox,
  LeaveAccess,
  LeaveBalance,
  LeaveDetail,
  LeavePreview,
  LeaveTypeV2,
} from "@/lib/leave/types";

export function access(overrides: Partial<LeaveAccess> = {}): LeaveAccess {
  return {
    v2_enabled: true,
    local_today: "2026-11-02",
    employee_id: 42,
    permissions: { "leave:apply": ["SELF"], "leave:read": ["SELF"] },
    manage_company: false,
    half_day_enabled: true,
    discussion_enabled: true,
    return_enabled: true,
    on_behalf_enabled: true,
    ...overrides,
  };
}

export function leaveType(overrides: Partial<LeaveTypeV2> = {}): LeaveTypeV2 {
  return {
    id: 1, code: "CL", name: "Casual Leave", display_name: "Casual Leave", description: null, kind: "STANDARD",
    category: "CASUAL", unit: "DAY", sensitivity: "STANDARD", is_paid: true, is_unlimited: false, is_active: true,
    counts_non_working_days: false, allow_half_day: true, color_token: "leave-2", icon: null, display_order: 1,
    ...overrides,
  };
}

export function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    leave_type_code: "CL", name: "Casual Leave", unit: "DAY", scope: "CYCLE", unlimited: false,
    cycle_start: "2026-01-01", cycle_end: "2026-12-31", opening: 0, credited: 12, used: 6, encashed: 0, lapsed: 0,
    expired: 0, adjusted: 0, balance: 6, pending: 1, reserved_encashment: 0, available: 5, expiring: [], frozen: false,
    eligibility: "ELIGIBLE", available_from: null, color_token: "leave-2", icon: null, category: "CASUAL", is_paid: true,
    ...overrides,
  };
}

export function preview(overrides: Partial<LeavePreview> = {}): LeavePreview {
  return {
    employee_id: 42, employee_name: "Divya Rao", leave_type: "CL", leave_type_name: "Casual Leave", unit: "DAY",
    start_date: "2026-11-02", end_date: "2026-11-02", start_portion: "FULL", end_portion: "FULL",
    days: [{ date: "2026-11-02", requested: "FULL", portion: "FULL", charged: 1, charge_reason: "WORKING", working_portion: "FULL", employed: true, weekly_off: false, holiday: null, holiday_type: null }],
    charged_units: 1, balance_before: 5, balance_after: 4, unlimited: false, issues: [], flags: [], blocking: false,
    split: null, documents_required: [], plan: null, auto_approve: false, reason_rule: "OPTIONAL", documents_allowed: true,
    ...overrides,
  };
}

export function detail(overrides: Partial<LeaveDetail> = {}): LeaveDetail {
  return {
    id: 5, employee_id: 42, employee_name: "Divya Rao", department: "Engineering", leave_type: "CL",
    start_date: "2026-11-09", end_date: "2026-11-11", number_of_days: 3, start_portion: "FULL", end_portion: "FULL",
    cancellation_status: null, reason: "Family wedding", status: "pending", remarks: null,
    created_at: "2026-11-01T09:00:00Z", decided_at: null,
    steps: [{ step_order: 1, approver_type: "primary_manager", approver_label: "Reporting manager", approver: "Arjun Das", status: "pending", acted_by: null, acted_as: null, acted_at: null, remarks: null }],
    can_act: false, acting_as: null, status_v2: "PENDING", version: 1, source: "SELF", flags: [], issues: [],
    is_emergency: false, parent_leave_id: null, submitted_at: "2026-11-01T09:00:00Z", leave_type_name: "Casual Leave",
    color_token: "leave-2", masked: false, row_version: 1, contact_note: null, allowed_actions: ["WITHDRAW"], siblings: [],
    days: [
      { date: "2026-11-09", portion: "FULL", units: 1, counted: true, charge_reason: "WORKING" },
      { date: "2026-11-10", portion: "FULL", units: 1, counted: true, charge_reason: "WORKING" },
      { date: "2026-11-11", portion: "FULL", units: 1, counted: true, charge_reason: "WORKING" },
    ],
    ...overrides,
  };
}

export function inbox(): ApprovalsInbox {
  return {
    requests: [
      {
        id: 11, employee_id: 7, employee_name: "Ravi Kumar", department: "Sales", leave_type: "CL", leave_type_name: "Casual Leave",
        color_token: "leave-2", start_date: "2026-11-12", end_date: "2026-11-13", number_of_days: 2, start_portion: "FULL",
        end_portion: "FULL", cancellation_status: null, reason: "Hospital visit", status: "pending", remarks: null,
        created_at: "2026-11-01T08:00:00Z", decided_at: null, steps: [], can_act: true, acting_as: "approver",
        flags: ["EMERGENCY", "ELIGIBILITY_VERIFY"], issues: [{ code: "COVERAGE_CONFLICT", severity: "WARNING", message: "Sales floor: too many people would be away on 12 Nov 2026." }],
        source: "ON_BEHALF",
      },
    ],
    changes: [
      {
        id: 21, leave_id: 9, employee_id: 8, kind: "PARTIAL_CANCEL", status: "PENDING", proposed: { dates: ["2026-11-20"] },
        reason: "Back early", initiator: "EMPLOYEE", from_version: 1, decision_note: null, units_delta: 0,
        created_at: "2026-11-01T08:00:00Z", decided_at: null, applied_at: null, acknowledged_at: null, row_version: 1,
        employee_name: "Meera Pillai", leave_type: "earned", start_date: "2026-11-19", end_date: "2026-11-21", number_of_days: 3,
      },
    ],
    comp_off_claims: [
      {
        id: 31, employee_id: 9, employee_name: "Nikhil Jain", worked_date: "2026-10-25", source: "WEEKLY_OFF_WORK",
        worked_minutes: 500, credit_units: 1, leave_type: "COMP", status: "PENDING", reason: "Release support",
        decision_note: null, expires_on: null, created_at: "2026-10-26T08:00:00Z", row_version: 1, can_decide: true,
      },
    ],
    encashments: [
      {
        id: 41, employee_id: 10, employee_name: "Sneha Iyer", leave_type: "earned", units: 3, trigger: "ON_REQUEST",
        status: "PENDING", reason: null, decision_note: null, cycle_start: "2026-01-01", payroll_reference: null,
        paid_at: null, created_at: "2026-10-30T08:00:00Z", decided_at: null, row_version: 1, can_decide: true,
      },
    ],
  };
}
