"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayslipsWorkspace } from "@/components/payroll/documents/PayslipQuestions";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/**
 * Payroll › Payslips (HR, 3.8 §5.14): the payslips (`?tab=payslips`, default) and the employees'
 * questions about them (`?tab=questions`, answer modal `?modal=payslip-question&id=`). Employees use /me/payslips.
 */
export default function PayslipsPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_PAYSLIP_READ)}>
      <DocsPage>
        <PayslipsWorkspace />
      </DocsPage>
    </RequireAccess>
  );
}
