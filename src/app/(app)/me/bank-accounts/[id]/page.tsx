"use client";

import { useParams } from "next/navigation";

import { MyBankAccountPage } from "@/components/payroll/me/MyBankAccounts";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** One of my bank accounts. */
export default function MyBankAccountPageRoute() {
  const params = useParams<{ id: string }>();
  return (
    <SelfAccess codes={[P.PAYROLL_BANK_DETAILS_READ_MASKED, P.PAYROLL_BANK_DETAILS_EDIT]}>
      <MePage>
        <MyBankAccountPage id={String(params?.id ?? "")} />
      </MePage>
    </SelfAccess>
  );
}
