"use client";

import { NewStructureForm } from "@/components/payroll/compensation/NewStructureForm";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Salary Structures › New. */
export default function NewStructurePage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_EDIT)}>
      <NewStructureForm />
    </CompensationWorkspace>
  );
}
