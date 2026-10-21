"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { TaskDetail } from "@/components/payroll/inputs/Tasks";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** One task: assignees and splits, evidence, submit / approve / partial acceptance. */
export default function TaskPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={(me) => canAny(me, [P.TASK_READ, P.TASK_MANAGE, P.TASK_APPROVE, P.PAYROLL_INPUTS_READ])}>
      <PayrollPage>
        <TaskDetail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
