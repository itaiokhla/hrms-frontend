"use client";

import { useState } from "react";
import toast from "react-hot-toast";

import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { runsApi } from "./api";
import { hasAction, useRun } from "./context";
import { humanize } from "./shared";

/** Run › Approvals (3.8 §5.3): chain steps with approver, time and comments; approve / reject only for the current approver. */
export function ApprovalsTab() {
  const { run, me, approval, version, reload } = useRun();
  const { data, error, reload: refetch } = useApi(() => runsApi.approvals(run.id), [run.id, version]);
  const approve = useModalRoute("approve", { keys: ["run", "decision"] });
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const canAct = approval?.can_act === true && hasAction(run, "APPROVE_STEP", "APPROVE_FINAL");

  if (error) return <ErrorState message={error.message} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-40 w-full" />;

  const steps: TimelineItem[] = (approval?.steps ?? []).map((s) => ({
    id: `step-${s.step_order}`,
    at: s.acted_at ?? run.submitted_at ?? run.created_at ?? new Date(0).toISOString(),
    title: `Step ${s.step_order}: ${s.approver ?? s.approver_label}`,
    actor: s.acted_by ? `${humanize(s.status)} by ${s.acted_by}` : humanize(s.status),
    body: s.remarks ?? undefined,
    tone: s.status === "approved" ? "success" : s.status === "rejected" ? "danger" : s.status === "pending" ? "warning" : "neutral",
  }));
  const decisions: TimelineItem[] = data.decisions
    .filter((d) => d.acted_at)
    .map((d): TimelineItem => ({
      id: `decision-${d.id}`,
      at: d.acted_at as string,
      title: `${d.decision === "APPROVED" ? "Approved" : "Rejected"}${d.step_order ? ` (step ${d.step_order})` : ""}${d.run_employee_id ? " · approver's own pay line" : ""}`,
      actor: d.approver_user_id === me?.user.id ? "You" : `User #${d.approver_user_id}${d.acted_as && d.acted_as !== "approver" ? ` as ${d.acted_as}` : ""}`,
      body: [d.comment, d.cleared_at ? `Cleared: ${d.cleared_reason ?? "resubmitted"}` : null].filter(Boolean).join(" · ") || undefined,
      tone: d.cleared_at ? "neutral" : d.decision === "APPROVED" ? "success" : "danger",
    }))
    .reverse();

  const approveLine = async (runEmployeeId: number) => {
    setBusyLine(runEmployeeId);
    try {
      await runsApi.approveSelfLine(run.id, runEmployeeId);
      toast.success("Line approved");
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyLine(null);
    }
  };

  return (
    <div className="space-y-5">
      {data.approval_request ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm">
            <p className="font-medium">Approval request #{data.approval_request.id}: {humanize(data.approval_request.status)}</p>
            {data.approval_request.pending_reason && <p className="text-muted-foreground">{data.approval_request.pending_reason}</p>}
            {data.separation_of_duties && <p className="text-xs text-muted-foreground">Separation of duties is on: whoever prepared the run cannot approve it.</p>}
          </div>
          {canAct && (
            <div className="flex flex-wrap gap-2">
              <Button variant="danger-ghost" onClick={() => approve.openModal({ run: run.id, decision: "reject" })}>
                Reject
              </Button>
              <Button variant="success" onClick={() => approve.openModal({ run: run.id, decision: "approve" })}>
                Approve
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <EmptyState title="Not submitted yet" description="The approval chain starts when the run is submitted for approval." />
      )}
      {steps.length > 0 && (
        <section aria-label="Approval chain">
          <h3 className="mb-3 text-sm font-semibold">Chain</h3>
          <Timeline items={steps} label="Approval chain" />
        </section>
      )}
      {data.self_lines_pending.length > 0 && (
        <section aria-label="Approver pay lines">
          <h3 className="mb-2 text-sm font-semibold">Approvers&apos; own pay lines</h3>
          <p className="mb-2 text-sm text-muted-foreground">An approver&apos;s own pay must be approved by someone else before the run can be finalized.</p>
          <ul className="space-y-1">
            {data.self_lines_pending.map((line) => (
              <li key={line.run_employee_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm">
                <span>Employee #{line.employee_id}</span>
                {can(me, P.PAYROLL_RUN_APPROVE) && line.approver_user_id !== me?.user.id && (
                  <Button size="sm" className="min-h-[44px] sm:min-h-[32px]" loading={busyLine === line.run_employee_id} onClick={() => void approveLine(line.run_employee_id)}>
                    Approve line
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Decisions">
        <h3 className="mb-3 text-sm font-semibold">Decisions</h3>
        <Timeline items={decisions} label="Approval decisions" empty={<p className="text-sm text-muted-foreground">No decisions yet.</p>} />
      </section>
    </div>
  );
}
