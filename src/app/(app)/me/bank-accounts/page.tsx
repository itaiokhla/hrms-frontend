"use client";

import { MyBankAccounts } from "@/components/payroll/me/MyBankAccounts";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Bank Accounts (3.8 §5.18); deep link ?modal=add-bank. */
export default function MyBankAccountsRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_BANK_DETAILS_READ_MASKED, P.PAYROLL_BANK_DETAILS_EDIT]}>
      <MePage>
        <MyBankAccounts />
      </MePage>
    </SelfAccess>
  );
}
