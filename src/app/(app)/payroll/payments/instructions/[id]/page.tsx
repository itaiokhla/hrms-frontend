"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { InstructionPage } from "@/components/payroll/money/Instructions";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeePayments } from "../../access";

/** One payment instruction and its event timeline (full page of the instruction sheet). */
export default function PaymentInstructionPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canSeePayments}>
      <PayrollPage>
        <InstructionPage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
