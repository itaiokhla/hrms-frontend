"use client";

import { useParams } from "next/navigation";

import { CycleWizard } from "@/components/payroll/compensation/CycleWizard";
import { CompensationWorkspace, NotFoundState } from "@/components/payroll/compensation/shared";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Revisions › {cycle}: Population → Method → Preview → Approve and apply (3.8 §5.7). */
export default function RevisionCyclePage() {
  const params = useParams<{ id: string }>();
  const id = Number.parseInt(String(params?.id ?? ""), 10);
  return (
    <CompensationWorkspace check={(me) => canAny(me, [P.PAYROLL_COMPENSATION_EDIT, P.PAYROLL_COMPENSATION_APPROVE])}>
      {Number.isInteger(id) && id > 0 ? <CycleWizard key={id} id={id} /> : <NotFoundState what="Revision cycle" backHref="/payroll/revisions" backLabel="Back to revisions" />}
    </CompensationWorkspace>
  );
}
