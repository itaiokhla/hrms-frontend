"use client";

import { CompensationList } from "@/components/payroll/compensation/CompensationList";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/**
 * Payroll › Compensation › Assign Salary (3.8 §5.6).
 * Deep links: ?modal=assign-salary&employee={id}, ?modal=import&type=compensation.
 */
export default function AssignSalaryPage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_COMPENSATION_READ)}>
      <CompensationList />
    </CompensationWorkspace>
  );
}
