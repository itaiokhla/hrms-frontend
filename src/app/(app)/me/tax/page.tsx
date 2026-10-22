"use client";

import { MyTax } from "@/components/payroll/me/MyTax";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Tax (3.8 §5.18). */
export default function MyTaxRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_TAX_PROFILE_READ]}>
      <MePage>
        <MyTax />
      </MePage>
    </SelfAccess>
  );
}
