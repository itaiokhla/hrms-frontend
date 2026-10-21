"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { LoanDetail } from "@/components/payroll/inputs/Loans";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

const LOAN_CODES = [P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE, P.PAYROLL_LOANS_APPROVE];

/** One loan or advance: schedule, ledger and actions (3.8 §5.10). */
export default function LoanPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => LOAN_CODES.some((code) => canBeyondSelf(me, code))}>
      <PayrollPage>
        <LoanDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
