"use client";

import { MyPayments } from "@/components/payroll/me/MyPayments";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Payments (3.8 §5.18, 3.7 §11.1). */
export default function MyPaymentsRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_PAYSLIP_READ]}>
      <MePage>
        <MyPayments />
      </MePage>
    </SelfAccess>
  );
}
