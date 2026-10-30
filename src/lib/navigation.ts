import {
  ArrowLeftRight,
  BarChart3,
  Bot,
  Boxes,
  Calculator,
  CalendarCheck2,
  Fingerprint,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileClock,
  FileSpreadsheet,
  FileText,
  Gauge,
  Home,
  Inbox,
  Briefcase,
  Coins,
  Download,
  History,
  Landmark,
  LayoutDashboard,
  Layers,
  ListChecks,
  MapPin,
  Network,
  PiggyBank,
  Building,
  Palette,
  Puzzle,
  Receipt,
  ScanFace,
  Scale,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCog,
  UserRoundCog,
  Users,
  UsersRound,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { can, canAny, canBeyondSelf, companyWide } from "./access";
import {
  attendanceV2, canClosePeriods, canManageAttendanceCutover, canManageDevices, canExportAttendance, canSeeApprovals, canSeeAttendanceExceptions, canSeeMuster,
  canSeeMySchedule, canSeeOnDuty, canSeeRosters, canSeeShifts, canSeeTeams, canSeeTimesheets, canManageSites,
  canSeeMyPrivacy, canManageShiftRequests, canSeeOpenShifts, canSeeRotations,
} from "./attendance-routes";
import { LEAVE_SECTIONS } from "./leave/routes";
import { P, type PermissionCode } from "./permissions.generated";
import type { Me } from "./types";

/** Runtime facts beside `me` that decide a few entries (e.g. GET /agent/status for the assistant). */
export interface NavFeatures {
  assistant?: boolean;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  visible: (me: Me, features?: NavFeatures) => boolean;
  /**
   * Sub-pages shown as a collapsible group under this item. The item stays a link of its own
   * (so a collapsed group still reads as one menu entry) and is shown when it or any child is visible.
   */
  children?: NavItem[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/* ------------------------------------------------------------------ payroll gates */

/** Holds at least one of the codes with a scope beyond the user's own records. */
function beyondSelfAny(me: Me, codes: PermissionCode[]): boolean {
  return codes.some((code) => canBeyondSelf(me, code));
}

const hasEmployee = (me: Me) => me.employee !== null;

/**
 * The legacy payroll screens (runs, fixed-column structures), unchanged: kept at /payroll/legacy
 * for holders of the deprecated codes during the alias window (decision I-11, EC-MIG-07).
 */
export function canSeeLegacyPayroll(me: Me): boolean {
  return companyWide(me, P.PAYROLL_READ) || can(me, P.PAYROLL_PREPARE) || companyWide(me, P.COMPENSATION_MANAGE);
}

/**
 * Payroll v2 workspace items (3.8 §3.2). Gates use the v2 codes at ANY scope beyond SELF, never
 * `companyWide`: grants scoped to a legal entity or pay group must see their menus (the API filters
 * every list to the caller's scope). Self-service grants (SELF) never open the HR workspace.
 */
const PAYROLL_APPROVE_CODES: PermissionCode[] = [
  P.PAYROLL_RUN_APPROVE,
  P.PAYROLL_INPUTS_APPROVE,
  P.PAYROLL_COMPENSATION_APPROVE,
  P.PAYROLL_SALARY_STRUCTURE_APPROVE,
  P.PAYROLL_PAYMENT_APPROVE,
  P.PAYROLL_BANK_DETAILS_APPROVE,
  P.PAYROLL_LOANS_APPROVE,
  P.PAYROLL_REIMBURSEMENTS_APPROVE,
];

export const ATTENDANCE_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/attendance",
    icon: CalendarCheck2,
    visible: (me) => canAny(me, [P.ATTENDANCE_MARK, P.ATTENDANCE_READ]),
  },
  {
    label: "Timesheets",
    href: "/attendance/timesheets",
    icon: FileClock,
    visible: (me) => attendanceV2(me) && canSeeTimesheets(me),
  },
  {
    label: "Overtime",
    href: "/overtime",
    icon: Clock,
    visible: (me) => canAny(me, [P.OVERTIME_REQUEST, P.OVERTIME_APPROVE]),
  },
  {
    label: "Approvals",
    href: "/approvals?module=attendance",
    icon: Inbox,
    visible: canSeeApprovals,
  },
  {
    label: "Tasks",
    href: "/tasks",
    icon: ListChecks,
    visible: (me) => canAny(me, [P.TASK_READ, P.TASK_MANAGE, P.TASK_APPROVE]),
  },
  { label: "On duty", href: "/attendance/on-duty", icon: Briefcase, visible: canSeeOnDuty },
  { label: "Remote work", href: "/attendance/remote-work", icon: Home, visible: canSeeOnDuty },
  {
    label: "Muster",
    href: "/attendance/muster",
    icon: ClipboardCheck,
    visible: (me) => attendanceV2(me) && canSeeMuster(me),
  },
  {
    label: "Exceptions",
    href: "/attendance/exceptions",
    icon: ListChecks,
    visible: (me) => attendanceV2(me) && canSeeAttendanceExceptions(me),
  },
  {
    label: "Period close",
    href: "/attendance/period-close",
    icon: ShieldCheck,
    visible: (me) => attendanceV2(me) && canClosePeriods(me),
  },
  { label: "Devices", href: "/attendance/devices", icon: Fingerprint, visible: canManageDevices },
  { label: "Sites", href: "/attendance/sites", icon: MapPin, visible: canManageSites },
  {
    label: "Privacy & consents",
    href: "/me/attendance/privacy",
    icon: ShieldCheck,
    visible: (me) => canSeeMyPrivacy(me) && can(me, P.ATTENDANCE_MARK),
  },
  { label: "Registers", href: "/reports/attendance", icon: FileClock, visible: canExportAttendance },
  {
    label: "Attendance setup",
    href: "/settings/attendance/overview",
    icon: Settings2,
    visible: canManageAttendanceCutover,
  },
];

export const SHIFT_ITEMS: NavItem[] = [
  { label: "Shifts", href: "/attendance/shifts", icon: CalendarClock, visible: canSeeShifts },
  {
    label: "Rotations",
    href: "/attendance/rotations",
    icon: History,
    visible: (me) => attendanceV2(me) && canSeeRotations(me),
  },
  { label: "Rosters", href: "/rosters", icon: CalendarRange, visible: canSeeRosters },
  { label: "My schedule", href: "/rosters/my-schedule", icon: CalendarDays, visible: canSeeMySchedule },
  {
    label: "Shift requests",
    href: "/attendance/shift-requests",
    icon: ArrowLeftRight,
    visible: (me) => attendanceV2(me) && canManageShiftRequests(me),
  },
  {
    label: "Open shifts",
    href: "/attendance/open-shifts",
    icon: CalendarPlus,
    visible: (me) => attendanceV2(me) && canSeeOpenShifts(me),
  },
];

export function canSeeShiftsSection(me: Me): boolean {
  return (
    canSeeShifts(me) ||
    canSeeRosters(me) ||
    canSeeMySchedule(me) ||
    (attendanceV2(me) && (canManageShiftRequests(me) || canSeeOpenShifts(me) || canSeeRotations(me)))
  );
}

export const HOLIDAY_ITEMS: NavItem[] = [
  { label: "Calendar", href: "/holidays", icon: CalendarDays, visible: (me) => can(me, P.HOLIDAY_READ) },
  { label: "Calendars", href: "/holidays/calendars", icon: CalendarRange, visible: (me) => can(me, P.HOLIDAY_MANAGE) },
  { label: "Work weeks", href: "/holidays/work-weeks", icon: CalendarCheck2, visible: (me) => can(me, P.HOLIDAY_MANAGE) },
  { label: "Next year", href: "/holidays/rollover", icon: CalendarRange, visible: (me) => can(me, P.HOLIDAY_MANAGE) },
];

export const PAYROLL_WORKSPACE_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/payroll",
    icon: Gauge,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_RUN_READ, P.PAYROLL_INPUTS_READ]) || canSeeLegacyPayroll(me),
  },
  { label: "Pay Runs", href: "/payroll/runs", icon: ListChecks, visible: (me) => beyondSelfAny(me, [P.PAYROLL_RUN_READ]) },
  { label: "Wage Inputs", href: "/payroll/inputs", icon: FileSpreadsheet, visible: (me) => beyondSelfAny(me, [P.PAYROLL_INPUTS_READ]) },
  { label: "Approvals", href: "/payroll/approvals", icon: ClipboardCheck, visible: (me) => beyondSelfAny(me, PAYROLL_APPROVE_CODES) },
  // Managers / team leads prepare their team's pay inputs and contractor invoices (team_pay:*); payroll approves here too.
  {
    label: "Team payroll",
    href: "/payroll/team-inputs",
    icon: UsersRound,
    visible: (me) => beyondSelfAny(me, [P.TEAM_PAY_READ, P.TEAM_PAY_SUBMIT, P.PAYROLL_INPUTS_APPROVE]),
  },
  {
    label: "Assign Salary",
    href: "/payroll/compensation",
    icon: UserRoundCog,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_COMPENSATION_READ, P.PAYROLL_COMPENSATION_EDIT]),
  },
  {
    label: "Revisions",
    href: "/payroll/revisions",
    icon: TrendingUp,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_COMPENSATION_EDIT, P.PAYROLL_COMPENSATION_APPROVE]),
  },
  {
    label: "Salary Structures",
    href: "/payroll/structures",
    icon: Layers,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_SALARY_STRUCTURE_READ, P.PAYROLL_SALARY_STRUCTURE_EDIT]),
  },
  {
    label: "Components",
    href: "/payroll/components",
    icon: Puzzle,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_SALARY_STRUCTURE_READ, P.PAYROLL_SALARY_STRUCTURE_EDIT]),
  },
  {
    label: "Payout Files",
    href: "/payroll/payments",
    icon: ArrowLeftRight,
    visible: (me) =>
      beyondSelfAny(me, [P.PAYROLL_PAYMENT_PREPARE, P.PAYROLL_PAYMENT_APPROVE, P.PAYROLL_PAYMENT_SUBMIT, P.PAYROLL_PAYMENT_RECONCILE]),
  },
  {
    label: "Invoices",
    href: "/payroll/invoices",
    icon: Receipt,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_PAYMENT_PREPARE, P.PAYROLL_PAYMENT_APPROVE]),
  },
  {
    label: "Bank Details",
    href: "/payroll/bank-details",
    icon: Landmark,
    visible: (me) =>
      beyondSelfAny(me, [P.PAYROLL_BANK_DETAILS_READ_MASKED, P.PAYROLL_BANK_DETAILS_EDIT, P.PAYROLL_BANK_DETAILS_APPROVE]),
  },
  {
    label: "Loans & Advances",
    href: "/payroll/loans",
    icon: PiggyBank,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE, P.PAYROLL_LOANS_APPROVE]),
  },
  {
    label: "Reimbursements",
    href: "/payroll/reimbursements",
    icon: Receipt,
    visible: (me) =>
      beyondSelfAny(me, [P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE, P.PAYROLL_REIMBURSEMENTS_APPROVE]),
  },
  {
    label: "Payslips",
    href: "/payroll/payslips",
    icon: FileText,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_PAYSLIP_READ, P.PAYROLL_PAYSLIP_PUBLISH]),
  },
  {
    label: "Compliance",
    href: "/payroll/compliance",
    icon: Scale,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_STATUTORY_REVIEW, P.PAYROLL_STATUTORY_SUBMIT]),
  },
  {
    label: "Reports",
    href: "/payroll/reports",
    icon: BarChart3,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_REPORTS_READ, P.PAYROLL_REPORTS_EXPORT]),
  },
  {
    // The download center lists the caller's own export jobs; creating one (payslip ZIPs, registers,
    // report files) needs payslip or report export access beyond SELF, so self-service users never get
    // an entry for a page that could only ever be empty for them.
    label: "Downloads",
    href: "/downloads",
    icon: Download,
    visible: (me) => beyondSelfAny(me, [P.PAYROLL_REPORTS_EXPORT, P.PAYROLL_PAYSLIP_READ, P.PAYROLL_PAYSLIP_PUBLISH]),
  },
  {
    label: "Payroll settings",
    href: "/settings/payroll/general",
    icon: SlidersHorizontal,
    visible: (me) => can(me, P.PAYROLL_CONFIGURATION_READ),
  },
  { label: "Payroll (legacy)", href: "/payroll/legacy", icon: History, visible: canSeeLegacyPayroll },
];

