"use client";

import { useParams } from "next/navigation";

import { MyPayslipPage } from "@/components/payroll/me/MyPayslips";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** One payslip, full page of the viewer modal (D-12). */
export default function MyPayslipPageRoute() {
  const params = useParams<{ id: string }>();
  return (
    <SelfAccess codes={[P.PAYROLL_PAYSLIP_READ]}>
      <MePage>
        <MyPayslipPage id={String(params?.id ?? "")} />
      </MePage>
    </SelfAccess>
  );
}
