"use client";

import { useParams } from "next/navigation";

import { MyClaimPage } from "@/components/payroll/me/MyClaims";
import { MePage, SelfAccess } from "@/components/payroll/me/shared";
import { P } from "@/lib/permissions.generated";

/** One of my claims. */
export default function MyClaimPageRoute() {
  const params = useParams<{ id: string }>();
  return (
    <SelfAccess codes={[P.PAYROLL_REIMBURSEMENTS_READ, P.PAYROLL_REIMBURSEMENTS_MANAGE]}>
      <MePage>
        <MyClaimPage id={String(params?.id ?? "")} />
      </MePage>
    </SelfAccess>
  );
}
