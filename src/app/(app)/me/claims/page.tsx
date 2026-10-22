"use client";

import { MyClaims } from "@/components/payroll/me/MyClaims";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Claims (3.8 §5.18); deep link ?modal=new-claim. */
export default function MyClaimsRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE]}>
      <MePage>
        <MyClaims />
      </MePage>
    </SelfAccess>
  );
}
