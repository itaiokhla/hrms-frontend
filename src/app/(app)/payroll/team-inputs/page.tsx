"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { TeamPayroll } from "@/components/payroll/team/TeamPayroll";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Team payroll: managers and team leads prepare and submit; payroll approves and commits. */
export default function TeamPayrollPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.TEAM_PAY_READ, P.TEAM_PAY_SUBMIT, P.PAYROLL_INPUTS_APPROVE])}>
      <PayrollPage>
        <TeamPayroll />
      </PayrollPage>
    </RequireAccess>
  );
}
