"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { TasksWorkspace } from "@/components/payroll/inputs/Tasks";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Tasks: team board for managers and "My tasks" for employees (tasks.enabled + task:*). */
export default function TasksPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.TASK_READ, P.TASK_MANAGE, P.TASK_APPROVE])}>
      <PayrollPage>
        <TasksWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
