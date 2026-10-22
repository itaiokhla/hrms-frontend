"use client";

import { RequireAccess } from "@/components/access/Can";
import { RunsList } from "@/components/payroll/runs/RunsList";
import { RunsPage, canReadRuns } from "@/components/payroll/runs/shared";

/** Payroll › Pay Runs (3.8 §5.2). */
export default function PayRunsPage() {
  return (
    <RequireAccess check={canReadRuns}>
      <RunsPage>
        <RunsList />
      </RunsPage>
    </RequireAccess>
  );
}
