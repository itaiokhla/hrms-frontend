"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { statusEntry } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { paymentsApi } from "./api";
import { DetailGate, EvidenceNote, Meta, Notice, ReasonModal, SandboxBadge, WorkspaceHeader, humanize, useEmployeeDirectory, useUserNames } from "./shared";
import type { InstructionDetail, PaymentEvent, PaymentInstruction } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  FILE: "Bank file",
  SYSTEM: "System",
  STATEMENT: "Bank statement",
  WEBHOOK: "Provider webhook",
  MANUAL: "Manual proof",
  USER: "Payroll staff",
};

const FAILED = ["FAILED", "REJECTED", "RETURNED", "REVERSED"];
const IN_FLIGHT = ["SUBMITTED", "ACKNOWLEDGED", "PROCESSING"];

/** Sent, not settled, and past the expected settlement date. */
export function isOverdue(row: PaymentInstruction, today = new Date().toISOString().slice(0, 10)): boolean {
  return IN_FLIGHT.includes(row.status) && !!row.expected_settlement_date && row.expected_settlement_date < today;
}

export function isFailed(row: PaymentInstruction): boolean {
  return FAILED.includes(row.status);
}

export function eventTimeline(events: PaymentEvent[], userName: (id: number | null | undefined) => string): TimelineItem[] {
  return [...events].reverse().map((e) => {
    const to = e.to_status ?? e.event_status ?? "";
    const entry = statusEntry("instruction", to);
    return {
      id: e.id,
      at: e.at,
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          {e.from_status && e.to_status && e.from_status !== e.to_status ? `${statusEntry("instruction", e.from_status).label} → ${entry.label}` : entry.label}
          {e.outcome && e.outcome !== "APPLIED" && <span className="text-xs text-muted-foreground">({humanize(e.outcome)})</span>}
          {e.sandbox && <SandboxBadge />}
        </span>
      ),
      actor: e.actor_user_id ? userName(e.actor_user_id) : SOURCE_LABELS[e.source ?? ""] ?? humanize(e.source),
      body: [e.evidence_ref ? `Evidence: ${e.evidence_ref}` : null, typeof e.details?.reason === "string" ? e.details.reason : null].filter(Boolean).join(" · ") || undefined,
      tone: entry.tone,
    };
  });
}

