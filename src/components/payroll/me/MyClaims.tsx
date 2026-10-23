"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Download, Paperclip, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { FileDropzone } from "@/components/payroll/FileDropzone";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { compareDecimalStrings, formatMoneyDto, parseMoneyInput } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { meApi, saveFile } from "./api";
import { canSelf, ConflictBanner, DetailGate, ErrorSummary, fieldErrors, LoansClaimsNav, MeHeader, Notice, useCloseWhenClean } from "./shared";
import type { ClaimTypeDto, ClaimTypesResponse } from "./types";

const RECEIPT_TYPES = [".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"];
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** My Claims (3.8 §5.18): submit expense claims with receipts and track them to payment. */
export function MyClaims() {
  const { me } = useCan();
  const reduceMotion = useReducedMotion();
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("new-claim", { keys: [], dirty });
  const finish = useCloseWhenClean(dirty, setDirty, route.close);
  const { data, error, loading, reload } = useApi(() => meApi.claims(), []);
  const canSubmit = canSelf(me, P.PAYROLL_REIMBURSEMENTS_READ) || canSelf(me, P.PAYROLL_REIMBURSEMENTS_MANAGE);
  const items = data?.items;

  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader
        title="My Claims"
        description="Expense claims your employer pays back with your salary."
        actions={
          canSubmit && (
            <Button className="min-h-[44px]" onClick={() => route.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> New claim
            </Button>
          )
        }
      />
      <LoansClaimsNav />
      {error && !items ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : loading && !items ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : !items?.length ? (
        <Card>
          <EmptyState
            icon={<Receipt />}
            title="No claims yet"
            description="Spent money for work? Submit a claim with the receipt and it's paid back with your salary once approved."
            action={
              canSubmit && (
                <Button className="min-h-[44px]" onClick={() => route.openModal()}>
                  Submit a claim
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Claims">
          {items.map((c, i) => (
            <motion.li key={c.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.05 }}>
              <Card className="p-0">
                <Link href={`/me/claims/${c.id}`} className="block rounded-2xl p-5 hover:bg-surface-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.claim_type_name ?? c.claim_type}</p>
                    <StatusChip vocabulary="claim" code={c.status} />
                    <span className="ms-auto">
                      <MoneyText money={c.amount} emphasis />
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fmtDate(c.expense_date)}
                    {c.merchant ? ` · ${c.merchant}` : ""} · {c.receipts.length} {c.receipts.length === 1 ? "receipt" : "receipts"}
                  </p>
                </Link>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
      {canSubmit && (
        <Modal
          open={route.open}
          onOpenChange={route.onOpenChange}
          size="md"
          title="New claim"
          description="Policy limits for the type you choose are shown as you type."
        >
          {route.open && (
            <ClaimForm
              onDirtyChange={setDirty}
              onCancel={() => route.onOpenChange(false)}
              fullPageHref="/me/claims/new"
              onDone={(_id, failed) => {
                finish();
                void reload();
                toast.success(failed ? "Claim submitted. Some receipts didn't upload: open the claim to add them." : "Claim submitted for approval.");
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ claim form */

function limitLines(t: ClaimTypeDto): string[] {
  const out: string[] = [];
  if (t.limit_per_claim) out.push(`Up to ${formatMoneyDto(t.limit_per_claim)} per claim`);
  if (t.limit_per_month) out.push(`${formatMoneyDto(t.limit_per_month)} per month`);
  if (t.limit_per_year) out.push(`${formatMoneyDto(t.limit_per_year)} per year`);
  if (t.receipt_required_above) out.push(`Receipt needed above ${formatMoneyDto(t.receipt_required_above)}`);
  return out;
}

/** New claim (3.8 §6, `md`): type from the policy with its limits shown live, amount, date, receipts. */
export function ClaimForm({
  onDone,
  onCancel,
  onDirtyChange,
  fullPageHref,
}: {
  onDone: (id: number | null, receiptsFailed: boolean) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  fullPageHref?: string;
}) {
  const types = useApi(() => meApi.claimTypes(), []);
  const limits = useApi(() => meApi.uploadLimits(), []);
  const [type, setType] = useState("");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !!(type || amount || merchant || description || files.length);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const policy: ClaimTypesResponse | undefined = types.data;
  const currency = policy?.currency ?? "";
  const chosen = policy?.claim_types.find((t) => t.code === type);
  const parsed = amount ? parseMoneyInput(amount, currency) : null;
  const overLimit = useMemo(() => {
    if (!chosen?.limit_per_claim || !parsed?.ok || chosen.limit_per_claim.currency !== currency) return false;
    return compareDecimalStrings(parsed.amount, chosen.limit_per_claim.amount) > 0;
  }, [chosen, parsed, currency]);
  const receiptNeeded = useMemo(() => {
    if (!chosen?.receipt_required_above || !parsed?.ok || chosen.receipt_required_above.currency !== currency) return false;
    return compareDecimalStrings(parsed.amount, chosen.receipt_required_above.amount) > 0;
  }, [chosen, parsed, currency]);
  const kind = limits.data?.kinds.claim_receipt;
  const maxFiles = kind?.max_files ?? 10;

  if (types.error && !types.data) return <ErrorState message={types.error.message} onRetry={types.reload} />;
  if (types.loading && !types.data) return <Skeleton className="h-48 w-full" />;
  if (policy && (!policy.enabled || policy.claim_types.length === 0)) {
    return (
      <Notice tone="info" title={!policy.enabled ? "Claims aren't switched on for you" : "No claim types apply to you"}>
        {policy.reason ?? "Your employer's reimbursement policy doesn't offer claims to you right now. Ask HR if you expected to claim."}
      </Notice>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!type) next.claim_type = "Choose what the expense was for.";
    if (!date) next.expense_date = "Enter the date of the expense.";
    else if (date > todayISO()) next.expense_date = "The expense date can't be in the future.";
    if (!parsed) next.amount = "Enter the amount.";
    else if (!parsed.ok) next.amount = parsed.message;
    else if (/^0*(\.0*)?$/.test(parsed.amount)) next.amount = "The amount must be greater than zero.";
    else if (overLimit) next.amount = `This is more than the ${formatMoneyDto(chosen!.limit_per_claim)} limit per claim.`;
    if (receiptNeeded && files.length === 0) next.receipts = "Attach the receipt: it's required for this amount.";
    setErrors(next);
    if (Object.keys(next).length || !parsed?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await meApi.submitClaim({ claim_type: type, expense_date: date, amount: { amount: parsed.amount, currency }, merchant: merchant.trim() || null, description: description.trim() || null });
      let failed = false;
      for (const file of files) {
        try {
          await meApi.addReceipt(result.id, file);
        } catch {
          failed = true;
        }
      }
      onDone(result.id, failed);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <ConflictBanner error={error} />
      <ErrorSummary error={error} fields={{ ...fieldErrors(error) }} />
      <Field label="Type" required error={errors.claim_type}>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="min-h-[44px]">
          <option value="">Choose a type</option>
          {(policy?.claim_types ?? []).map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      {chosen && limitLines(chosen).length > 0 && (
        <div className="rounded-xl bg-info-soft px-4 py-3 text-sm" aria-live="polite">
          <p className="font-medium">Your policy for {chosen.name}</p>
          <ul className="mt-1 list-disc ps-5 text-muted-foreground">
            {limitLines(chosen).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {policy?.submission_window_days ? <p className="mt-1 text-muted-foreground">Claim within {policy.submission_window_days} days of the expense.</p> : null}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of expense" required error={errors.expense_date}>
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="min-h-[44px]" />
        </Field>
        <Field label={`Amount${currency ? ` (${currency})` : ""}`} required error={errors.amount ?? (overLimit ? `Above the ${formatMoneyDto(chosen!.limit_per_claim)} limit per claim.` : undefined)}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="min-h-[44px]" aria-invalid={overLimit || !!errors.amount} />
        </Field>
      </div>
      <Field label="Merchant (optional)">
        <Input value={merchant} maxLength={200} onChange={(e) => setMerchant(e.target.value)} className="min-h-[44px]" />
      </Field>
      <Field label="Description (optional)">
        <Textarea rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div>
        <FileDropzone
          accept={RECEIPT_TYPES}
          maxBytes={kind?.max_bytes ?? limits.data?.max_upload_bytes ?? DEFAULT_MAX_BYTES}
          multiple
          label={receiptNeeded ? "Receipts (required for this amount)" : "Receipts"}
          hint={`PDF, PNG or JPEG; up to ${maxFiles} files.`}
          onFiles={(list) => setFiles((prev) => [...prev, ...list].slice(0, maxFiles))}
        />
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {errors.receipts && (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {errors.receipts}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {fullPageHref && (
          <Link href={fullPageHref} className="me-auto inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium hover:bg-surface-muted">
            Open full page ↗
          </Link>
        )}
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-[44px]" loading={busy}>
          Submit claim
        </Button>
      </div>
    </form>
  );
}

/** Full page of the New claim modal (D-12 parity). */
export function NewClaimPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/me/claims" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Claims
      </Link>
      <MeHeader title="New claim" description="Policy limits for the type you choose are shown as you type." />
      <Card className="p-5">
        <ClaimForm
          onCancel={() => router.push("/me/claims")}
          onDone={(id, failed) => {
            toast.success(failed ? "Claim submitted. Some receipts didn't upload: add them here." : "Claim submitted for approval.");
            router.push(id ? `/me/claims/${id}` : "/me/claims");
          }}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

/** One claim: amounts claimed / approved / paid, flags, receipts (download, add), withdraw while pending. */
export function MyClaimPage({ id }: { id: string }) {
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(() => meApi.claim(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const withdraw = async () => {
    if (!data) return;
    const ok = await confirm({ title: "Withdraw this claim?", message: "It won't be paid. You can submit a new claim later.", confirmLabel: "Withdraw", tone: "danger" });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      await meApi.withdrawClaim(data.id);
      toast.success("Claim withdrawn.");
      void reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Claim" backHref="/me/claims" backLabel="Back to My Claims">
      {data && (
        <div className="mx-auto max-w-3xl">
          <Link href="/me/claims" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Claims
          </Link>
          <MeHeader
            title={`${data.claim_type_name ?? data.claim_type} · ${fmtDate(data.expense_date)}`}
            description={<StatusChip vocabulary="claim" code={data.status} />}
            actions={
              data.status === "SUBMITTED" && (
                <Button variant="ghost" className="min-h-[44px] text-danger" loading={busy} onClick={withdraw}>
                  Withdraw
                </Button>
              )
            }
          />
          <ConflictBanner error={actionError} onReload={reload} className="mb-4" />
          {!!actionError && !(actionError instanceof ApiError && actionError.status === 409) && (
            <p role="alert" className="mb-4 text-sm text-danger">
              {actionError instanceof ApiError ? actionError.message : "Something went wrong."}
            </p>
          )}
          {data.status_reason && (
            <Notice tone={data.status === "REJECTED" ? "danger" : "info"} title={data.status === "REJECTED" ? "Not approved" : "Note"} className="mb-4">
              {data.status_reason}
            </Notice>
          )}
          <Card className="p-5">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Claimed</dt>
                <dd className="text-lg font-semibold">
                  <MoneyText money={data.amount} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Approved</dt>
                <dd className="text-lg font-semibold">
                  <MoneyText money={data.approved} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{data.status === "PAID" ? "Paid with salary" : "To be paid"}</dt>
                <dd className="text-lg font-semibold">
                  <MoneyText money={data.payout} />
                </dd>
              </div>
            </dl>
            {data.fx_conversion?.explanation && <p className="mt-2 text-xs text-muted-foreground">{data.fx_conversion.explanation}</p>}
            {(data.merchant || data.description) && (
              <p className="mt-3 text-sm text-muted-foreground">
                {data.merchant}
                {data.merchant && data.description ? " · " : ""}
                {data.description}
              </p>
            )}
            {data.flags.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-warning">
                {data.flags.map((f) => (
                  <li key={f.code}>• {f.message ?? f.code}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="mt-4 p-5">
            <h2 className="text-sm font-semibold">Receipts</h2>
            {data.receipts.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No receipts attached.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {data.receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.file_name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[44px]"
                      aria-label={`Download ${r.file_name}`}
                      onClick={() => saveFile(meApi.receiptUrl(data.id, r.id), r.file_name).catch((err) => toast.error(err instanceof ApiError ? err.message : "Download failed."))}
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {data.status === "SUBMITTED" && (
              <div className="mt-3">
                <FileDropzone
                  accept={RECEIPT_TYPES}
                  maxBytes={DEFAULT_MAX_BYTES}
                  label="Add a receipt"
                  upload={async (file, onProgress) => {
                    await meApi.addReceipt(data.id, file, onProgress);
                    void reload();
                  }}
                />
              </div>
            )}
          </Card>
        </div>
      )}
    </DetailGate>
  );
}
