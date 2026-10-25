"use client";

import { ArrowLeft, ExternalLink, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MaskedValue } from "@/components/payroll/MaskedValue";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { can, canAny } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { bankApi, fetchFile } from "./api";
import {
  CHANNEL_LABELS,
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  HOLD_REASONS,
  Hash,
  LocalChip,
  METHOD_LABELS,
  Meta,
  Notice,
  SandboxBadge,
  WorkspaceHeader,
  errorText,
  fieldErrors,
  flagLabel,
  humanize,
  useCountdown,
  useEmployeeDirectory,
  useUserNames,
} from "./shared";
import type { BankAccount, BankAccountDetail, BankVerification } from "./types";

export const REVEAL_REASON_MIN = 10;

/**
 * `MaskedValue.onReveal` for a payee account: read_full + reason (≥ 10 characters, checked here so
 * the person gets a clear message) + step-up (payrollApi prompts), audited on the server.
 */
export function useRevealAccount(accountId: number): ((reason: string) => Promise<string>) | undefined {
  const { me } = useCan();
  if (!can(me, P.PAYROLL_BANK_DETAILS_READ_FULL)) return undefined;
  return async (reason: string) => {
    if (reason.trim().length < REVEAL_REASON_MIN) {
      throw new ApiError(400, `Say why you need the full number (at least ${REVEAL_REASON_MIN} characters).`, "REASON_REQUIRED");
    }
    const full = await bankApi.reveal(accountId, reason);
    return full.iban || full.account_number || full.account_masked;
  };
}

export function AccountNumber({ account, label }: { account: Pick<BankAccount, "id" | "account_masked" | "has_iban">; label?: string }) {
  const onReveal = useRevealAccount(account.id);
  return <MaskedValue masked={account.account_masked} label={label ?? (account.has_iban ? "IBAN" : "account number")} onReveal={onReveal} />;
}

/** Routing codes are sent in full by the API (they identify a branch, not an account). */
export function routingText(routing: Record<string, string> | null | undefined): string {
  const entries = Object.entries(routing ?? {}).filter(([, v]) => !!v);
  if (!entries.length) return "—";
  return entries.map(([k, v]) => `${k.replace(/_/g, " ").toUpperCase()} ${v}`).join(" · ");
}

/* ------------------------------------------------------------------ inline evidence viewer */

