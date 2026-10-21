"use client";

import { RequireAccess } from "@/components/access/Can";
import { ClaimsList } from "@/components/payroll/inputs/Reimbursements";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

const CLAIM_CODES = [P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE, P.PAYROLL_REIMBURSEMENTS_APPROVE];

/** Payroll › Reimbursements (3.8 §5.10). Employees use /me/claims. */
export default function ReimbursementsPage() {
  return (
    <RequireAccess check={(me) => CLAIM_CODES.some((code) => canBeyondSelf(me, code))}>
      <PayrollPage>
        <ClaimsList />
      </PayrollPage>
    </RequireAccess>
  );
}
