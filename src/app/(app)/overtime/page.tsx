"use client";

import { RequireAccess } from "@/components/access/Can";
import { OvertimeWorkspace } from "@/components/payroll/inputs/Overtime";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Overtime: requests (overtime:request) and approvals (overtime:approve). */
export default function OvertimePage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.OVERTIME_REQUEST, P.OVERTIME_APPROVE])}>
      <PayrollPage>
        <OvertimeWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
