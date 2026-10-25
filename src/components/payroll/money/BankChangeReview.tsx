"use client";

import { ArrowLeft, ExternalLink, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DiffView, type DiffRow } from "@/components/payroll/DiffView";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { AccountNumber, routingText } from "./BankAccountPanel";
import { bankApi } from "./api";
import {
  CHANNEL_LABELS,
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  LocalChip,
  Meta,
  Notice,
  WorkspaceHeader,
  fieldErrors,
  flagLabel,
  humanize,
  useCountdown,
  useEmployeeDirectory,
  useUserNames,
} from "./shared";
import type { BankAccount, BankChangeRequest } from "./types";

/* ------------------------------------------------------------------ diff */

function allocationText(a: BankAccount): string {
  return a.allocation.type === "PRIMARY" ? "Primary" : `${humanize(a.allocation.type)}${a.allocation.value ? ` ${a.allocation.value}` : ""}`;
}

/**
 * Before/after rows. The account number stays masked on both sides (the last digits show whether it
 * changed); everything else is compared as text, so only changed rows are listed by default.
 */
export function changeDiffRows(change: BankChangeRequest): DiffRow[] {
  const before = change.before.find((b) => b.id === change.replaces_account_id) ?? (change.kind === "REPLACE" ? change.before[0] : undefined);
  const after = change.after;
  const text = (v: string | null | undefined) => (v ? v : null);
  const row = (key: string, label: string, b: string | null, a: string | null): DiffRow => ({ key, label, before: b, after: a });
  const numberChanged = !before || before.account_masked !== after.account_masked;
  return [
    row("holder", "Account holder", before ? before.holder_name : null, after.holder_name),
    {
      key: "number",
      label: after.has_iban ? "IBAN" : "Account number",
      before: before ? <AccountNumber account={before} /> : null,
      after: <AccountNumber account={after} />,
      kind: !before ? "added" : numberChanged ? "changed" : "unchanged",
    },
    row("bank", "Bank", before ? text([before.bank_name, before.branch_name].filter(Boolean).join(", ")) : null, text([after.bank_name, after.branch_name].filter(Boolean).join(", "))),
    row("routing", "Routing", before ? routingText(before.routing) : null, routingText(after.routing)),
    row("country", "Country · currency", before ? `${before.country} · ${before.currency}` : null, `${after.country} · ${after.currency}`),
    row("split", "Split", before ? allocationText(before) : null, allocationText(after)),
  ];
}

