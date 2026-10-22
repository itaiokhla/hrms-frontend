"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { BankChangePage } from "@/components/payroll/money/BankChangeReview";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeeBankDetails } from "../../access";

/** One bank change request (full page of the "Approve bank change" modal, 3.8 §6). */
export default function BankChangeRoute() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canSeeBankDetails}>
      <PayrollPage>
        <BankChangePage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
