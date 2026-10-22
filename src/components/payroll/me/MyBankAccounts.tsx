"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Clock3, Landmark, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { FileDropzone } from "@/components/payroll/FileDropzone";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { AddBankAccountModal, AddBankAccountWizard } from "./AddBankAccount";
import { meApi } from "./api";
import { countryName } from "./bankFormat";
import { canSelf, ConflictBanner, DetailGate, ErrorSummary, fieldErrors, LinkButton, MeChip, MeHeader, Notice, timeLeft } from "./shared";
import type { MyBankAccount, MyBankChange } from "./types";

const OPEN_CHANGES = new Set(["SECURITY_REVIEW", "PENDING_APPROVAL"]);

function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function allocationText(a: MyBankAccount): string | null {
  switch (a.allocation?.type) {
    case "PERCENT":
      return `${a.allocation.value}% of net pay`;
    case "FIXED":
      return `${a.allocation.value} ${a.currency} of net pay`;
    case "REMAINDER":
      return "The rest of net pay";
    default:
      return null;
  }
}

/** My Bank Accounts (3.8 §5.18): masked accounts, verification chips, pending change with cooling-off, Add account. */
export function MyBankAccounts() {
  const { me } = useCan();
  const reduceMotion = useReducedMotion();
  const canEdit = canSelf(me, P.PAYROLL_BANK_DETAILS_EDIT);
  const [dirty, setDirty] = useState(false);
  const add = useModalRoute("add-bank", { keys: [], dirty });
  const accounts = useApi(() => meApi.bankAccounts(), []);
  const changes = useApi(() => meApi.bankChanges(), []);
  const currencyHint = useApi(() => meApi.claimTypes(), [], { enabled: !!me?.employee });
  const now = useNow();

  const items = accounts.data?.items;
  const shown = useMemo(() => (items ?? []).filter((a) => a.status !== "INACTIVE"), [items]);
  const past = useMemo(() => (items ?? []).filter((a) => a.status === "INACTIVE"), [items]);
  const open = (changes.data?.items ?? []).filter((c) => OPEN_CHANGES.has(c.status));
  const reload = () => {
    void accounts.reload();
    void changes.reload();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader
        title="My Bank Accounts"
        hideAmounts={false}
        description="Where your salary is paid. Numbers are always masked; changes are checked by HR before they're used."
        actions={
          canEdit && (
            <Button className="min-h-[44px]" disabled={open.length > 0} title={open.length ? "A change is already waiting for approval" : undefined} onClick={() => add.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> Add account
            </Button>
          )
        }
      />
      {open.length > 0 && (
        <div className="mb-5 space-y-3">
          {open.map((c) => (
            <PendingChange key={c.id} change={c} onChanged={reload} />
          ))}
        </div>
      )}

      {accounts.error && !items ? (
        <Card>
          <ErrorState message={accounts.error.message} onRetry={accounts.reload} />
        </Card>
      ) : accounts.loading && !items ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading bank accounts">
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : !shown.length && !open.length ? (
        <Card>
          <EmptyState
            icon={<Landmark />}
            title="No bank account yet"
            description="Add the account your salary should go to. Without one, your payment is held until HR has your details."
            action={
              canEdit ? (
                <Button className="min-h-[44px]" onClick={() => add.openModal()}>
                  <Plus className="h-4 w-4" aria-hidden /> Add account
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Ask HR to add your bank account.</p>
              )
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Bank accounts">
          {shown.map((a, i) => (
            <motion.li key={a.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.05 }}>
              <AccountCard account={a} now={now} />
            </motion.li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="mt-6">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-muted-foreground">Previous accounts ({past.length})</summary>
          <ul className="mt-2 space-y-2">
            {past.map((a) => (
              <li key={a.id}>
                <AccountCard account={a} now={now} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
        <AddBankAccountModal
          open={add.open}
          onOpenChange={add.onOpenChange}
          accounts={items ?? []}
          defaultCurrency={currencyHint.data?.currency}
          onDirtyChange={setDirty}
          onDone={() => {
            setDirty(false);
            void add.close();
            reload();
          }}
        />
      )}
    </div>
  );
}

function AccountCard({ account: a, now }: { account: MyBankAccount; now: number }) {
  const cooling = a.cooling_off ? timeLeft(a.usable_from, now) : null;
  const share = allocationText(a);
  return (
    <Card className="p-5">
      <Link href={`/me/bank-accounts/${a.id}`} className="-m-2 block rounded-xl p-2 hover:bg-surface-muted">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {a.bank_name ?? "Bank account"} <bdi dir="ltr" className="font-mono">{a.account_masked}</bdi>
          </p>
          <span className="ms-auto flex flex-wrap gap-1.5">
            <StatusChip vocabulary="bank_account" code={a.status} />
            <StatusChip vocabulary="verification" code={a.verification_status} />
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {a.holder_name} · {countryName(a.country)} · {a.currency}
          {share && <> · {share}</>}
        </p>
      </Link>
      {cooling && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-sm" role="status">
          <Clock3 className="h-4 w-4 text-info" aria-hidden />
          Usable for salary in {cooling} (from {fmtDateTime(a.usable_from)}). This waiting period protects you against fraudulent changes.
        </p>
      )}
      {a.under_review && (
        <Notice tone="warning" title="Being checked" className="mt-3">
          HR is reviewing this account. Payments to it may wait until the check is done.
        </Notice>
      )}
      {a.update_required && (
        <Notice tone="danger" title="This account needs an update" className="mt-3">
          Verification failed{a.status_reason ? `: ${a.status_reason}` : ""}. Add a new account or upload better proof.
        </Notice>
      )}
    </Card>
  );
}

function PendingChange({ change, onChanged }: { change: MyBankChange; onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancel = async () => {
    const ok = await confirm({
      title: "Cancel this bank change?",
      message: "The new account won't be used. Your salary keeps going to your current account.",
      confirmLabel: "Cancel the change",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await meApi.cancelBankChange(change.id);
      toast.success("Bank change cancelled.");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-info/40 p-5">
      <ConflictBanner error={error} onReload={onChanged} className="mb-3" />
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{change.kind === "REPLACE" ? "Changing your salary account" : "Adding a salary account"}</p>
        <MeChip vocabulary="bank_change" code={change.status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        New: {change.after.bank_name ?? "Bank account"} <bdi dir="ltr" className="font-mono">{change.after.account_masked}</bdi>
        {change.before.length > 0 && (
          <>
            {" "}
            · replaces <bdi dir="ltr" className="font-mono">{change.before.map((b) => b.account_masked).join(", ")}</bdi>
          </>
        )}
        {change.created_at && <> · requested {fmtDate(change.created_at)}</>}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Your salary keeps going to your current account until HR approves the change and its waiting period has passed.</p>
      {!!error && !(error instanceof ApiError && error.status === 409) && <p role="alert" className="mt-2 text-sm text-danger">{error instanceof ApiError ? error.message : "Couldn't cancel. Try again."}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton href={`/me/bank-accounts/${change.bank_account_id}`}>Details</LinkButton>
        <Button variant="ghost" className="min-h-[44px] text-danger" loading={busy} onClick={cancel}>
          Cancel change
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ account page */

/** One account (full page): details, verification, proof upload, and removing it from use. */
export function MyBankAccountPage({ id }: { id: string }) {
  const { me } = useCan();
  const canEdit = canSelf(me, P.PAYROLL_BANK_DETAILS_EDIT);
  const { data, error, loading, reload } = useApi(() => meApi.bankAccount(id), [id]);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const now = useNow();
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Bank account" backHref="/me/bank-accounts" backLabel="Back to My Bank Accounts">
      {data && (
        <div className="mx-auto max-w-3xl">
          <Link href="/me/bank-accounts" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Bank Accounts
          </Link>
          <MeHeader
            hideAmounts={false}
            title={
              <span>
                {data.bank_name ?? "Bank account"} <bdi dir="ltr" className="font-mono">{data.account_masked}</bdi>
              </span>
            }
            description={`${data.holder_name} · ${countryName(data.country)} · ${data.currency}`}
          />
          <AccountCard account={data} now={now} />
          <Card className="mt-4 p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {Object.entries(data.routing).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k.replace(/_/g, " ").toUpperCase()}</dt>
                  <dd className="font-mono">
                    <bdi dir="ltr">{v}</bdi>
                  </dd>
                </div>
              ))}
              {data.branch_name && (
                <>
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd>{data.branch_name}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Verified</dt>
              <dd>{data.verified_at ? `${fmtDateTime(data.verified_at)}${data.verification_method ? ` · ${data.verification_method.replace(/_/g, " ").toLowerCase()}` : ""}` : "Not yet"}</dd>
              {data.effective_from && (
                <>
                  <dt className="text-muted-foreground">In use since</dt>
                  <dd>{fmtDate(data.effective_from)}</dd>
                </>
              )}
              {data.ended_at && (
                <>
                  <dt className="text-muted-foreground">Ended</dt>
                  <dd>{fmtDateTime(data.ended_at)}</dd>
                </>
              )}
            </dl>
          </Card>
          {canEdit && data.status !== "INACTIVE" && (
            <Card className="mt-4 p-5">
              <h2 className="text-sm font-semibold">Proof of account</h2>
              <p className="mt-1 text-sm text-muted-foreground">Upload a cancelled cheque, statement or bank letter if HR asked for one.</p>
              <div className="mt-3">
                <FileDropzone
                  accept={[".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"]}
                  maxBytes={10 * 1024 * 1024}
                  label="Upload proof"
                  upload={async (file, onProgress) => {
                    setUploadError(null);
                    try {
                      await meApi.addBankEvidence(data.id, file, onProgress);
                      toast.success("Proof uploaded. HR will review it.");
                      void reload();
                    } catch (err) {
                      setUploadError(err instanceof ApiError ? err.message : "The upload failed. Try again.");
                      throw err;
                    }
                  }}
                />
                {uploadError && (
                  <p role="alert" className="mt-2 flex items-center gap-1 text-sm text-danger">
                    <Upload className="h-4 w-4" aria-hidden /> {uploadError}
                  </p>
                )}
              </div>
              {data.status === "ACTIVE" && (
                <div className="mt-5 border-t border-border pt-4">
                  <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setRemoveOpen(true)}>
                    Stop using this account
                  </Button>
                </div>
              )}
            </Card>
          )}
          <DeactivateModal account={data} open={removeOpen} onOpenChange={setRemoveOpen} onDone={reload} />
        </div>
      )}
    </DetailGate>
  );
}

function DeactivateModal({ account, open, onOpenChange, onDone }: { account: MyBankAccount; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setReasonError(undefined);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError("Say why, for example: account closed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await meApi.deactivateBankAccount(account.id, reason.trim(), account.row_version);
      toast.success("The account is no longer used for salary.");
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Stop using this account?"
      description="No more salary goes here. If it was your only account, your next payment is held until you add a new one."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button type="submit" form="deactivate-bank" variant="danger" className="min-h-[44px]" loading={busy}>
            Stop using it
          </Button>
        </>
      }
    >
      <form id="deactivate-bank" onSubmit={submit} className="space-y-3" noValidate>
        <ConflictBanner
          error={error}
          onReload={() => {
            onOpenChange(false);
            onDone();
          }}
        />
        <ErrorSummary error={error} fields={fieldErrors(error)} />
        <Field label="Reason" required error={reasonError}>
          <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ add page */

/** Full page of the Add bank account modal (D-12 parity). */
export function AddBankAccountPage() {
  const router = useRouter();
  const { me } = useCan();
  const accounts = useApi(() => meApi.bankAccounts(), []);
  const currencyHint = useApi(() => meApi.claimTypes(), [], { enabled: !!me?.employee });
  if (!canSelf(me, P.PAYROLL_BANK_DETAILS_EDIT)) {
    return (
      <Card className="mx-auto mt-10 max-w-lg">
        <EmptyState icon={<Landmark />} title="You can't change bank details here" description="Ask HR to update your bank account." />
      </Card>
    );
  }
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/me/bank-accounts" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Bank Accounts
      </Link>
      <MeHeader title="Add bank account" description="Where your salary should be paid." hideAmounts={false} />
      <Card className="p-5">
        {accounts.loading && !accounts.data ? (
          <Skeleton className="h-40 w-full" />
        ) : accounts.error && !accounts.data ? (
          <ErrorState message={accounts.error.message} onRetry={accounts.reload} />
        ) : (
          <AddBankAccountWizard
            accounts={accounts.data?.items ?? []}
            defaultCurrency={currencyHint.data?.currency}
            onCancel={() => router.push("/me/bank-accounts")}
            onDone={() => router.push("/me/bank-accounts")}
          />
        )}
      </Card>
    </div>
  );
}
