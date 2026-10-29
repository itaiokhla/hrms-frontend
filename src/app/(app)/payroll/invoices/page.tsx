"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { InvoicesWorkspace } from "@/components/payroll/team/Invoices";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Invoices: contractor invoices and payroll-cost invoices (payment preparers and approvers). */
export default function InvoicesPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_PAYMENT_PREPARE) || canBeyondSelf(me, P.PAYROLL_PAYMENT_APPROVE)}>
      <PayrollPage>
        <InvoicesWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
