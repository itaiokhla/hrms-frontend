"use client";

import { MyLoans } from "@/components/payroll/me/MyLoans";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Loans & Advances (3.8 §5.18); deep link ?modal=new-loan. */
export default function MyLoansRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE]}>
      <MePage>
        <MyLoans />
      </MePage>
    </SelfAccess>
  );
}