/** Instruction facts, honest status and its event timeline. */
export function InstructionBody({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const { me } = useCan();
  const employees = useEmployeeDirectory();
  const userName = useUserNames();
  const detail = useApi(() => paymentsApi.instruction(id), [id]);
  const events = useApi(() => paymentsApi.events(id), [id]);
  const [action, setAction] = useState<"release-hold" | "reissue" | null>(null);
  const row: InstructionDetail | undefined = detail.data;
  if (detail.loading && !row) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!row) return null;
  const reload = () => {
    void detail.reload();
    void events.reload();
    onChanged?.();
  };
  const canReleaseHold = row.status === "ON_HOLD" && can(me, P.PAYROLL_PAYMENT_APPROVE);
  const canReissue = ["FAILED", "RETURNED", "REJECTED"].includes(row.status) && can(me, P.PAYROLL_PAYMENT_PREPARE) && !row.reissue_request;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip vocabulary="instruction" code={row.status} />
        <EvidenceNote channel={row.submission_channel} evidence={row.evidence_status} status={row.status} />
        {row.evidence_status === "VERIFIED" && <span className="text-xs text-success">Settlement evidence verified</span>}
      </div>
      {isOverdue(row) && <Notice tone="warning" title="Overdue">Expected to settle by {fmtDate(row.expected_settlement_date)}. Import the bank statement or check with the bank.</Notice>}
      {row.failure_message && <Notice tone="danger" title="Payment failed">{row.failure_message}</Notice>}
      {row.status_note && <Notice tone="info" title="Note">{row.status_note}</Notice>}
      <dl className="grid gap-4 sm:grid-cols-2">
        <Meta label="Employee">{employees.name(row.employee_id)}</Meta>
        <Meta label="Reference">
          <bdi dir="ltr" className="font-mono text-xs">{row.reference ?? "—"}</bdi>
        </Meta>
        <Meta label="Amount">
          <MoneyText money={row.amount} emphasis />
          {row.account_amount && row.account_amount.currency !== row.amount?.currency && (
            <span className="block text-xs text-muted-foreground">
              Paid as <MoneyText money={row.account_amount} />
            </span>
          )}
        </Meta>
        <Meta label="Settled">{row.settled ? <MoneyText money={row.settled} /> : "Not yet"}</Meta>
        <Meta label="To account">
          <bdi dir="ltr" className="font-mono">{row.beneficiary.account_masked ?? "—"}</bdi>
          {row.beneficiary.bank_name ? ` · ${row.beneficiary.bank_name}` : ""}
        </Meta>
        <Meta label="Expected settlement">{row.expected_settlement_date ? fmtDate(row.expected_settlement_date) : "—"}</Meta>
        {row.variance && (
          <Meta label="Accepted difference">
            <MoneyText money={row.variance} /> {row.variance_reason ? `— ${row.variance_reason}` : ""}
          </Meta>
        )}
        {row.status_reason && <Meta label="Reason">{humanize(row.status_reason)}</Meta>}
      </dl>
      {row.batch_id && (
        <p className="text-sm">
          In batch{" "}
          <Link className="font-medium text-primary hover:underline" href={`/payroll/payments/batches/${row.batch_id}`}>
            #{row.batch_id}
          </Link>
          {row.reissue_of_instruction_id ? (
            <>
              {" "}· reissue of{" "}
              <Link className="font-medium text-primary hover:underline" href={`/payroll/payments/instructions/${row.reissue_of_instruction_id}`}>
                #{row.reissue_of_instruction_id}
              </Link>
            </>
          ) : null}
        </p>
      )}
      {(canReleaseHold || canReissue) && (
        <div className="flex flex-wrap gap-2">
          {canReleaseHold && (
            <Button className="min-h-[44px]" onClick={() => setAction("release-hold")}>
              Release hold…
            </Button>
          )}
          {canReissue && (
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setAction("reissue")}>
              Reissue payment…
            </Button>
          )}
        </div>
      )}
      <section aria-label="Payment events" className="space-y-2">
        <h3 className="text-sm font-semibold">Events</h3>
        {events.error && !events.data ? (
          <p role="alert" className="text-sm text-danger">{events.error.message}</p>
        ) : (
          <Timeline items={eventTimeline(events.data?.events ?? [], userName)} empty={<p className="text-sm text-muted-foreground">No events yet.</p>} label="Payment events" />
        )}
      </section>
      <ReasonModal
        open={action === "release-hold"}
        onOpenChange={(o) => !o && setAction(null)}
        title="Release the hold"
        consequence="The payment is checked again and joins the next payment batch."
        confirmLabel="Release hold"
        onReload={reload}
        onSubmit={async (reason) => {
          await paymentsApi.releaseHold(row.id, reason, row.row_version);
          toast.success("Hold released");
          reload();
        }}
      />
      <ReasonModal
        open={action === "reissue"}
        onOpenChange={(o) => !o && setAction(null)}
        title="Reissue this payment"
        consequence="A new payment for the same amount is created for the same obligation; no new earnings. It needs a new batch and, if your company requires it, a second approval."
        confirmLabel="Reissue"
        onReload={reload}
        onSubmit={async (reason) => {
          await paymentsApi.reissue(row.id, reason, row.row_version);
          toast.success("Reissue requested");
          reload();
        }}
      />
      {row.manual_proofs.length > 0 && (
        <section aria-label="Manual proofs" className="space-y-1 text-sm">
          <h3 className="font-semibold">Manual proof</h3>
          {row.manual_proofs.map((p) => (
            <p key={p.id}>
              {humanize(p.method)} · ref <bdi dir="ltr">{p.evidence_reference}</bdi> · {humanize(p.status)} · {fmtDateTime(p.created_at)} by {userName(p.submitted_by_user_id)}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

/** Instruction sheet beside the batch (`?modal=instruction&id=`), with "Open full page ↗". */
export function InstructionSheet({ open, onOpenChange, id, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; id: string | null; onChanged?: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={id ? `Payment #${id}` : "Payment"}
      description={
        id ? (
          <Link href={`/payroll/payments/instructions/${id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {open && id ? <InstructionBody id={id} onChanged={onChanged} /> : null}
    </Sheet>
  );
}

/** Full page (`/payroll/payments/instructions/[id]`). */
export function InstructionPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => paymentsApi.instruction(id), [id]);
  return (
    <div>
      <Link href={data?.batch_id ? `/payroll/payments/batches/${data.batch_id}` : "/payroll/payments"} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {data?.batch_id ? "Batch" : "Payout files"}
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Payment" backHref="/payroll/payments" backLabel="Back to payout files">
        {data && (
          <>
            <WorkspaceHeader title={`Payment ${data.reference ?? `#${data.id}`}`} />
            <Card className="p-5">
              <InstructionBody id={id} onChanged={() => void reload()} />
            </Card>
          </>
        )}
      </DetailGate>
    </div>
  );
}
