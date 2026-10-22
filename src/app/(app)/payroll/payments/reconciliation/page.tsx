"use client";

import { RequireAccess } from "@/components/access/Can";
import { ReconciliationWorkspace } from "@/components/payroll/money/Reconciliation";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canReconcile } from "../access";

/** Payroll › Payout Files › Reconciliation (3.8 §5.12). */
export default function ReconciliationPage() {
  return (
    <RequireAccess check={canReconcile}>
      <PayrollPage>
        <ReconciliationWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
