"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { WageInputsWorkspace } from "@/components/payroll/inputs/WageInputsWorkspace";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Wage Inputs (3.8 §5.5). */
export default function WageInputsPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_INPUTS_READ)}>
      <PayrollPage>
        <WageInputsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
