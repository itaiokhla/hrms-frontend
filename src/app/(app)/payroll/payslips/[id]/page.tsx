"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayslipFullPage } from "@/components/payroll/documents/PayslipView";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** The full page of the payslip viewer (3.8 §2 parity: `?modal=payslip&id=` ↔ `/payroll/payslips/{id}`). */
export default function PayslipPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_PAYSLIP_READ)}>
      <DocsPage>
        <PayslipFullPage id={String(params?.id ?? "")} />
      </DocsPage>
    </RequireAccess>
  );
}