export function RiskFlagList({ change }: { change: BankChangeRequest }) {
  const flags = change.risk_flags ?? [];
  if (!flags.length) return <p className="text-sm text-muted-foreground">No risk flags.</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Risk flags">
      {flags.map((f, i) => (
        <li key={`${f.code}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-3 py-1 text-xs font-medium text-danger" title={f.detail ?? undefined}>
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          {flagLabel(f.code)}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ decision form */

type Mode = "approve" | "reject" | "release" | "security-reject";

function DecisionForm({ change, mode, onCancel, onDone }: { change: BankChangeRequest; mode: Mode; onCancel: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [ack, setAck] = useState(false);
  const [waive, setWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const flags = change.risk_flags ?? [];
  const needsReason = mode !== "approve";
  const needsAck = mode === "approve" && flags.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (needsReason && remarks.trim().length < 3) next.remarks = "Give a reason (at least 3 characters). The requester and the audit trail see it.";
    if (waive && waiveReason.trim().length < 3) next.waive = "Say why the waiting period is skipped (for example: confirmed by phone).";
    setErrors(next);
    if (Object.keys(next).length || (needsAck && !ack)) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "approve") {
        await bankApi.approveChange(change.id, { remarks: remarks.trim() || undefined, waive_cooling_off_reason: waive ? waiveReason.trim() : undefined });
        toast.success("Bank change approved");
      } else if (mode === "reject") {
        await bankApi.rejectChange(change.id, remarks.trim());
        toast.success("Bank change rejected — the employee is told");
      } else {
        await bankApi.securityReview(change.id, mode === "release" ? "RELEASE" : "REJECT", remarks.trim());
        toast.success(mode === "release" ? "Released for approval" : "Bank change rejected");
      }
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const label = { approve: "Approve change", reject: "Reject change", release: "Release for approval", "security-reject": "Reject change" }[mode];
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border p-4" noValidate aria-label={label}>
      <ConflictBanner error={error} onReload={onDone} />
      <ErrorSummary error={error} fields={{ ...fieldErrors(error), ...errors }} />
      {mode === "approve" && (
        <p className="text-sm">
          Approving makes this account the one salaries are paid to{change.kind === "REPLACE" ? ", replacing the old one" : ""}. The employee is notified at their contact addresses.
        </p>
      )}
      {mode === "release" && <p className="text-sm">The change was held because of too many bank changes in 90 days. Releasing sends it to normal approval.</p>}
      {needsAck && (
        <label className="flex min-h-[44px] items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I have checked the risk flags ({flags.map((f) => flagLabel(f.code)).join(", ")}) with the employee.</span>
        </label>
      )}
      {mode === "approve" && change.payee_type !== "NOMINEE" && (
        <div className="space-y-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            Skip the cooling-off period (payments can go to the new account immediately)
          </label>
          {waive && (
            <Field label="Why skip it?" required error={errors.waive}>
              <Input value={waiveReason} maxLength={1000} onChange={(e) => setWaiveReason(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <Field label={needsReason ? "Reason" : "Comment (optional)"} required={needsReason} error={errors.remarks}>
        <Textarea rows={3} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant={mode === "approve" || mode === "release" ? "primary" : "danger"} className="min-h-[44px]" loading={busy} disabled={needsAck && !ack}>
          {label}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ body */

export function BankChangeBody({ change, onChanged }: { change: BankChangeRequest; onChanged: () => void }) {
  const { me } = useCan();
  const userName = useUserNames();
  const employees = useEmployeeDirectory();
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => setMode(null), [change.id, change.status]);
  const cooling = useCountdown(change.after.cooling_off ? change.after.usable_from : null);

  const approver = can(me, P.PAYROLL_BANK_DETAILS_APPROVE);
  const isMaker = change.requested_by_user_id !== undefined && change.requested_by_user_id === me?.user.id;
  const isOwn = change.employee_id !== null && me?.employee?.id === change.employee_id;
  const pending = change.status === "PENDING_APPROVAL";
  const security = change.status === "SECURITY_REVIEW";
  let blocked: ReactNode = null;
  if (approver && (pending || security)) {
    if (isOwn) blocked = "This is a change to your own bank account, so another approver decides it.";
    else if (isMaker) blocked = "You entered this change, so another approver decides it.";
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <LocalChip vocabulary="change" code={change.status} />
        <span className="text-sm text-muted-foreground">
          {change.kind === "REPLACE" ? "Replaces an account" : "New account"} · {CHANNEL_LABELS[change.channel] ?? change.channel}
        </span>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        {change.nominee ? (
          <Meta label="Payee (nominee of a deceased employee)">
            {change.nominee.name} · {change.nominee.relationship} · {change.nominee.share_percent}% of the settlement
            <span className="block text-xs text-muted-foreground">Proof: {change.nominee.proof_ref}</span>
          </Meta>
        ) : (
          <Meta label="Employee">{employees.name(change.employee_id)}</Meta>
        )}
        <Meta label="Requested">
          {fmtDateTime(change.created_at)} by {userName(change.requested_by_user_id)}
        </Meta>
        <Meta label="Identity confirmed">{change.step_up_at ? `${humanize(change.step_up_method)} · ${fmtDateTime(change.step_up_at)}` : "No step-up recorded"}</Meta>
      </dl>

      <section className="space-y-2" aria-label="Risk flags">
        <h3 className="text-sm font-semibold">Risk flags</h3>
        <RiskFlagList change={change} />
        {(change.alert_recipients ?? []).length > 0 && (
          <p className="text-xs text-muted-foreground">Alerts sent to {(change.alert_recipients ?? []).join(", ")}.</p>
        )}
      </section>

      <DiffView rows={changeDiffRows(change)} beforeLabel="Current" afterLabel="Requested" caption="Bank details change" />

      {cooling && (
        <Notice tone="warning" title={`Cooling-off: first payment possible in ${cooling}`}>
          Usable from {fmtDateTime(change.after.usable_from)}. Open the account to end the waiting period early with a reason.
        </Notice>
      )}
      {change.cooling_off_waived && <Notice tone="info" title="Cooling-off was skipped">{change.cooling_off_waived_reason ?? "A reason is recorded in the audit trail."}</Notice>}
      {change.decision_reason && (
        <Notice tone="info" title={`Decision ${change.decided_at ? `on ${fmtDateTime(change.decided_at)}` : ""}`}>
          {change.decision_reason}
          {change.decided_by_user_id ? ` — ${userName(change.decided_by_user_id)}` : ""}
        </Notice>
      )}
      {change.security_review_reason && <Notice tone="info" title="Security review">{change.security_review_reason}</Notice>}

      {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
      {approver && !blocked && (pending || security) && !mode && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {pending && (
            <>
              <Button className="min-h-[44px]" onClick={() => setMode("approve")}>
                Approve…
              </Button>
              <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setMode("reject")}>
                Reject…
              </Button>
            </>
          )}
          {security && (
            <>
              <Button className="min-h-[44px]" onClick={() => setMode("release")}>
                Release for approval…
              </Button>
              <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setMode("security-reject")}>
                Reject…
              </Button>
            </>
          )}
        </div>
      )}
      {mode && <DecisionForm change={change} mode={mode} onCancel={() => setMode(null)} onDone={() => { setMode(null); onChanged(); }} />}

      <p className="text-sm">
        <Link href={`/payroll/bank-details/accounts/${change.bank_account_id}`} className="font-medium text-primary hover:underline">
          Open the requested account
        </Link>
      </p>
    </div>
  );
}

/** "Approve bank change" modal (`?modal=bank-change&id=`), 3.8 §6. */
export function BankChangeModal({ open, onOpenChange, id, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; id: string | null; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi(() => bankApi.change(id ?? ""), [id], { enabled: open && !!id });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={id ? `Bank change request #${id}` : "Bank change request"}
      description={
        id ? (
          <Link href={`/payroll/bank-details/changes/${id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {loading && !data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error && !data ? (
        <p role="alert" className="text-sm text-danger">
          {error.status === 404 || error.status === 403 ? "This change request was not found, or it is outside the people you can see." : error.message}{" "}
          <button type="button" className="font-medium underline" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      ) : data ? (
        <BankChangeBody change={data} onChanged={() => { void reload(); onChanged(); }} />
      ) : null}
    </Modal>
  );
}

/** Full page (`/payroll/bank-details/changes/[id]`). */
export function BankChangePage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => bankApi.change(id), [id]);
  return (
    <div>
      <Link href="/payroll/bank-details?tab=changes" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Change requests
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Bank change request" backHref="/payroll/bank-details?tab=changes" backLabel="Back to change requests">
        {data && (
          <>
            <WorkspaceHeader title={`Bank change request #${data.id}`} description={`${data.after.holder_name} · ${data.after.account_masked}`} />
            <Card className="p-5">
              <BankChangeBody change={data} onChanged={() => void reload()} />
            </Card>
          </>
        )}
      </DetailGate>
    </div>
  );
}
