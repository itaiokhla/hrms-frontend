"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { RunDetail } from "@/components/payroll/runs/RunDetail";
import { RunsPage, canReadRuns } from "@/components/payroll/runs/shared";

/** Payroll › Pay Runs › run (3.8 §5.3). */
export default function PayRunPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={canReadRuns}>
      <RunsPage>
        <RunDetail runId={String(params?.id ?? "")} />
      </RunsPage>
    </RequireAccess>
  );
}
