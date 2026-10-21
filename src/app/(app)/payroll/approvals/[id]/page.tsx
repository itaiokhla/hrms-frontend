"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { APPROVER_CODES, ApprovalDetail } from "@/components/payroll/inputs/ApprovalsInbox";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canAny } from "@/lib/access";

/** One approval request: the full page of the Approve / reject modal (D-12). */
export default function ApprovalPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canAny(me, APPROVER_CODES)}>
      <PayrollPage>
        <ApprovalDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
