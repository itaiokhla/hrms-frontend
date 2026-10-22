"use client";

import { MyPayslips } from "@/components/payroll/me/MyPayslips";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Payslips (3.8 §5.18); deep links ?modal=payslip&id=, ?modal=payslip-password, ?modal=request-document. */
export default function MyPayslipsRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_PAYSLIP_READ]}>
      <MePage>
        <MyPayslips />
      </MePage>
    </SelfAccess>
  );
}
