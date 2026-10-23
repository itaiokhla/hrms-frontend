"use client";

import { ArrowLeft, Download, Eye, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { FileDropzone } from "@/components/payroll/FileDropzone";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isConflict, newIdempotencyKey } from "@/lib/payroll/api";
import { statusEntry } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { fetchFile, paymentsApi, saveFile } from "./api";
import {
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  EvidenceNote,
  Hash,
  MANUAL_UNVERIFIED,
  Meta,
  Notice,
  ReasonModal,
  STATUS_REASON_TEXT,
  SandboxBadge,
  WorkspaceHeader,
  errorText,
  fieldErrors,
  humanize,
  useEmployeeDirectory,
  useUserNames,
} from "./shared";
import type { InstructionDetail, ManualProof, PaymentEvent, PaymentInstruction } from "./types";

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

/* ------------------------------------------------------------------ manual proof (EC-PAY-14) */

export const MANUAL_METHODS: Record<string, string> = { CHEQUE: "Cheque", CASH: "Cash", BANK_TRANSFER: "Bank transfer (outside the system)", OTHER: "Other" };
const PROOF_MAX_BYTES = 10 * 1024 * 1024;

/** Upload proof of a payment made outside the system. Nothing settles until a second person approves it. */
export function ManualProofModal({ open, onOpenChange, instruction, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; instruction: InstructionDetail; onDone: () => void }) {
  const [method, setMethod] = useState("CHEQUE");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (!open) return;
    setMethod("CHEQUE");
    setReference("");
    setNote("");
    setFile(null);
    setErrors({});
    setError(null);
    key.current = newIdempotencyKey();
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!reference.trim()) next.reference = "Give the cheque number, receipt or transfer reference.";
    if (!file) next.file = "Attach the proof (PDF, PNG or JPEG).";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await paymentsApi.submitManualProof(instruction.id, { method, reference: reference.trim(), note: note.trim() || undefined, file: file as File, rowVersion: instruction.row_version }, key.current);
      toast.success("Proof uploaded — a second person reviews it before the payment counts as settled");
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      size="md"
      title="Upload proof of manual payment"
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="manual-proof" className="min-h-[44px]" loading={busy}>
            Upload proof
          </Button>
        </>
      }
    >
      <form id="manual-proof" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm">The payment stays “{MANUAL_UNVERIFIED}” until another person checks this proof. Only then does it count as settled.</p>
        <ConflictBanner error={error} onReload={() => { onOpenChange(false); onDone(); }} />
        <ErrorSummary error={error} fields={{ ...fieldErrors(error), ...errors }} />
        <Field label="How was it paid?">
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="min-h-[44px]">
            {Object.entries(MANUAL_METHODS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" required error={errors.reference} hint="Cheque number, receipt number or the bank's transfer reference.">
          <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} className="min-h-[44px]" />
        </Field>
        <Field label="Note (optional)">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div>
          <FileDropzone accept={[".pdf", ".png", ".jpg", ".jpeg"]} maxBytes={PROOF_MAX_BYTES} label="Proof file" hint={file ? `Chosen: ${file.name}` : "PDF, PNG or JPEG, up to 10 MB"} onFiles={(files) => { setFile(files[0] ?? null); setErrors((x) => ({ ...x, file: "" })); }} />
          {errors.file && <p role="alert" className="mt-1 text-sm text-danger">{errors.file}</p>}
        </div>
      </form>
    </Modal>
  );
}

/**
 * View or download the uploaded proof (GET /payroll/manual-settlements/{id}/file, payroll:payment:reconcile
 * in scope). Each fetch is audited by the server; the copy lives only in this viewer. The hash the server
 * sends is compared with the one recorded at upload, so a changed file is never shown as the proof.
 */
