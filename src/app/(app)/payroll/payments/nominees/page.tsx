"use client";

import { RequireAccess } from "@/components/access/Can";
import { NomineesWorkspace } from "@/components/payroll/money/Nominees";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canSeeNominees } from "./access";

/** Payroll › Payout Files › Nominees (3.5 §15, 3.7 §2.1): the payees of a deceased employee's final settlement. */
export default function NomineesPage() {
  return (
    <RequireAccess check={canSeeNominees}>
      <PayrollPage>
        <NomineesWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
