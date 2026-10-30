"use client";

import { LeaveAdminRoute, canReadLeaveConfig } from "@/components/leave-admin/LeaveAdminRoute";
import { SetupPage } from "@/components/leave-admin/SetupPage";

/** Settings › Leave › Setup (09-ui-ux/02 §21.1): checklist, LEGACY_V1 vs V2_ACTIVE, reconciliation, go-live, rollback. */
export default function LeaveSetupRoute() {
  return (
    <LeaveAdminRoute check={canReadLeaveConfig}>
      <SetupPage />
    </LeaveAdminRoute>
  );
}
