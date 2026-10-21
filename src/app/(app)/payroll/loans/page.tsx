"use client";

import { RequireAccess } from "@/components/access/Can";
import { LoansList } from "@/components/payroll/inputs/Loans";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

const LOAN_CODES = [P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE, P.PAYROLL_LOANS_APPROVE];

/** Payroll › Loans & Advances (3.8 §5.10). Employees use /me/loans. */
export default function LoansPage() {
  return (
    <RequireAccess check={(me) => LOAN_CODES.some((code) => canBeyondSelf(me, code))}>
      <PayrollPage>
        <LoansList />
      </PayrollPage>
    </RequireAccess>
  );
}
