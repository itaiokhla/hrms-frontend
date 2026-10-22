"use client";

import { RequireAccess } from "@/components/access/Can";
import { FundingAccountsWorkspace } from "@/components/payroll/money/FundingAccounts";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canManageFunding } from "../access";

/** Payroll › Payout Files › Funding accounts (3.7 §6). */
export default function FundingAccountsPage() {
  return (
    <RequireAccess check={canManageFunding}>
      <PayrollPage>
        <FundingAccountsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
