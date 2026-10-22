"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollOverview } from "@/components/payroll/runs/Overview";
import { RunsPage } from "@/components/payroll/runs/shared";
import { canSeePayrollWorkspace } from "@/lib/navigation";

/**
 * Payroll › Overview (3.8 §5.1): KPI cards, money per currency labelled Draft / Approved / Final,
 * the current run, exceptions and deadlines from GET /api/v1/payroll/overview. People without
 * pay-run access keep the setup checklist and the list of pages their role covers.
 */
export default function PayrollOverviewPage() {
  return (
    <RequireAccess check={canSeePayrollWorkspace}>
      <RunsPage>
        <PayrollOverview />
      </RunsPage>
    </RequireAccess>
  );
}
