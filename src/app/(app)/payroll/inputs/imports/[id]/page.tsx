"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { ImportDetail } from "@/components/payroll/inputs/InputDetails";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** One wage-input CSV import: the full page of the Import CSV modal (D-12). */
export default function WageInputImportPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canAny(me, [P.PAYROLL_INPUTS_READ, P.PAYROLL_INPUTS_IMPORT])}>
      <PayrollPage>
        <ImportDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
