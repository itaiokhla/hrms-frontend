"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { OvertimeDetail } from "@/components/payroll/inputs/Overtime";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** One overtime entry (full page of the approve / reject modal). */
export default function OvertimeEntryPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canAny(me, [P.OVERTIME_REQUEST, P.OVERTIME_APPROVE, P.PAYROLL_INPUTS_READ])}>
      <PayrollPage>
        <OvertimeDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
