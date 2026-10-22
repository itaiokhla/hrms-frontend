"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { LiabilityPage } from "@/components/payroll/documents/Compliance";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

const CODES = [P.PAYROLL_STATUTORY_REVIEW, P.PAYROLL_STATUTORY_SUBMIT, P.PAYROLL_REPORTS_READ];

/** One statutory liability (full page of `?modal=remit&id=` / `?modal=reconcile&id=`). */
export default function LiabilityRoute() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => CODES.some((code) => canBeyondSelf(me, code))}>
      <DocsPage>
        <LiabilityPage id={String(params?.id ?? "")} />
      </DocsPage>
    </RequireAccess>
  );
}
