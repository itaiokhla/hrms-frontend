"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { EmployeeInRunPage } from "@/components/payroll/runs/EmployeeInRunPage";
import { RunsPage, canReadRuns } from "@/components/payroll/runs/shared";

/** Payroll › Pay Runs › run › employee: the full page of the employee sheet (3.8 §5.4, D-12). */
export default function RunEmployeePage() {
  const params = useParams<{ id: string; eid: string }>();
  return (
    <RequireAccess check={canReadRuns}>
      <RunsPage>
        <EmployeeInRunPage runId={String(params?.id ?? "")} runEmployeeId={String(params?.eid ?? "")} />
      </RunsPage>
    </RequireAccess>
  );
}
