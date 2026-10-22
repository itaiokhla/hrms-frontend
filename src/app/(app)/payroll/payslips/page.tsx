"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayslipsList } from "@/components/payroll/documents/PayslipsList";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Payslips (HR, 3.8 §5.14). Employees use /me/payslips. */
export default function PayslipsPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_PAYSLIP_READ)}>
      <DocsPage>
        <PayslipsList />
      </DocsPage>
    </RequireAccess>
  );
}
