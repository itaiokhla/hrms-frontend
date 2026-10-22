"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Stepper } from "@/components/payroll/Stepper";
import { Card } from "@/components/ui/primitives";

import { useRun } from "./context";
import { EmployeeInRunView } from "./EmployeeInRun";
import { HoldModal } from "./HoldModal";
import { RunProvider } from "./RunProvider";
import { WorkspaceHeader, periodLabel } from "./shared";

/** Full page of an employee in a run (`/payroll/runs/[id]/employees/[eid]`, eid = run-employee id). */
export function EmployeeInRunPage({ runId, runEmployeeId }: { runId: string; runEmployeeId: string }) {
  return <RunProvider runId={runId}>{() => <Body runEmployeeId={runEmployeeId} />}</RunProvider>;
}

function Body({ runEmployeeId }: { runEmployeeId: string }) {
  const { run } = useRun();
  const [head, setHead] = useState<{ name: string | null; code: string | null } | null>(null);
  return (
    <div>
      <WorkspaceHeader
        eyebrow={
          <Link href={`/payroll/runs/${run.id}?tab=employees`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden /> {run.label}
          </Link>
        }
        title={head?.name ?? "Employee"}
        description={[head?.code, run.pay_group.name, periodLabel(run.period)].filter(Boolean).join(" · ")}
      />
      <Card className="mb-4 p-4">
        <Stepper state={run.status} compact />
      </Card>
      <Card className="p-4 sm:p-6">
        <EmployeeInRunView runEmployeeId={runEmployeeId} onLoaded={(d) => setHead({ name: d.employee.name, code: d.employee.code })} />
      </Card>
      <HoldModal />
    </div>
  );
}
