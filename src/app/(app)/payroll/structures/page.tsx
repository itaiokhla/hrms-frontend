"use client";

import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { StructuresList } from "@/components/payroll/compensation/StructuresList";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Compensation › Salary Structures (3.8 §5.8). */
export default function StructuresPage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_READ)}>
      <StructuresList />
    </CompensationWorkspace>
  );
}
