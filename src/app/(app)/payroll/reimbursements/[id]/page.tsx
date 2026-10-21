"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { ClaimDetail } from "@/components/payroll/inputs/Reimbursements";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

const CLAIM_CODES = [P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE, P.PAYROLL_REIMBURSEMENTS_APPROVE];

/** One claim with receipts (preview in a sheet: `?modal=receipt&receipt=`) and approve / reject. */
export default function ClaimPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => CLAIM_CODES.some((code) => canBeyondSelf(me, code))}>
      <PayrollPage>
        <ClaimDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
