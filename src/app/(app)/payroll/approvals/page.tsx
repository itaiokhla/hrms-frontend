"use client";

import { RequireAccess } from "@/components/access/Can";
import { APPROVER_CODES, ApprovalsInbox } from "@/components/payroll/inputs/ApprovalsInbox";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { canAny } from "@/lib/access";

/** Payroll › Approvals inbox (3.8 §4, §3.4). */
export default function ApprovalsPage() {
  return (
    <RequireAccess check={(me) => canAny(me, APPROVER_CODES)}>
      <PayrollPage>
        <ApprovalsInbox />
      </PayrollPage>
    </RequireAccess>
  );
}