/** Whether the payroll workspace (the /payroll Overview) is open to this user at all. */
export function canSeePayrollWorkspace(me: Me): boolean {
  return PAYROLL_WORKSPACE_ITEMS.some((item) => item.visible(me));
}

/** Employee self-service pay pages (3.8 §3.3); SELF grants and a linked employee profile. */
export const PAY_SELF_SERVICE_ITEMS: NavItem[] = [
  {
    label: "My Salary",
    href: "/me/salary",
    icon: WalletCards,
    visible: (me) => hasEmployee(me) && can(me, P.PAYROLL_COMPENSATION_READ, "SELF"),
  },
  {
    label: "My Payslips",
    href: "/me/payslips",
    icon: FileText,
    visible: (me) => hasEmployee(me) && can(me, P.PAYROLL_PAYSLIP_READ, "SELF"),
  },
  {
    label: "My Payments",
    href: "/me/payments",
    icon: FileClock,
    visible: (me) => hasEmployee(me) && can(me, P.PAYROLL_PAYSLIP_READ, "SELF"),
  },
  {
    // The page itself is gated on the tax profile grant; it says plainly when tax details are not
    // available for the employee's country yet. Both grants are in the default self-service role.
    label: "My Tax",
    href: "/me/tax",
    icon: Calculator,
    visible: (me) =>
      hasEmployee(me) && can(me, P.PAYROLL_PAYSLIP_READ, "SELF") && can(me, P.PAYROLL_TAX_PROFILE_READ, "SELF"),
  },
  {
    label: "My Bank Accounts",
    href: "/me/bank-accounts",
    icon: Landmark,
    visible: (me) => hasEmployee(me) && can(me, P.PAYROLL_BANK_DETAILS_READ_MASKED, "SELF"),
  },
  {
    // Same grants as the page (/me/loans), so a claims-only grant never lands on "no access".
    label: "My Loans",
    href: "/me/loans",
    icon: Coins,
    visible: (me) => hasEmployee(me) && (can(me, P.PAYROLL_LOANS_READ, "SELF") || can(me, P.PAYROLL_LOANS_MANAGE, "SELF")),
  },
  {
    label: "My Claims",
    href: "/me/claims",
    icon: Receipt,
    visible: (me) =>
      hasEmployee(me) &&
      (can(me, P.PAYROLL_REIMBURSEMENTS_READ, "SELF") || can(me, P.PAYROLL_REIMBURSEMENTS_MANAGE, "SELF")),
  },
];

