"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { BatchDetailPage } from "@/components/payroll/money/BatchDetail";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeePayments } from "../../access";

/** One payment batch: summary, payments, exclusions, bank file and release. */
export default function BatchPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canSeePayments}>
      <PayrollPage>
        <BatchDetailPage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
