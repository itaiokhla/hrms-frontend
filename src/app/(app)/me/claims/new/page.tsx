"use client";

import { NewClaimPage } from "@/components/payroll/me/MyClaims";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** New claim, full page of the modal (D-12). */
export default function NewClaimPageRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE]}>
      <MePage>
        <NewClaimPage />
      </MePage>
    </SelfAccess>
  );
}
