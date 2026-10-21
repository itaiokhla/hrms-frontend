"use client";

import { ComponentEditor } from "@/components/payroll/compensation/ComponentEditor";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Components › New. */
export default function NewComponentPage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_EDIT)}>
      <ComponentEditor code={null} />
    </CompensationWorkspace>
  );
}
