import { CalendarDays, Inbox, LayoutDashboard, ListChecks, WalletCards } from "lucide-react";

import { can, canAny, canBeyondSelf } from "@/lib/access";
import type { NavItem } from "@/lib/navigation";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

/**
 * Gates of the employee / manager leave v2 pages (UI only; the API enforces every rule). Used by the sidebar's
 * Leave group and the section strip on the pages, so both always agree.
 */
export const canUseLeave = (me: Me) => canAny(me, [P.LEAVE_APPLY, P.LEAVE_READ, P.LEAVE_APPROVE, P.LEAVE_MANAGE_POLICY]);
export const canApplyLeave = (me: Me) => me.employee !== null && can(me, P.LEAVE_APPLY);
export const canSeeLeaveRequests = (me: Me) => canApplyLeave(me) || canBeyondSelf(me, P.LEAVE_READ);
export const canApproveLeave = (me: Me) => can(me, P.LEAVE_APPROVE);
export const canSeeTeamCalendar = (me: Me) =>
  (me.employee !== null && canAny(me, [P.LEAVE_APPLY, P.LEAVE_READ])) || canBeyondSelf(me, P.LEAVE_READ);
export const canSeeLeaveBalances = canApplyLeave;

/**
 * The leave sections. Labels never contain the word "Leave": the e2e suites click the sidebar's "Leave" link by an
 * inexact name, so a child called "My leave" would make that click ambiguous once the group is open.
 */
export const LEAVE_SECTIONS: NavItem[] = [
  { label: "Overview", href: "/leaves/home", icon: LayoutDashboard, visible: canUseLeave },
  { label: "Requests", href: "/leaves/requests", icon: ListChecks, visible: canSeeLeaveRequests },
  { label: "Approvals", href: "/leaves/approvals", icon: Inbox, visible: canApproveLeave },
  { label: "Team calendar", href: "/leaves/calendar", icon: CalendarDays, visible: canSeeTeamCalendar },
  { label: "Balances", href: "/leaves/balances", icon: WalletCards, visible: canSeeLeaveBalances },
];
