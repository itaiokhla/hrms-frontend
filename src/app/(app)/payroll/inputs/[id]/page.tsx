"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { WageInputDetail } from "@/components/payroll/inputs/InputDetails";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** One wage input: the full page of the Add / edit wage input modal (D-12). */
export default function WageInputPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_INPUTS_READ)}>
      <PayrollPage>
        <WageInputDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
