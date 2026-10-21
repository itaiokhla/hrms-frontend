"use client";

import { useParams } from "next/navigation";

import { EmployeeCompensationView } from "@/components/payroll/compensation/EmployeeCompensationView";
import { CompensationWorkspace, NotFoundState } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Assign Salary › {employee}: current package, breakdown, history. Deep link: ?modal=revise&employee={id}. */
export default function EmployeeCompensationPage() {
  const params = useParams<{ employeeId: string }>();
  const id = Number.parseInt(String(params?.employeeId ?? ""), 10);
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_COMPENSATION_READ)}>
      {Number.isInteger(id) && id > 0 ? <EmployeeCompensationView key={id} employeeId={id} /> : <NotFoundState what="Employee" backHref="/payroll/compensation" backLabel="Back to Assign salary" />}
    </CompensationWorkspace>
  );
}
