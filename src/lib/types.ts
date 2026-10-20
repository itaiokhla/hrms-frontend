import type { PermissionCode, Scope } from "./permissions.generated";

export interface Me {
  user: {
    id: number;
    email: string;
    full_name: string;
    mfa_enabled: boolean;
    permission_version: number;
    last_login_at: string | null;
  };
  company: {
    id: number;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    subscription: { status: string; plan: string; trial_ends_at: string | null; active: boolean };
  };
  employee: {
    id: number;
    employee_code: string;
    first_name: string;
    last_name: string;
    position: string | null;
    department: string | null;
    has_photo: boolean;
  } | null;
  roles: { id: number; name: string; system_key: string | null }[];
  permissions: Partial<Record<PermissionCode, Scope[]>>;
  is_company_admin: boolean;
  registry_version: string;
}

export interface Page<T> {
  total: number;
  items: T[];
  skip: number;
  limit: number;
}

export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  position: string | null;
  department_id: number | null;
  department: string | null;
  shift_id: number | null;
  shift: string | null;
  location: string | null;
  hire_date: string | null;
  termination_date: string | null;
  is_active: boolean;
  manager_id: number | null;
  manager_name: string | null;
  has_login: boolean;
  has_photo: boolean;
  face_registered: boolean;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  base_salary?: number | null;
}

export interface Department {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  head_employee_id: number | null;
  head_name: string | null;
  employee_count: number;
}

export interface Shift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  is_flexible: boolean;
  is_active: boolean;
}

export interface OrgNode {
  id: number;
  full_name: string;
  position: string | null;
  department: string | null;
  location: string | null;
  manager_id: number | null;
  report_count: number;
  has_photo: boolean;
}

export interface Delegation {
  id: number;
  delegator_employee_id: number;
  delegator_name: string;
  delegate_employee_id: number;
  delegate_name: string;
  module: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  active: boolean;
  revoked: boolean;
}

export interface SecondaryLine {
  id: number;
  employee_id: number;
  employee_name: string;
  manager_id: number;
  manager_name: string;
  relation_type: "functional" | "project" | "dotted_line";
  effective_from: string;
  effective_until: string | null;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee_name: string | null;
  department?: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  working_seconds: number;
  status: "present" | "absent" | "late" | "half-day";
  source: "self" | "kiosk" | "manual";
  is_manual: boolean;
  face_match_score: number | null;
  notes: string | null;
}

export interface TodaySummary {
  date: string;
  total_employees: number;
  present_today: number;
  absent_today: number;
  on_leave: number;
  working_now: number;
  completed_today: number;
  late_today: number;
  attendance_percentage: number;
  employees: AttendanceRecord[];
}

export interface LeaveStep {
  step_order: number;
  approver_type: string;
  approver_label: string;
  approver: string | null;
  status: "waiting" | "pending" | "approved" | "rejected" | "skipped" | "cancelled";
  acted_by: string | null;
  acted_as: "approver" | "delegate" | "override" | null;
  acted_at: string | null;
  remarks: string | null;
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  number_of_days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  remarks: string | null;
  created_at: string;
  decided_at: string | null;
  steps: LeaveStep[];
  can_act: boolean;
  acting_as: "approver" | "delegate" | "override" | null;
}

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  annual_quota: number;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
}

export interface LeaveBalance {
  name: string;
  is_paid: boolean;
  is_unlimited: boolean;
  total: number;
  used: number;
  pending: number;
  remaining: number | null;
  available: number | null;
}

export interface ChainStep {
  step_order: number;
  approver_type: "primary_manager" | "skip_level_manager" | "department_head" | "role";
  approver_label: string;
  role_id: number | null;
  role_name: string | null;
  min_days: number | null;
}

export interface PayrollRecord {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  salary_month: string;
  basic_salary: number;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  status: "draft" | "approved" | "processed";
  created_by_user_id: number | null;
  approved_by_user_id: number | null;
  created_at: string;
}

export interface PayrollSummary {
  month: string;
  total_employees: number;
  total_gross_salary: number;
  total_deductions: number;
  total_net_salary: number;
  average_salary: number;
  status_breakdown: Record<string, number>;
}

export interface Payslip {
  payroll_id: number;
  employee: { id: number; name: string; employee_code: string; department: string; designation: string };
  salary_month: string;
  salary_components: Record<string, number>;
  gross_salary: number;
  deductions: Record<string, number>;
  total_deductions: number;
  net_salary: number;
  attendance: Record<string, number>;
  status: string;
}

export interface SalaryStructure {
  id: number;
  employee_id: number;
  employee_name: string | null;
  basic_salary: number;
  house_rent_allowance: number;
  dearness_allowance: number;
  conveyance_allowance: number;
  other_allowances: number;
  gross: number;
  effective_from: string;
  effective_to: string | null;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  location: string | null;
  is_optional: boolean;
  description: string | null;
}

export interface Asset {
  id: number;
  asset_tag: string;
  name: string;
  category: string;
  serial_number: string | null;
  status: "in_stock" | "assigned" | "maintenance" | "retired";
  purchase_date: string | null;
  purchase_cost: number | null;
  notes: string | null;
  assignment: {
    id: number;
    employee_id: number;
    employee_name: string | null;
    assigned_at: string;
    acknowledged_at: string | null;
  } | null;
  history?: {
    employee_name: string;
    assigned_at: string;
    acknowledged_at: string | null;
    returned_at: string | null;
    return_condition: string | null;
  }[];
}

export interface RoleGrant {
  permission: PermissionCode;
  scope: Scope;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  system_key: string | null;
  is_system_role: boolean;
  is_protected: boolean;
  is_full_access: boolean;
  member_count: number;
  grants: RoleGrant[];
  can_edit: boolean;
  can_assign: boolean;
}

export interface UserRow {
  id: number;
  email: string;
  full_name: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: { id: number; name: string; is_protected: boolean }[];
  employee: { id: number; full_name: string; employee_code: string; position: string | null; department: string | null } | null;
}

export interface Capability {
  permission: PermissionCode;
  label: string;
  sensitivity: string;
  scopes: Scope[];
  scope_labels: string[];
}

export interface UserDetail extends UserRow {
  access: {
    is_company_admin: boolean;
    capabilities: Record<string, Capability[]>;
    restricted: { permission: string; label: string; module: string }[];
  };
  active_sessions: number;
  assigned_employee_ids: number[];
}

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  action_url: string | null;
  created_at: string;
}

export interface DashboardData {
  sections: string[];
  scope?: "company" | "team";
  headcount?: number;
  me?: {
    attendance: { state: "not_checked_in" | "working" | "completed"; record: AttendanceRecord | null };
    leave_balance: Record<string, LeaveBalance>;
    latest_payslip?: PayrollRecord | null;
  };
  attendance?: TodaySummary;
  attendance_trend?: { date: string; label: string; present: number; absent: number }[];
  recent_activity?: { employee_name: string; type: string; time: string; message: string }[];
  upcoming_leaves?: { employee_name: string; leave_type: string; start_date: string; end_date: string }[];
  pending_approvals: number;
  payroll?: PayrollSummary;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_email: string | null;
  actor_type: string;
  module: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  ip_address: string | null;
}
