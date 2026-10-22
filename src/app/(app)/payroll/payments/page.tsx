"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayoutBatchesWorkspace } from "@/components/payroll/money/PayoutBatches";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeePayments } from "./access";

/** Payroll › Payout Files (3.8 §5.12). */
export default function PayoutFilesPage() {
  return (
    <RequireAccess check={canSeePayments}>
      <PayrollPage>
        <PayoutBatchesWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
