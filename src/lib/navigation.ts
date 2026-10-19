import {
  BarChart3,
  Boxes,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  LayoutDashboard,
  Network,
  BadgeIndianRupee,
  ScanFace,
  Settings2,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { can, canAny, canBeyondSelf, companyWide } from "./access";
import { P } from "./permissions.generated";
import type { Me } from "./types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  visible: (me: Me) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Menus are derived from effective permissions, never from role names, so
 * custom roles get exactly the navigation their grants allow.
 */
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, visible: () => true },
      {
        label: "Attendance",
        href: "/attendance",
        icon: CalendarCheck2,
        visible: (me) => canAny(me, [P.ATTENDANCE_MARK, P.ATTENDANCE_READ]),
      },
      {
        label: "Leave",
        href: "/leaves",
        icon: CalendarRange,
        visible: (me) => canAny(me, [P.LEAVE_APPLY, P.LEAVE_READ, P.LEAVE_APPROVE, P.LEAVE_MANAGE_POLICY]),
      },
      { label: "Holidays", href: "/holidays", icon: CalendarDays, visible: (me) => can(me, P.HOLIDAY_READ) },
      {
        label: "Payslips",
        href: "/payslips",
        icon: Wallet,
        visible: (me) => can(me, P.PAYROLL_READ, "SELF") && me.employee !== null,
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
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Payroll",
        href: "/payroll",
        icon: BadgeIndianRupee,
        visible: (me) => companyWide(me, P.PAYROLL_READ) || can(me, P.PAYROLL_PREPARE) || companyWide(me, P.COMPENSATION_MANAGE),
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
    ],
  },
];

export function navFor(me: Me): NavGroup[] {
  return NAV.map((group) => ({ ...group, items: group.items.filter((item) => item.visible(me)) })).filter(
    (group) => group.items.length > 0,
  );
}
