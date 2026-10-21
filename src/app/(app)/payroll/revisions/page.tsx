"use client";

import { CyclesList } from "@/components/payroll/compensation/CyclesList";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Compensation › Revisions (3.8 §5.7). Deep link: ?modal=new-cycle. */
export default function RevisionsPage() {
  return (
    <CompensationWorkspace check={(me) => canAny(me, [P.PAYROLL_COMPENSATION_EDIT, P.PAYROLL_COMPENSATION_APPROVE])}>
      <CyclesList />
    </CompensationWorkspace>
  );
}
