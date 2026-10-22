"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { FundingAccountPage } from "@/components/payroll/money/FundingAccounts";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canManageFunding } from "../../access";

/** One funding account: details, signatories, settings, deactivate. */
export default function FundingAccountRoute() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canManageFunding}>
      <PayrollPage>
        <FundingAccountPage id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
