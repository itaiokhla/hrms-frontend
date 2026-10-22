"use client";

import { RequireAccess } from "@/components/access/Can";
import { BankDetailsWorkspace } from "@/components/payroll/money/BankDetailsWorkspace";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeeBankDetails } from "./access";

/** Payroll › Bank Details (3.8 §5.11). */
export default function BankDetailsPage() {
  return (
    <RequireAccess check={canSeeBankDetails}>
      <PayrollPage>
        <BankDetailsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
