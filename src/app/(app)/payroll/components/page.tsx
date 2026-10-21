"use client";

import { ComponentsList } from "@/components/payroll/compensation/ComponentsList";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Compensation › Components (3.8 §5.9). */
export default function ComponentsPage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_READ)}>
      <ComponentsList />
    </CompensationWorkspace>
  );
}
