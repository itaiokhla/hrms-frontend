"use client";

import { AddBankAccountPage } from "@/components/payroll/me/MyBankAccounts";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** Add bank account, full page of the modal (D-12). */
export default function AddBankAccountPageRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_BANK_DETAILS_EDIT]}>
      <MePage>
        <AddBankAccountPage />
      </MePage>
    </SelfAccess>
  );
}
