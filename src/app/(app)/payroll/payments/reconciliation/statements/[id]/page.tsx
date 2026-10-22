"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { StatementPage } from "@/components/payroll/money/Reconciliation";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canReconcile } from "../../../access";

/** One imported bank statement and its match results. */
export default function BankStatementPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canReconcile}>
      <PayrollPage>
        <StatementPage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
