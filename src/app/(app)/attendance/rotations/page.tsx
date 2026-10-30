"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { RotationsWorkspace } from "@/components/rotations/RotationsWorkspace";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Rotations (A16, AS-M5; 09-ui-ux/02 §8.2): patterns and assignments, the Shifts predicate, V2 gate. */
export default function RotationsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/rotations"]}>
      <PayrollPage>
        <RotationsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