/**
 * Menus are derived from effective permissions, never from role names, so
 * custom roles get exactly the navigation their grants allow.
 */
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, visible: () => true },
      // AI assistant (docs/leave_agent.md): only while GET /agent/status says enabled. The label avoids "Leave"
      // (the e2e suites click the "Leave" link by an inexact name).
      { label: "Assistant", href: "/agent", icon: Bot, visible: (_me, features) => !!features?.assistant },
      {
        label: "Attendance",
        href: "/attendance",
        icon: CalendarCheck2,
        visible: (me) => canAny(me, [P.ATTENDANCE_MARK, P.ATTENDANCE_READ]),
        children: ATTENDANCE_ITEMS,
      },
      {
        label: "Shifts",
        href: "/attendance/shifts",
        icon: CalendarClock,
        visible: canSeeShiftsSection,
        children: SHIFT_ITEMS,
      },
      {
        label: "Leave",
        href: "/leaves",
        icon: CalendarRange,
        visible: (me) => canAny(me, [P.LEAVE_APPLY, P.LEAVE_READ, P.LEAVE_APPROVE, P.LEAVE_MANAGE_POLICY]),
        children: LEAVE_SECTIONS,
      },
      {
        label: "Holidays",
        href: "/holidays",
        icon: CalendarDays,
        visible: (me) => can(me, P.HOLIDAY_READ),
        children: HOLIDAY_ITEMS,
      },
      {
        // Today's payslip page stays the entry; the v2 self-service pages expand below it.
        label: "Payslips",
        href: "/payslips",
        icon: Wallet,
        visible: (me) => can(me, P.PAYROLL_READ, "SELF") && me.employee !== null,
        children: PAY_SELF_SERVICE_ITEMS,
      },
      { label: "Assets", href: "/assets", icon: Boxes, visible: (me) => can(me, P.ASSET_READ) },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Employees", href: "/employees", icon: Users, visible: (me) => canBeyondSelf(me, P.EMPLOYEE_READ) },
      {
        label: "Organization",
        href: "/organization",
        icon: Network,
        visible: (me) => canBeyondSelf(me, P.EMPLOYEE_READ) || can(me, P.ORG_MANAGE_HIERARCHY),
      },
      // X-M1 (X 01 §15.3): team:read beyond SELF ∨ team:manage; an employee's own teams are under "My teams".
      { label: "Teams", href: "/teams", icon: UsersRound, visible: canSeeTeams },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        // Neutral icon: the workspace serves every currency (3.8 §3.2).
        label: "Payroll",
        href: "/payroll",
        icon: WalletCards,
        visible: canSeePayrollWorkspace,
        children: PAYROLL_WORKSPACE_ITEMS,
      },
      { label: "Face kiosk", href: "/kiosk", icon: ScanFace, visible: (me) => companyWide(me, P.ATTENDANCE_KIOSK) },
      { label: "Reports", href: "/reports", icon: BarChart3, visible: (me) => can(me, P.REPORT_READ) },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/users", icon: UserCog, visible: (me) => can(me, P.USER_READ) },
      { label: "Roles & access", href: "/roles", icon: ShieldCheck, visible: (me) => can(me, P.ROLE_READ) },
      { label: "Audit log", href: "/audit-logs", icon: ClipboardList, visible: (me) => can(me, P.AUDIT_READ) },
      { label: "Company settings", href: "/settings", icon: Settings2, visible: (me) => can(me, P.SETTINGS_MANAGE) },
      {
        label: "Branding & domains",
        href: "/settings/branding",
        icon: Palette,
        visible: (me) => canAny(me, [P.BRANDING_MANAGE, P.DOMAIN_MANAGE, P.EMAIL_TEMPLATE_MANAGE]),
      },
      {
        label: "Legal entities & branches",
        href: "/settings/organization",
        icon: Building,
        visible: (me) => canAny(me, [P.ORG_READ, P.ORG_MANAGE_ENTITIES, P.ORG_MANAGE_BRANCHES]),
      },
    ],
  },
];

function filterItem(item: NavItem, me: Me, features?: NavFeatures): NavItem | null {
  const children = item.children?.filter((child) => child.visible(me, features));
  const own = item.visible(me, features);
  if (!own && !children?.length) return null;
  if (!children?.length) return { ...item, children: undefined };
  // A parent page the user can't open links to its first visible sub-page instead.
  return { ...item, href: own ? item.href : children[0].href, children };
}

export function navFor(me: Me, features?: NavFeatures): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.map((item) => filterItem(item, me, features)).filter((item): item is NavItem => item !== null),
  })).filter((group) => group.items.length > 0);
}

/** Every visible destination, children included (for the active-link match and tests). */
export function navHrefs(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]));
}
