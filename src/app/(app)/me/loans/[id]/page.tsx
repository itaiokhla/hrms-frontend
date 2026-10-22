"use client";

import { useParams } from "next/navigation";

import { MyLoanPage } from "@/components/payroll/me/MyLoans";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** One of my loans: schedule and history. */
export default function MyLoanPageRoute() {
  const params = useParams<{ id: string }>();
  return (
    <SelfAccess codes={[P.PAYROLL_LOANS_READ, P.PAYROLL_LOANS_MANAGE]}>
      <MePage>
        <MyLoanPage id={String(params?.id ?? "")} />
      </MePage>
    </SelfAccess>
  );
}
