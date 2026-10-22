"use client";

import { MySalary } from "@/components/payroll/me/MySalary";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** My Salary (3.8 §5.17). */
export default function MySalaryRoute() {
  return (
    <SelfAccess codes={[P.PAYROLL_COMPENSATION_READ, P.PAYROLL_PAYSLIP_READ]}>
      <MePage>
        <MySalary />
      </MePage>
    </SelfAccess>
  );
}
