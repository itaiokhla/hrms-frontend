"use client";

import { ArrowLeft, Download, FileCog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { TypedConfirmModal } from "@/components/payroll/TypedConfirmModal";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Column, DataTable, EmptyState } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can, canAny } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isConflict, newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { BankChangeWarnings, ExclusionsTable } from "./CreateBatch";
import { InstructionSheet, isFailed, isOverdue } from "./Instructions";
import { BatchStatus } from "./PayoutBatches";
import { fetchFile, paymentsApi, saveFile } from "./api";
import {
  DetailGate,
  EvidenceNote,
  Hash,
  MANUAL_UNVERIFIED,
  METHOD_LABELS,
  Meta,
  Notice,
  PaymentErrorBanner,
  PaymentsNav,
  ReasonModal,
  STATUS_REASON_TEXT,
  SandboxBadge,
  ValueDateNotice,
  WorkspaceHeader,
  humanize,
  paymentErrorCode,
  useEmployeeDirectory,
  useFundingAccounts,
  useUserNames,
} from "./shared";
import type { BatchFigures, PaymentBatchDetail, PaymentInstruction } from "./types";

const UNSENT = ["DRAFT", "APPROVAL_PENDING", "APPROVED", "FILE_GENERATED", "API_QUEUED"];
const FILTERS = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "held", label: "Held" },
  { value: "overdue", label: "Overdue" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/* ------------------------------------------------------------------ summary */

const FIGURES: { key: keyof BatchFigures; label: string; hint: string }[] = [
  { key: "intended", label: "Intended", hint: "Every payment in the batch that is not held, cancelled or replaced." },
  { key: "submitted", label: "Submitted", hint: "Sent to the bank or provider." },
  { key: "settled", label: "Settled", hint: "Confirmed by the bank statement or provider." },
  { key: "returned", label: "Returned", hint: "Paid out and sent back by the bank." },
  { key: "failed", label: "Failed", hint: "Rejected or failed; reissue after fixing the cause." },
  { key: "outstanding", label: "Outstanding", hint: "Intended minus settled." },
];

function Summary({ batch }: { batch: PaymentBatchDetail }) {
  const f = batch.figures;
  return (
    <Card>
      <CardHeader title="Summary" description={`${batch.item_count} payment(s) in ${batch.currency}`} />
      <div className="space-y-4 p-5 pt-0">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {FIGURES.map((x) => (
            <div key={x.key} title={x.hint}>
              <dt className="text-xs text-muted-foreground">{x.label}</dt>
              <dd className="mt-0.5 text-end sm:text-start">
                <MoneyText money={f[x.key]} emphasis={x.key === "outstanding"} />
              </dd>
            </div>
          ))}
        </dl>
        <ExplainPanel
          explanation="Outstanding is what the run still owes through this batch: everything intended, less what the bank statement or provider has confirmed as settled. Submitted money is not settled until that evidence arrives."
          formula={
            <span>
              <MoneyText money={f.intended} /> − <MoneyText money={f.settled} /> = <MoneyText money={f.outstanding} />
            </span>
          }
          inputs={[
            { label: "Intended", value: <MoneyText money={f.intended} /> },
            { label: "Settled (evidence)", value: <MoneyText money={f.settled} /> },
            { label: "Returned", value: <MoneyText money={f.returned} /> },
          ]}
          sources={[{ label: "Payment events of each instruction (open a row for its timeline)" }]}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ file panel */

function FilePanel({ batch, canDownload, canGenerate, onChanged }: { batch: PaymentBatchDetail; canDownload: boolean; canGenerate: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<"generate" | "download" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [received, setReceived] = useState<string | null>(null);
  const file = batch.file;
  if (batch.method !== "BANK_FILE") {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold">Payout API</h2>
        <p className="mt-1 text-sm text-muted-foreground">This batch is sent through the payout provider, not as a bank file.</p>
        {batch.sandbox && (
          <p className="mt-2 text-sm">
            <SandboxBadge /> The provider is the SANDBOX adapter: submission is simulated and no money moves.
          </p>
        )}
      </Card>
    );
  }
  const generate = async () => {
    setBusy("generate");
    setError(null);
    try {
      await paymentsApi.generateFile(batch.id, batch.row_version);
      toast.success("Bank file generated — download it and upload it to the bank");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      const fetched = await fetchFile(paymentsApi.fileUrl(batch.id));
      setReceived(fetched.sha256);
      saveFile(fetched, file?.filename ?? `${batch.reference}.csv`);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Bank file</h2>
          <p className="text-sm text-muted-foreground">Every download is recorded in the audit log and checked against the stored hash. Downloading does not mark anything as paid.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!file && canGenerate && batch.status === "APPROVED" && (
            <Button className="min-h-[44px]" loading={busy === "generate"} onClick={generate}>
              <FileCog className="h-4 w-4" aria-hidden /> Generate file
            </Button>
          )}
          {file && canDownload && (
            <Button variant="secondary" className="min-h-[44px]" loading={busy === "download"} onClick={download}>
              <Download className="h-4 w-4" aria-hidden /> Download
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <div className="mt-3">
          <PaymentErrorBanner error={error} onReload={onChanged} />
        </div>
      ) : null}
      {file ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Meta label="File">
            <bdi dir="ltr" className="font-mono text-xs">{file.filename}</bdi> · {file.format}
          </Meta>
          <Meta label="SHA-256">
            <code dir="ltr" className="block break-all font-mono text-xs">{file.sha256}</code>
          </Meta>
          <Meta label="Records">{file.record_count}</Meta>
          <Meta label="Totals">
            {Object.entries(file.totals).map(([currency, amount]) => (
              <MoneyText key={currency} amount={amount} currency={currency} className="block" />
            ))}
          </Meta>
          <Meta label="Generated">{fmtDateTime(file.generated_at)}</Meta>
          <Meta label="Downloads">
            {file.download_count}
            {file.last_downloaded_at ? ` · last ${fmtDateTime(file.last_downloaded_at)}` : ""}
          </Meta>
          {received && (
            <Meta label="Hash of your download">
              <Hash value={received} /> {received === file.sha256 ? <span className="text-success">matches</span> : <span className="text-danger">does not match — do not upload it</span>}
            </Meta>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{batch.status === "APPROVAL_PENDING" ? "The file can be generated once the batch is approved." : "No file generated yet."}</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ instructions */

function InstructionsCard({ batch, onOpen }: { batch: PaymentBatchDetail; onOpen: (id: number) => void }) {
  const employees = useEmployeeDirectory();
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(
    () => ({
      all: batch.instructions.length,
      failed: batch.instructions.filter(isFailed).length,
      held: batch.instructions.filter((r) => r.status === "ON_HOLD").length,
      overdue: batch.instructions.filter((r) => isOverdue(r)).length,
    }),
    [batch.instructions],
  );
  const rows = batch.instructions.filter((r) => (filter === "all" ? true : filter === "failed" ? isFailed(r) : filter === "held" ? r.status === "ON_HOLD" : isOverdue(r)));
  const columns: Column<PaymentInstruction>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (r) => <span className="font-medium">{employees.name(r.employee_id)}</span> },
    { key: "account", header: "To account", hideOnMobile: true, cell: (r) => <bdi dir="ltr" className="font-mono">{r.beneficiary.account_masked ?? "—"}</bdi> },
    {
      key: "amount",
      header: "Amount",
      className: "text-end",
      cell: (r) => (
        <span className="flex flex-col items-end">
          <MoneyText money={r.amount} />
          {r.account_amount && r.account_amount.currency !== r.amount?.currency && <MoneyText money={r.account_amount} className="text-xs text-muted-foreground" />}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusChip vocabulary="instruction" code={r.status} />
          <EvidenceNote channel={r.submission_channel} evidence={r.evidence_status} status={r.status} />
          {isOverdue(r) && <span className="text-xs text-warning">Overdue since {fmtDate(r.expected_settlement_date)}</span>}
        </span>
      ),
    },
    { key: "reference", header: "Reference", hideOnMobile: true, cell: (r) => <bdi dir="ltr" className="font-mono text-xs">{r.reference ?? "—"}</bdi> },
  ];
  return (
    <Card>
      <CardHeader title="Payments" description="Open a payment for its event timeline." />
      <div role="group" aria-label="Filter payments" className="flex flex-wrap gap-2 px-5 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`min-h-[44px] rounded-xl border px-4 text-sm font-medium transition-colors ${filter === f.value ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f.label} <span className="tabular-nums">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <DataTable
        caption="Payments in this batch"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r.id)}
        cardBelowMd
        empty={<EmptyState title={filter === "all" ? "No payments in this batch" : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} payments`} />}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ actions */

type ReasonAction = "reject" | "cancel" | "proceed" | "recreate";

function ActionBar({ batch, onChanged }: { batch: PaymentBatchDetail; onChanged: () => void }) {
  const { me } = useCan();
  const funding = useFundingAccounts();
  const release = useModalRoute("release", { keys: ["batch"] });
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const releaseKey = useRef(newIdempotencyKey());

  const myId = me?.user.id;
  const isPreparer = batch.prepared_by_user_id !== null && batch.prepared_by_user_id === myId;
  const canApprove = can(me, P.PAYROLL_PAYMENT_APPROVE) && !isPreparer;
  const canPrepare = can(me, P.PAYROLL_PAYMENT_PREPARE);
  const canSubmit = can(me, P.PAYROLL_PAYMENT_SUBMIT) && !isPreparer;
  const account = funding.byId(batch.funding_account_id);
  const knownSignatory = account ? account.is_signatory : null;

  const releasable = (batch.method === "BANK_FILE" && batch.status === "FILE_GENERATED") || (batch.method === "API" && batch.status === "APPROVED");
  const releaseOpen = release.open && release.param("batch") === String(batch.id);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await paymentsApi.approve(batch.id, batch.row_version);
      toast.success(batch.method === "BANK_FILE" ? "Batch approved — the preparer can now generate the bank file" : "Batch approved — a signatory can now release it");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const doRelease = async () => {
    try {
      await paymentsApi.release(batch.id, batch.row_version, batch.file?.sha256 ?? null, releaseKey.current);
      toast.success(batch.method === "API" ? "Sent to the SANDBOX payout adapter — no money moved" : `Marked as submitted. ${MANUAL_UNVERIFIED} until the bank statement confirms it.`);
      releaseKey.current = newIdempotencyKey();
      onChanged();
    } catch (err) {
      // Keep the reason on the page after the dialog closes (expired FX quote, not a signatory, conflict).
      setError(err);
      if (isConflict(err) && paymentErrorCode(err) !== "FX_QUOTE_EXPIRED") onChanged();
      throw err;
    }
  };

  const reasonCopy: Record<ReasonAction, { title: string; consequence: string; confirm: string; danger?: boolean; run: (reason: string) => Promise<unknown>; done: string }> = {
    reject: { title: "Reject this batch", consequence: "The batch is cancelled and its payments are ready to be put in another batch.", confirm: "Reject batch", danger: true, run: (r) => paymentsApi.reject(batch.id, r, batch.row_version), done: "Batch rejected — its payments can go into a new batch" },
    cancel: { title: "Cancel this batch", consequence: batch.file?.download_count ? "The file was already downloaded. Make sure it was not uploaded to the bank, or the payments could be made twice." : "The batch is cancelled and its payments are ready to be put in another batch.", confirm: "Cancel batch", danger: true, run: (r) => paymentsApi.cancel(batch.id, r, batch.row_version), done: "Batch cancelled" },
    proceed: { title: "Proceed with the approved accounts", consequence: "The affected payments go to the accounts approved at the time, not to the changed details. This is recorded.", confirm: "Proceed", run: (r) => paymentsApi.resolveBankChanges(batch.id, "PROCEED", r, batch.row_version), done: "Recorded: proceeding with the approved accounts" },
    recreate: { title: "Recreate the affected payments", consequence: "This batch is cancelled. The affected payments are recreated from the current bank details and need a new batch and approval.", confirm: "Cancel and recreate", danger: true, run: (r) => paymentsApi.resolveBankChanges(batch.id, "RECREATE", r, batch.row_version), done: "Batch cancelled and payments recreated" },
  };

  let primary = null;
  let note: string | null = null;
  if (batch.status === "APPROVAL_PENDING") {
    if (canApprove) primary = <Button className="min-h-[44px]" loading={busy} onClick={approve}>Approve batch</Button>;
    else if (isPreparer && can(me, P.PAYROLL_PAYMENT_APPROVE)) note = "You prepared this batch, so another person approves it.";
  } else if (releasable) {
    if (canSubmit && knownSignatory !== false) {
      primary = (
        <Button className="min-h-[44px]" onClick={() => release.openModal({ batch: batch.id })}>
          <ShieldCheck className="h-4 w-4" aria-hidden /> {batch.method === "API" ? "Release to provider" : "Mark as submitted"}
        </Button>
      );
    } else if (isPreparer && can(me, P.PAYROLL_PAYMENT_SUBMIT)) note = "You prepared this batch, so a different signatory releases it.";
    else if (knownSignatory === false && can(me, P.PAYROLL_PAYMENT_SUBMIT)) note = "Only signatories of the funding account can release this batch, and you are not one.";
  }

  const consequences =
    batch.method === "API"
      ? ["The payments are submitted to the SANDBOX payout adapter: simulated, no money moves.", "A batch is released only once; it can't be released again."]
      : [
          "Upload the downloaded file to the bank before you confirm.",
          `The payments show as “${MANUAL_UNVERIFIED}” until the bank statement confirms them. Nothing shows as paid before that.`,
          "A batch is released only once; it can't be released again.",
          batch.file ? `The file must still match its hash ${batch.file.sha256.slice(0, 12)}…` : "",
        ].filter(Boolean);

  return (
    <div className="space-y-3">
      <PaymentErrorBanner error={error} onReload={onChanged} />
      {batch.bank_changes.length > 0 && UNSENT.includes(batch.status) && (
        <div className="space-y-2">
          <BankChangeWarnings items={batch.bank_changes} />
          {can(me, P.PAYROLL_PAYMENT_APPROVE) && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-[44px]" onClick={() => setReasonAction("proceed")}>
                Proceed with approved accounts…
              </Button>
              {canPrepare && (
                <Button variant="secondary" className="min-h-[44px]" onClick={() => setReasonAction("recreate")}>
                  Cancel and recreate…
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {batch.status === "APPROVAL_PENDING" && canApprove && (
          <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setReasonAction("reject")}>
            Reject…
          </Button>
        )}
        {canPrepare && UNSENT.includes(batch.status) && (
          <Button variant="ghost" className="min-h-[44px]" onClick={() => setReasonAction("cancel")}>
            Cancel batch…
          </Button>
        )}
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {reasonAction && (
        <ReasonModal
          open
          onOpenChange={(o) => !o && setReasonAction(null)}
          title={reasonCopy[reasonAction].title}
          consequence={reasonCopy[reasonAction].consequence}
          confirmLabel={reasonCopy[reasonAction].confirm}
          danger={reasonCopy[reasonAction].danger}
          onReload={onChanged}
          onSubmit={async (reason) => {
            await reasonCopy[reasonAction].run(reason);
            toast.success(reasonCopy[reasonAction].done);
            onChanged();
          }}
        />
      )}
      <TypedConfirmModal
        open={releaseOpen && releasable && canSubmit && knownSignatory !== false}
        onOpenChange={release.onOpenChange}
        title={batch.method === "API" ? "Release batch to the payout provider" : "Mark batch as submitted"}
        message={
          <span>
            Releasing <bdi dir="ltr">{batch.reference}</bdi> ({batch.item_count} payment(s), <MoneyText money={batch.total} />) needs you to be a signatory of the funding account and to confirm it&apos;s you.
          </span>
        }
        consequences={consequences}
        confirmText={batch.reference}
        confirmLabel={batch.method === "API" ? "Release" : "Mark as submitted"}
        tone="primary"
        onConfirm={doRelease}
      />
      {releaseOpen && !(releasable && canSubmit && knownSignatory !== false) && (
        <Notice tone="warning" title="This batch can't be released by you now">
          {note ?? "It is not in a releasable state, or your role can't release payments."}
        </Notice>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function BatchDetailPage({ id }: { id: string }) {
  const { me } = useCan();
  const userName = useUserNames();
  const funding = useFundingAccounts();
  const { data, error, loading, reload } = useApi(() => paymentsApi.batch(id), [id]);
  const sheet = useModalRoute("instruction");
  const canDownload = canAny(me, [P.PAYROLL_PAYMENT_PREPARE, P.PAYROLL_PAYMENT_SUBMIT]);
  const canGenerate = can(me, P.PAYROLL_PAYMENT_PREPARE);
  const refresh = () => void reload();
  return (
    <div>
      <Link href="/payroll/payments" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Payout files
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={refresh} what="Payment batch" backHref="/payroll/payments" backLabel="Back to payout files">
        {data && (
          <div className="space-y-5">
            <WorkspaceHeader
              eyebrow={<Link href="/payroll/payments" className="hover:underline">Payout Files</Link>}
              title={<bdi dir="ltr">{data.reference}</bdi>}
              description={`${METHOD_LABELS[data.method] ?? data.method}${data.file_format ? ` · ${data.file_format}` : ""} · ${funding.label(data.funding_account_id)}${data.value_date ? ` · value date ${fmtDate(data.value_date)}` : ""}`}
            />
            <PaymentsNav />
            {loading && data && <p className="sr-only" aria-live="polite">Refreshing…</p>}
            <Card className="space-y-4 p-5">
              <BatchStatus batch={data} />
              {data.status === "SUBMITTED" && !data.sandbox && (
                <Notice tone="warning" title={MANUAL_UNVERIFIED}>
                  The file was uploaded to the bank by a person. Payments settle only when the bank statement is imported in Reconciliation.
                </Notice>
              )}
              {UNSENT.includes(data.status) && <ValueDateNotice warnings={data.value_date_warnings} valueDate={data.value_date} />}
              {data.status_reason && <Notice tone="info" title="Reason">{STATUS_REASON_TEXT[data.status_reason] ?? humanize(data.status_reason)}</Notice>}
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Meta label="Run">{data.run_id ? `#${data.run_id}` : "—"}</Meta>
                <Meta label="Prepared by">{userName(data.prepared_by_user_id)}</Meta>
                <Meta label="Approved by">{data.approved_by_user_id ? `${userName(data.approved_by_user_id)} · ${fmtDateTime(data.approved_at)}` : "—"}</Meta>
                <Meta label="Released by">{data.released_by_user_id ? `${userName(data.released_by_user_id)} · ${fmtDateTime(data.released_at)}` : "—"}</Meta>
              </dl>
              <ActionBar batch={data} onChanged={refresh} />
            </Card>
            <Summary batch={data} />
            <FilePanel batch={data} canDownload={canDownload} canGenerate={canGenerate} onChanged={refresh} />
            <InstructionsCard batch={data} onOpen={(iid) => sheet.openModal({ id: iid })} />
            <Card>
              <CardHeader title={`Exclusions (${data.exclusions.length})`} description="Payments of the run that were not put in this batch, and why." />
              <ExclusionsTable items={data.exclusions} caption="Payments excluded when the batch was created" />
            </Card>
          </div>
        )}
      </DetailGate>
      <InstructionSheet open={sheet.open} onOpenChange={sheet.onOpenChange} id={sheet.id} onChanged={refresh} />
    </div>
  );
}
