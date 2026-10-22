"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { BankAccountPage } from "@/components/payroll/money/BankAccountPanel";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeeBankDetails } from "../../access";

/** One payee bank account: details, documents, flags and decisions (full page of the account modal). */
export default function BankAccountRoute() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canSeeBankDetails}>
      <PayrollPage>
        <BankAccountPage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
