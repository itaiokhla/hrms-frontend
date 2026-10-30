"use client";

import { LeaveAdminRoute, canConfigureLeave } from "@/components/leave-admin/LeaveAdminRoute";
import { RulesPage } from "@/components/leave-admin/RulesPage";

/** Settings › Leave › Rules & settings: blackouts, coverage, reason codes, approval route, leave settings (`?tab=`). */
export default function LeaveRulesRoute() {
  return (
    <LeaveAdminRoute check={canConfigureLeave}>
      <RulesPage />
    </LeaveAdminRoute>
  );
}
