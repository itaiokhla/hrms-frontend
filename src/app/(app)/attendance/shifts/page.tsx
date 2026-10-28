"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ShiftsWorkspace } from "@/components/shifts/ShiftsWorkspace";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Shifts (AS-M1; 09-ui-ux/02 §8.1): catalogue and assignment rules, `shift:manage` ∨ `shift:assign` ∨ `shift:read` beyond SELF. */
export default function ShiftsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/shifts"]}>
      <PayrollPage>
        <ShiftsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
