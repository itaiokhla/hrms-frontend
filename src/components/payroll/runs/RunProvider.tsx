"use client";

import { useCallback, useMemo, useReducer, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ErrorState } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { isConflict, newIdempotencyKey } from "@/lib/payroll/api";

import { runsApi } from "./api";
import { RunContext, type RunContextValue } from "./context";
import { ConflictBanner, NotFoundState, PageSkeleton, isNotFound } from "./shared";

/**
 * Loads one run (and, while it waits for approval, the approval request that says who may act),
 * and gives the page a single reload and the calculation starter. A forbidden run shows as not
 * found (EC-UX-02).
 */
export function RunProvider({ runId, children }: { runId: string; children: (value: RunContextValue) => ReactNode }) {
  const { me } = useCan();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [conflict, setConflict] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const run = useApi(() => runsApi.get(runId), [runId, version]);
  const requestId = run.data?.approval_request_id ?? 0;
  const approval = useApi(() => runsApi.approvalRequest(requestId).catch(() => null), [requestId, version], {
    enabled: requestId > 0 && run.data?.status === "APPROVAL_PENDING",
  });

  const reload = useCallback(() => {
    setConflict(null);
    bump();
  }, []);

  const startCalculation = useCallback(
    async (employeeIds?: number[]) => {
      const current = run.data;
      if (!current) return;
      setStarting(true);
      try {
        const result = await runsApi.calculate(current.id, { employee_ids: employeeIds?.length ? employeeIds : undefined, row_version: current.row_version }, newIdempotencyKey());
        toast.success(
          result.action === "CALCULATE"
            ? `Inputs locked — calculating ${result.employees} employees`
            : `Recalculating ${result.employees} ${result.employees === 1 ? "employee" : "employees"}`,
        );
        bump();
      } catch (error) {
        if (isConflict(error)) setConflict(error);
        else toast.error(errorMessage(error));
      } finally {
        setStarting(false);
      }
    },
    [run.data],
  );

  const value = useMemo<RunContextValue | null>(
    () =>
      run.data
        ? {
            run: run.data,
            me,
            approval: approval.data ?? null,
            reload,
            version,
            startCalculation,
            calculating: starting || run.data.status === "CALCULATING",
          }
        : null,
    [run.data, me, approval.data, reload, version, startCalculation, starting],
  );

  if (run.error && isNotFound(run.error)) return <NotFoundState what="Pay run" backHref="/payroll/runs" backLabel="Back to Pay Runs" />;
  if (run.error && !run.data) {
    return (
      <Card>
        <ErrorState message={run.error.message} onRetry={run.reload} />
      </Card>
    );
  }
  if (!value) return <PageSkeleton />;
  return (
    <RunContext.Provider value={value}>
      {!!conflict && <ConflictBanner error={conflict} onReload={reload} className="mb-4" />}
      {children(value)}
    </RunContext.Provider>
  );
}
