"use client";

import { LeaveAdminRoute, canReadLeaveConfig } from "@/components/leave-admin/LeaveAdminRoute";
import { PlansPage } from "@/components/leave-admin/PlansPage";

/** Settings › Leave › Plans (03-leave/01 §11.4): list, unassigned alert, `?modal=new-plan`. */
export default function LeavePlansRoute() {
  return (
    <LeaveAdminRoute check={canReadLeaveConfig}>
      <PlansPage />
    </LeaveAdminRoute>
  );
}
