"use client";

import { AdminWorkspace } from "@/components/leave-admin/AdminWorkspace";
import { LeaveAdminRoute } from "@/components/leave-admin/LeaveAdminRoute";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/**
 * Leave › Administration (`/leaves/admin?tab=balances|record|imports|year-end|documents|reports|lifecycle`). The page
 * gate is broad (any leave reader or administrator, or employee updaters for lifecycle dates); each tab follows
 * `GET /leaves/access`.
 */
export default function LeaveAdminRoutePage() {
  return (
    <LeaveAdminRoute check={(me) => canAny(me, [P.LEAVE_READ, P.LEAVE_MANAGE_POLICY, P.EMPLOYEE_UPDATE, P.REPORT_READ])}>
      <AdminWorkspace />
    </LeaveAdminRoute>
  );
}
