"use client";

import { ArrowUpRight, FileText, Landmark, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { runsApi } from "./api";
import { isFinalized, useRun } from "./context";
import { humanize, primaryLink } from "./shared";
import type { PaymentBatchBrief } from "./types";

/** Run › Payments (3.8 §5.3): after finalize, the batches with their honest figures; "Paid" only from settlement evidence. */
export function PaymentsTab() {
  const { run, me, version } = useRun();
  const finalized = isFinalized(run.status);
  const canView = can(me, P.PAYROLL_PAYMENT_PREPARE) || can(me, P.PAYROLL_PAYMENT_APPROVE) || can(me, P.PAYROLL_PAYMENT_SUBMIT) || can(me, P.PAYROLL_PAYMENT_RECONCILE);
  const batches = useApi(() => runsApi.batches(run.id), [run.id, version], { enabled: finalized && canView });
  if (!finalized) return <EmptyState icon={<Landmark />} title="Payments come after finalization" description="Once this run is finalized, payment instructions are created and grouped into payout files here." />;
  if (!canView) return <EmptyState icon={<Landmark />} title="Payments are handled by finance" description="Your role doesn't include payment access." />;
  if (batches.error) return <ErrorState message={batches.error.message} onRetry={batches.reload} />;
  if (!batches.data) return <Skeleton className="h-32 w-full" />;
  const items = batches.data.items;
  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          icon={<Landmark />}
          title="No payout file yet"
          description="Payment instructions are ready to be grouped by funding account, method and currency."
          action={
            can(me, P.PAYROLL_PAYMENT_PREPARE) ? (
              <Link href={`/payroll/payments?modal=new-batch&run=${run.id}`} className={primaryLink}>
                Create payment batch
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <BatchCard key={b.id} batch={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BatchCard({ batch }: { batch: PaymentBatchBrief }) {
  const f = batch.figures;
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            <bdi dir="ltr" className="font-mono text-sm">
              {batch.reference}
            </bdi>
            <span className="ms-2 text-sm text-muted-foreground">
              {humanize(batch.method)} · {batch.item_count} payments
            </span>
            {batch.badge && <span className="ms-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{batch.badge}</span>}
          </p>
          <StatusChip vocabulary="batch" code={batch.status} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {(
            [
              ["Intended", f.intended],
              ["Submitted", f.submitted],
              ["Settled (evidence)", f.settled],
              ["Returned", f.returned],
              ["Outstanding", f.outstanding],
            ] as const
          ).map(([label, money]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd>
                <MoneyText money={money} />
              </dd>
            </div>
          ))}
        </dl>
        {batch.exclusions.length > 0 && <p className="mt-2 text-xs text-warning">{batch.exclusions.length} excluded from this file (see the batch).</p>}
        <Link href={`/payroll/payments/batches/${batch.id}`} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open batch <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </Card>
    </li>
  );
}

/** Run › Documents (3.8 §5.3): payslip generation progress, failures with Retry, link to the register. */
export function DocumentsTab() {
  const { run, me, version } = useRun();
  const finalized = isFinalized(run.status);
  const canView = can(me, P.PAYROLL_PAYSLIP_READ);
  const status = useApi(() => runsApi.generation(run.id), [run.id, version], { enabled: finalized && canView });
  const [retrying, setRetrying] = useState(false);
  if (!finalized) return <EmptyState icon={<FileText />} title="Documents come after finalization" description="Payslips are generated when the run is finalized." />;
  if (!canView) return <EmptyState icon={<FileText />} title="Payslips need payslip access" description="Your role doesn't include payslip read access." />;
  if (status.error) return <ErrorState message={status.error.message} onRetry={status.reload} />;
  if (!status.data) return <Skeleton className="h-32 w-full" />;
  const s = status.data;
  const done = s.counts.GENERATED;
  const percent = s.total ? Math.round((done / s.total) * 100) : 0;
  const retry = async () => {
    setRetrying(true);
    try {
      await runsApi.retryFailedPayslips(run.id);
      toast.success("Retrying the failed payslips");
      status.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="font-medium">Payslips</p>
        <div role="progressbar" aria-label="Payslip generation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground tabular-nums">
          {done} of {s.total} generated · {s.counts.QUEUED} queued · {s.counts.FAILED} failed · {s.published} published
        </p>
        {s.total === 0 && <p className="mt-1 text-sm text-muted-foreground">Generation has not started yet.</p>}
      </Card>
      {s.failed.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-danger">{s.failed.length} failed</p>
            {can(me, P.PAYROLL_PAYSLIP_PUBLISH) && (
              <Button size="sm" variant="secondary" className="min-h-[44px]" loading={retrying} onClick={() => void retry()}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Retry failed
              </Button>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {s.failed.map((f) => (
              <li key={f.task_id} className="flex flex-wrap justify-between gap-2">
                <span>{f.employee ?? `Employee line #${f.run_employee_id}`}</span>
                <span className="text-xs text-muted-foreground">{f.error ?? "Failed"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Link href={`/payroll/payslips?run=${run.id}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
        Open the payslip register <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Run › Audit (3.8 §5.3). There is no per-run audit endpoint yet, so this shows the lifecycle
 * timestamps the run record carries plus the approval decisions, and says so.
 */
export function AuditTab() {
  const { run, me, version } = useRun();
  const approvals = useApi(() => runsApi.approvals(run.id).catch(() => null), [run.id, version]);
  const who = (id: number | null | undefined) => (id === null || id === undefined ? undefined : id === me?.user.id ? "You" : `User #${id}`);
  const items: TimelineItem[] = [];
  const add = (at: string | null | undefined, title: string, actor?: string, tone: TimelineItem["tone"] = "neutral", body?: string) => {
    if (at) items.push({ id: `${title}-${at}`, at, title, actor, tone, body });
  };
  add(run.created_at, "Run created", who(run.created_by_user_id), "primary");
  add(run.prechecked_at, "Pre-checks run");
  add(run.calculated_at, "Calculated", who(run.calculated_by_user_id), "info");
  add(run.submitted_at, "Submitted for approval", who(run.submitted_by_user_id), "info");
  (approvals.data?.decisions ?? []).forEach((d) =>
    add(d.acted_at, d.decision === "APPROVED" ? "Approval step approved" : "Rejected", who(d.approver_user_id), d.decision === "APPROVED" ? "success" : "danger", d.comment ?? undefined),
  );
  add(run.approved_at, "Approved", undefined, "success");
  add(run.finalized_at, "Finalized", who(run.finalized_by_user_id), "success");
  add(run.cancelled_at, "Cancelled", undefined, "danger", run.status_reason ?? undefined);
  items.sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Key events from the run record. The full audit log of every action is not available per run yet.</p>
      <Timeline items={items} label="Run events" />
    </div>
  );
}
