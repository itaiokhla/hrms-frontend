"use client";

import { NewLoanPage } from "@/components/payroll/me/MyLoans";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** Apply for a loan or advance, full page of the modal (D-12). */
export default function NewLoanPageRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE]}>
      <MePage>
        <NewLoanPage />
      </MePage>
    </SelfAccess>
  );
}