/** The proof types the server accepts (payment_events.EVIDENCE_TYPES), the only ones shown inline. */
const PREVIEWABLE_PROOF_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export function ProofFileViewer({ proof }: { proof: ManualProof }) {
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState(proof.evidence_mime ?? "");
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const name = proof.evidence_name ?? `Proof #${proof.id}`;
  const verify = (sha: string | null) => {
    if (sha && proof.evidence_sha256 && sha.toLowerCase() !== proof.evidence_sha256.toLowerCase()) {
      throw new Error("The file received doesn't match the proof that was uploaded. Don't rely on it; report this to an administrator.");
    }
  };
  const view = async () => {
    setBusy("view");
    setError(null);
    try {
      const file = await fetchFile(paymentsApi.proofFileUrl(proof.id));
      verify(file.sha256);
      // Only the types the server accepts as proof are embedded; a blob of any other type (HTML, SVG…)
      // would render inside the app's own origin, so it is offered as a download instead.
      const type = (file.mime || "").split(";")[0].trim().toLowerCase();
      if (!PREVIEWABLE_PROOF_TYPES.has(type)) {
        throw new Error("This file can't be previewed here. Download it to open it.");
      }
      setMime(type);
      setUrl(URL.createObjectURL(new Blob([file.blob], { type })));
    } catch (err) {
      setError(err instanceof Error && !("status" in err) ? err.message : errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      const file = await fetchFile(paymentsApi.proofFileUrl(proof.id, true));
      verify(file.sha256);
      saveFile(file, name);
    } catch (err) {
      setError(err instanceof Error && !("status" in err) ? err.message : errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Proof file: {name} · <Hash value={proof.evidence_sha256} />
        </span>
        {url ? (
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setUrl(null)}>
            Close viewer
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="min-h-[44px]" loading={busy === "view"} onClick={() => void view()} aria-label={`View proof ${name}`}>
            <Eye className="h-4 w-4" aria-hidden /> View
          </Button>
        )}
        <Button variant="ghost" size="sm" className="min-h-[44px]" loading={busy === "download"} onClick={() => void download()} aria-label={`Download proof ${name}`}>
          <Download className="h-4 w-4" aria-hidden /> Download
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {url && (
        <div className="rounded-xl border border-border p-2">
          <p className="mb-2 text-xs text-muted-foreground">Opening the proof was recorded in the audit log.</p>
          {mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`Proof of manual payment: ${name}`} className="max-h-[480px] w-full rounded-lg object-contain" />
          ) : (
            <iframe src={url} title={`Proof of manual payment: ${name}`} className="h-[480px] w-full rounded-lg border border-border" />
          )}
        </div>
      )}
    </div>
  );
}