/** Opens the evidence file on request (each open is audited) and shows it inline; the copy is dropped on close. */
export function EvidenceViewer({ accountId, evidence }: { accountId: number; evidence: BankVerification }) {
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>(evidence.evidence_mime ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await fetchFile(bankApi.evidenceUrl(accountId, evidence.id));
      setMime(file.mime);
      setUrl(URL.createObjectURL(file.blob));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const name = evidence.evidence_file_name ?? `Evidence #${evidence.id}`;
  return (
    <div className="rounded-2xl border border-border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            Uploaded {fmtDateTime(evidence.at)}
            {evidence.evidence_bytes ? ` · ${Math.max(1, Math.round(evidence.evidence_bytes / 1024))} KB` : ""} · <Hash value={evidence.evidence_sha256} />
          </p>
        </div>
        {url ? (
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setUrl(null)}>
            Close viewer
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="min-h-[44px]" loading={busy} onClick={open}>
            View document
          </Button>
        )}
      </div>
      {error && <p role="alert" className="px-3 pb-3 text-sm text-danger">{error}</p>}
      {url && (
        <div className="border-t border-border p-3">
          <p className="mb-2 text-xs text-muted-foreground">Opening this document was recorded in the audit log. It shows the full account number.</p>
          {mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`Bank evidence: ${name}`} className="max-h-[480px] w-full rounded-xl object-contain" />
          ) : (
            <iframe src={url} title={`Bank evidence: ${name}`} className="h-[480px] w-full rounded-xl border border-border" />
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ decisions */

type Decision =
  | { kind: "verify-pass"; evidenceId: number }
  | { kind: "verify-fail" }
  | { kind: "provider"; method: "PENNY_DROP" | "PROVIDER_NAME_MATCH" }
  | { kind: "review"; action: "CLEAR_REVIEW" | "MARK_VERIFIED" | "MARK_FAILED" | "RESUBMIT" }
  | { kind: "waive" };

const DECISION_COPY: Record<string, { title: string; consequence: string; confirm: string; reasonRequired: boolean; danger?: boolean }> = {
  "verify-pass": { title: "Verify this account", consequence: "The document shows this account belongs to the payee. Once every required check passes, the account is verified.", confirm: "Verify", reasonRequired: false },
  "verify-fail": { title: "Fail verification", consequence: "The account is marked as failed and its payments are held until the payee adds a correct account.", confirm: "Fail verification", reasonRequired: true, danger: true },
  provider: { title: "Run a provider check", consequence: "The check runs on the SANDBOX adapter: it is simulated, no money moves and no bank or provider is contacted.", confirm: "Run check", reasonRequired: false },
  CLEAR_REVIEW: { title: "Clear the review", consequence: "Open risk flags are closed and any review hold is lifted. Payments can go to this account again.", confirm: "Clear review", reasonRequired: true },
  MARK_VERIFIED: { title: "Mark as verified", consequence: "Open risk flags are closed, the hold is lifted and the account is verified.", confirm: "Mark verified", reasonRequired: true },
  MARK_FAILED: { title: "Mark as failed", consequence: "Payments to this account stay held until the payee adds a correct account.", confirm: "Mark failed", reasonRequired: true, danger: true },
  RESUBMIT: { title: "Send for verification again", consequence: "The account goes back to pending verification.", confirm: "Resubmit", reasonRequired: false },
  waive: { title: "End the cooling-off period now", consequence: "Payments can go to this account immediately instead of after the waiting period. Only do this after confirming the change with the employee by phone.", confirm: "End cooling-off", reasonRequired: true, danger: true },
};

function decisionKey(d: Decision): string {
  return d.kind === "review" ? d.action : d.kind;
}

function DecisionDialog({ account, decision, onClose, onDone }: { account: BankAccountDetail; decision: Decision | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason("");
    setReasonError(undefined);
    setError(null);
  }, [decision]);
  if (!decision) return null;
  const copy = DECISION_COPY[decisionKey(decision)];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (copy.reasonRequired && reason.trim().length < 3) {
      setReasonError("Give a reason (at least 3 characters). It is kept in the audit trail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const text = reason.trim() || undefined;
      if (decision.kind === "verify-pass") {
        await bankApi.verify(account.id, { method: "DOCUMENT_REVIEW", decision: "PASS", evidence_id: decision.evidenceId, reason: text }, account.row_version);
        toast.success("Document review recorded");
      } else if (decision.kind === "verify-fail") {
        await bankApi.verify(account.id, { method: "DOCUMENT_REVIEW", decision: "FAIL", reason: text }, account.row_version);
        toast.success("Verification failed — the payee will be asked for a correct account");
      } else if (decision.kind === "provider") {
        const result = await bankApi.verify(account.id, { method: decision.method, reason: text }, account.row_version);
        toast.success(`Sandbox check: ${humanize(result.verification?.result ?? "recorded")}`);
      } else if (decision.kind === "review") {
        await bankApi.review(account.id, decision.action, reason.trim(), account.row_version);
        toast.success("Review recorded");
      } else {
        await bankApi.waiveCoolingOff(account.id, reason.trim(), account.row_version);
        toast.success("Cooling-off ended");
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const formId = `bank-decision-${decisionKey(decision)}`;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      size="sm"
      title={copy.title}
      description={`${account.holder_name} · ${account.account_masked}`}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={copy.danger ? "danger" : "primary"} className="min-h-[44px]" loading={busy}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm">{copy.consequence}</p>
        {decision.kind === "provider" && <SandboxBadge />}
        <ConflictBanner error={error} onReload={() => { onClose(); onDone(); }} />
        <ErrorSummary error={error} fields={fieldErrors(error)} />
        <Field label={copy.reasonRequired ? "Reason" : "Note (optional)"} required={copy.reasonRequired} error={reasonError}>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(undefined); }} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ panel */

function verificationTimeline(rows: BankVerification[], userName: (id: number | null | undefined) => string): TimelineItem[] {
  return [...rows].reverse().map((v) => ({
    id: v.id,
    at: v.at,
    title: (
      <span className="inline-flex flex-wrap items-center gap-2">
        {METHOD_LABELS[v.method] ?? humanize(v.method)}: {humanize(v.result)}
        {v.sandbox && <SandboxBadge />}
      </span>
    ),
    actor: v.performed_by_user_id ? userName(v.performed_by_user_id) : "System",
    body: [v.reason, v.name_match_score ? `Name match score ${v.name_match_score}` : null].filter(Boolean).join(" · ") || undefined,
    tone: v.result === "PASSED" || v.result === "CLEARED" ? "success" : v.result === "FAILED" ? "danger" : v.result === "FLAGGED" ? "warning" : "neutral",
  }));
}

/** Everything about one payee account: details, flags, evidence with an inline viewer, and the decisions the viewer may take. */
export function BankAccountBody({ account, onChanged, compact = false }: { account: BankAccountDetail; onChanged: () => void; compact?: boolean }) {
  const { me } = useCan();
  const userName = useUserNames();
  const employees = useEmployeeDirectory();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [provider, setProvider] = useState<"PENNY_DROP" | "PROVIDER_NAME_MATCH">("PENNY_DROP");
  const coolingLeft = useCountdown(account.cooling_off ? account.usable_from : null);

  const approver = can(me, P.PAYROLL_BANK_DETAILS_APPROVE);
  const editor = can(me, P.PAYROLL_BANK_DETAILS_EDIT);
  const canOpenEvidence = canAny(me, [P.PAYROLL_BANK_DETAILS_APPROVE, P.PAYROLL_BANK_DETAILS_READ_FULL]);
  const own = account.employee_id !== null && me?.employee?.id === account.employee_id;
  const maker = account.created_by_user_id !== null && account.created_by_user_id === me?.user.id;
  const awaiting = ["PENDING", "REQUIRES_REVIEW"].includes(account.verification_status) && ["PENDING_APPROVAL", "ACTIVE"].includes(account.status);
  const evidence = account.verifications.filter((v) => v.result === "EVIDENCE_SUBMITTED" && v.has_evidence);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip vocabulary="bank_account" code={account.status} />
        <StatusChip vocabulary="verification" code={account.verification_status} />
        {account.payment_hold && (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Payments held
          </span>
        )}
      </div>

      {own && <Notice tone="info" title="This is your own account">Your own bank account is verified and decided by other payroll staff.</Notice>}
      {account.payment_hold && (
        <Notice tone="danger" title="Payments to this account are held">
          {HOLD_REASONS[account.hold_reason ?? ""] ?? humanize(account.hold_reason)}. Clearing the review lifts the hold.
        </Notice>
      )}
      {coolingLeft && (
        <Notice tone="warning" title={`Cooling-off: usable for payments in ${coolingLeft}`}>
          New or changed accounts wait before the first payment, so a fraudulent change can be stopped. Usable from {fmtDateTime(account.usable_from)}.
        </Notice>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Payee">{account.employee_id ? employees.name(account.employee_id) : `${humanize(account.payee_type)} #${account.payee_id}`}</Meta>
        <Meta label="Account holder">{account.holder_name}</Meta>
        <Meta label={account.has_iban ? "IBAN" : "Account number"}>
          <AccountNumber account={account} />
        </Meta>
        <Meta label="Bank">{[account.bank_name, account.branch_name].filter(Boolean).join(", ") || "—"}</Meta>
        <Meta label="Routing">
          <bdi dir="ltr">{routingText(account.routing)}</bdi>
        </Meta>
        <Meta label="Country · currency">
          {account.country} · {account.currency}
        </Meta>
        <Meta label="Split">{account.allocation.type === "PRIMARY" ? "Primary account" : `${humanize(account.allocation.type)}${account.allocation.value ? ` ${account.allocation.value}` : ""}`}</Meta>
        <Meta label="Verified">{account.verified_at ? `${fmtDate(account.verified_at)} · ${METHOD_LABELS[account.verification_method ?? ""] ?? humanize(account.verification_method)}` : "Not yet"}</Meta>
        <Meta label="Added">{fmtDateTime(account.created_at)} by {userName(account.created_by_user_id)}</Meta>
      </dl>

      {(account.risk_flags ?? []).length > 0 && (
        <section aria-label="Risk flags" className="space-y-2">
          <h3 className="text-sm font-semibold">Risk flags</h3>
          <ul className="space-y-2">
            {(account.risk_flags ?? []).map((f, i) => (
              <li key={`${f.code}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <span className={f.open ? "font-medium text-danger" : "text-muted-foreground line-through"}>{flagLabel(f.code)}</span>
                {f.detail && <span className="text-muted-foreground">— {f.detail}</span>}
                {f.score && <span className="text-xs text-muted-foreground">score {f.score}</span>}
                {!f.open && f.closed_reason && <span className="text-xs text-muted-foreground">Closed: {f.closed_reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Verification documents" className="space-y-2">
        <h3 className="text-sm font-semibold">Verification documents</h3>
        {!evidence.length ? (
          <p className="text-sm text-muted-foreground">No document uploaded yet. The payee or HR uploads a cancelled cheque or bank letter for document review.</p>
        ) : canOpenEvidence ? (
          evidence.map((ev) => (
            <div key={ev.id} className="space-y-2">
              <EvidenceViewer accountId={account.id} evidence={ev} />
              {approver && awaiting && !own && !maker && (
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-[44px]" onClick={() => setDecision({ kind: "verify-pass", evidenceId: ev.id })}>
                    <ShieldCheck className="h-4 w-4" aria-hidden /> Verify from this document
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{evidence.length} document(s) uploaded. Documents show the full account number, so only approvers and people allowed to see full details open them.</p>
        )}
      </section>

      {awaiting && !own && (approver || editor) && (
        <section aria-label="Decisions" className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          {approver && maker && <p className="w-full text-sm text-muted-foreground">You entered this account, so another approver verifies it.</p>}
          {approver && !maker && account.verification_status === "PENDING" && (
            <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setDecision({ kind: "verify-fail" })}>
              Fail with reason
            </Button>
          )}
          {approver && !maker && account.verification_status === "REQUIRES_REVIEW" && (
            <>
              <Button className="min-h-[44px]" onClick={() => setDecision({ kind: "review", action: "CLEAR_REVIEW" })}>
                Clear review
              </Button>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => setDecision({ kind: "review", action: "MARK_VERIFIED" })}>
                Mark verified
              </Button>
              <Button variant="secondary" className="min-h-[44px] text-danger" onClick={() => setDecision({ kind: "review", action: "MARK_FAILED" })}>
                Mark failed
              </Button>
            </>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Provider check">
              <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="min-h-[44px]">
                <option value="PENNY_DROP">Penny drop (sandbox)</option>
                <option value="PROVIDER_NAME_MATCH">Provider name match (sandbox)</option>
              </Select>
            </Field>
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setDecision({ kind: "provider", method: provider })}>
              Run check
            </Button>
          </div>
        </section>
      )}
      {editor && !own && account.verification_status === "FAILED" && account.status !== "INACTIVE" && (
        <div className="border-t border-border pt-4">
          <Button variant="secondary" className="min-h-[44px]" onClick={() => setDecision({ kind: "review", action: "RESUBMIT" })}>
            Send for verification again
          </Button>
        </div>
      )}
      {approver && !own && !maker && coolingLeft && account.payee_type !== "NOMINEE" && (
        <div className="border-t border-border pt-4">
          <Button variant="secondary" className="min-h-[44px]" onClick={() => setDecision({ kind: "waive" })}>
            End cooling-off now…
          </Button>
        </div>
      )}

      {!compact && (
        <section aria-label="History" className="space-y-2">
          <h3 className="text-sm font-semibold">Verification history</h3>
          <Timeline items={verificationTimeline(account.verifications, userName)} empty={<p className="text-sm text-muted-foreground">No checks yet.</p>} label="Verification history" />
          {account.change_requests.length > 0 && (
            <ul className="space-y-1 text-sm">
              {account.change_requests.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/payroll/bank-details/changes/${c.id}`} className="font-medium text-primary hover:underline">
                    Change request #{c.id}
                  </Link>
                  <LocalChip vocabulary="change" code={c.status} />
                  <span className="text-muted-foreground">
                    {CHANNEL_LABELS[c.channel] ?? c.channel} · {fmtDate(c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <DecisionDialog account={account} decision={decision} onClose={() => setDecision(null)} onDone={onChanged} />
    </div>
  );
}

/** Modal form of an account (`?modal=account&id=`), with "Open full page ↗". */
export function BankAccountModal({ open, onOpenChange, id, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; id: string | null; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi(() => bankApi.account(id ?? ""), [id], { enabled: open && !!id });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={data ? `${data.holder_name} · ${data.account_masked}` : "Bank account"}
      description={
        id ? (
          <Link href={`/payroll/bank-details/accounts/${id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {loading && !data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error && !data ? (
        <p role="alert" className="text-sm text-danger">
          {error.status === 404 || error.status === 403 ? "This account was not found, or it is outside the people you can see." : error.message}{" "}
          <button type="button" className="font-medium underline" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      ) : data ? (
        <BankAccountBody account={data} compact onChanged={() => { void reload(); onChanged(); }} />
      ) : null}
    </Modal>
  );
}

/** Full page of an account (`/payroll/bank-details/accounts/[id]`). */
export function BankAccountPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => bankApi.account(id), [id]);
  return (
    <div>
      <Link href="/payroll/bank-details" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Bank Details
      </Link>
      <DetailGate loading={loading} error={error} hasData={!!data} onRetry={() => void reload()} what="Bank account" backHref="/payroll/bank-details" backLabel="Back to Bank Details">
        {data && (
          <>
            <WorkspaceHeader title={`${data.holder_name}`} description={`Bank account ${data.account_masked} · ${data.bank_name ?? data.country}`} />
            <Card>
              <CardHeader title="Account" />
              <div className="p-5 pt-0">
                <BankAccountBody account={data} onChanged={() => void reload()} />
              </div>
            </Card>
          </>
        )}
      </DetailGate>
    </div>
  );
}
