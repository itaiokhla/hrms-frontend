"use client";

import { LeaveAdminRoute, canConfigureLeave } from "@/components/leave-admin/LeaveAdminRoute";
import { TypesPage } from "@/components/leave-admin/TypesPage";

/** Settings › Leave › Types (03-leave/01 §11.2–§11.3): catalogue and `?modal=leave-type&id=` editor. */
export default function LeaveTypesRoute() {
  return (
    <LeaveAdminRoute check={canConfigureLeave}>
      <TypesPage />
    </LeaveAdminRoute>
  );
}