function ManualProofs({ row, onChanged }: { row: InstructionDetail; onChanged: () => void }) {
  const { me } = useCan();
  const userName = useUserNames();
  const [rejecting, setRejecting] = useState<ManualProof | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reconciler = can(me, P.PAYROLL_PAYMENT_RECONCILE);
  if (!row.manual_proofs.length) return null;
  const approve = async (p: ManualProof) => {
    setBusy(p.id);
    setError(null);
    try {
      await paymentsApi.approveManualProof(p.id, p.row_version);
      toast.success("Proof approved — the payment is settled");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label="Manual proofs" className="space-y-2 text-sm">
      <h3 className="font-semibold">Proof of manual payment</h3>
      <ConflictBanner error={error} onReload={onChanged} />
      {error && !isConflict(error) ? <p role="alert" className="text-danger">{errorText(error)}</p> : null}
      <ul className="space-y-2">
        {row.manual_proofs.map((p) => {
          const own = p.submitted_by_user_id !== null && p.submitted_by_user_id === me?.user.id;
          const pending = p.status === "PENDING_REVIEW";
          return (
            <li key={p.id} className="space-y-1 rounded-xl border border-border p-3">
              <p>
                {MANUAL_METHODS[p.method] ?? humanize(p.method)} · ref <bdi dir="ltr">{p.evidence_reference ?? "—"}</bdi> ·{" "}
                <span className={pending ? "text-warning" : p.status === "APPROVED" ? "text-success" : "text-danger"}>{pending ? "Waiting for a second reviewer" : humanize(p.status)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Uploaded {fmtDateTime(p.created_at)} by {userName(p.submitted_by_user_id)}
                {p.evidence_name ? ` · ${p.evidence_name}` : ""}
                {p.reviewed_at ? ` · reviewed ${fmtDateTime(p.reviewed_at)} by ${userName(p.reviewed_by_user_id)}` : ""}
              </p>
              {p.note && <p className="text-xs">{p.note}</p>}
              {p.review_note && <p className="text-xs">Review: {p.review_note}</p>}
              {reconciler && (p.evidence_name || p.evidence_sha256) && <ProofFileViewer proof={p} />}
              {pending && reconciler && own && <p className="text-xs text-muted-foreground">You uploaded this proof, so another person reviews it.</p>}
              {pending && reconciler && !own && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" className="min-h-[44px]" loading={busy === p.id} onClick={() => approve(p)}>
                    Approve proof
                  </Button>
                  <Button size="sm" variant="secondary" className="min-h-[44px] text-danger" onClick={() => setRejecting(p)}>
                    Reject…
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ReasonModal
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject the proof"
        consequence="The payment stays unverified. The person who uploaded the proof sees your reason."
        confirmLabel="Reject proof"
        danger
        onReload={onChanged}
        onSubmit={async (reason) => {
          if (!rejecting) return;
          await paymentsApi.rejectManualProof(rejecting.id, reason, rejecting.row_version);
          toast.success("Proof rejected");
          onChanged();
        }}
      />
    </section>
  );
}

/** A reissue waiting for a second person (payroll.payments.reissue_requires_approval). */
function ReissueRequest({ row, onChanged }: { row: InstructionDetail; onChanged: () => void }) {
  const { me } = useCan();
  const userName = useUserNames();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = row.reissue_request as { requested_by_user_id?: number | null; at?: string | null; reason?: string | null } | null | undefined;
  if (!request) return null;
  const requester = request.requested_by_user_id ?? null;
  const own = requester !== null && requester === me?.user.id;
  const approver = can(me, P.PAYROLL_PAYMENT_APPROVE);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await paymentsApi.approveReissue(row.id, row.row_version);
      toast.success("Reissue approved — the new payment joins the next batch");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice tone="info" title="Reissue waiting for approval">
      <p>
        Requested by {userName(requester)}
        {request.at ? ` · ${fmtDateTime(request.at)}` : ""}
        {request.reason ? ` — “${request.reason}”` : ""}
      </p>
      <ConflictBanner error={error} onReload={onChanged} className="mt-2" />
      {error && !isConflict(error) ? <p role="alert" className="mt-1 text-danger">{errorText(error)}</p> : null}
      {approver && own && <p className="mt-1 text-xs text-muted-foreground">You requested this reissue, so another person approves it.</p>}
      {approver && !own && (
        <Button size="sm" className="mt-2 min-h-[44px]" loading={busy} onClick={approve}>
          Approve reissue
        </Button>
      )}
    </Notice>
  );
}

/** Instruction facts, honest status and its event timeline. */
export function InstructionBody({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const { me } = useCan();
  const employees = useEmployeeDirectory();
  const userName = useUserNames();
  const detail = useApi(() => paymentsApi.instruction(id), [id]);
  const events = useApi(() => paymentsApi.events(id), [id]);
  const [action, setAction] = useState<"release-hold" | "reissue" | "manual-proof" | null>(null);
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
  const canUploadProof =
    can(me, P.PAYROLL_PAYMENT_RECONCILE) &&
    [...IN_FLIGHT, "PARTIALLY_SETTLED"].includes(row.status) &&
    row.submission_channel !== "SANDBOX" &&
    !row.manual_proofs.some((p) => p.status === "PENDING_REVIEW");
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
              In the account&apos;s currency: <MoneyText money={row.account_amount} />
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
        {row.status_reason && <Meta label="Reason">{STATUS_REASON_TEXT[row.status_reason] ?? humanize(row.status_reason)}</Meta>}
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
      {(canReleaseHold || canReissue || canUploadProof) && (
        <div className="flex flex-wrap gap-2">
          {canUploadProof && (
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setAction("manual-proof")}>
              Upload proof of manual payment…
            </Button>
          )}
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
      <ReissueRequest row={row} onChanged={reload} />
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
      <ManualProofs row={row} onChanged={reload} />
      <ManualProofModal open={action === "manual-proof"} onOpenChange={(o) => !o && setAction(null)} instruction={row} onDone={reload} />
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
