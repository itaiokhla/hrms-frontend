"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Coins, Download, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { compareDecimalStrings, formatMoney, parseMoneyInput } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { downloadDocument, meApi } from "./api";
import { canSelf, ConflictBanner, DetailGate, ErrorSummary, fieldErrors, LoansClaimsNav, MeHeader, Notice, useCloseWhenClean } from "./shared";
import type { Loan, LoanPolicyPreview } from "./types";

const KIND_LABEL: Record<string, string> = { LOAN: "Loan", ADVANCE: "Salary advance" };
const TX_LABEL: Record<string, string> = {
  DISBURSEMENT: "Paid out to you",
  INSTALMENT: "Instalment recovered from salary",
  PREPAYMENT: "Prepayment",
  WAIVER: "Waived",
  ADJUSTMENT: "Adjustment",
};

export interface LoanPolicyState {
  preview: LoanPolicyPreview | undefined;
  loading: boolean;
  /** The preview could not be read: the form falls back to the server's answer when applying. */
  failed: boolean;
}

/** GET /me/payroll/loan-policy: the limits that apply to the caller today and their own usage. */
function useLoanPolicy(): LoanPolicyState {
  const { me } = useCan();
  const enabled = canSelf(me, P.PAYROLL_LOANS_READ) || canSelf(me, P.PAYROLL_LOANS_MANAGE);
  const { data, error, loading } = useApi(() => meApi.loanPolicy(), [me?.employee?.id], { enabled });
  return { preview: data, loading: enabled && loading && !data, failed: !!error };
}

/**
 * The currency of new applications: the policy preview's (the employee's pay group currency); without
 * it the claim-types hint, an earlier loan, or the company currency.
 */
function usePayCurrency(policy: LoanPolicyState, loans?: Loan[]): string {
  const { me } = useCan();
  const hint = useApi(() => meApi.claimTypes(), [], { enabled: !!me?.employee && !policy.loading && !policy.preview });
  return policy.preview?.currency ?? hint.data?.currency ?? loans?.[0]?.currency ?? me?.company.currency ?? "";
}

/** My Loans & Advances (3.8 §5.18): apply, track, schedules and balances. */
export function MyLoans() {
  const { me } = useCan();
  const reduceMotion = useReducedMotion();
  const [dirty, setDirty] = useState(false);
  const apply = useModalRoute("new-loan", { keys: [], dirty });
  const finish = useCloseWhenClean(dirty, setDirty, apply.close);
  const { data, error, loading, reload } = useApi(() => meApi.loans(), []);
  const policy = useLoanPolicy();
  const currency = usePayCurrency(policy, data?.items);
  const canApply = canSelf(me, P.PAYROLL_LOANS_READ) || canSelf(me, P.PAYROLL_LOANS_MANAGE);
  const items = data?.items;

  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader
        title="My Loans"
        description="Loans and salary advances from your employer, repaid from your salary."
        actions={
          canApply && (
            <Button className="min-h-[44px]" onClick={() => apply.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> Apply
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
            icon={<Coins />}
            title="No loans or advances"
            description="If your employer offers them, you can apply here. Your policy's limits are checked when you apply."
            action={
              canApply && (
                <Button className="min-h-[44px]" onClick={() => apply.openModal()}>
                  Apply for a loan or advance
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Loans and advances">
          {items.map((loan, i) => (
            <motion.li key={loan.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.05 }}>
              <Card className="p-0">
                <Link href={`/me/loans/${loan.id}`} className="block rounded-2xl p-5 hover:bg-surface-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{KIND_LABEL[loan.kind] ?? loan.kind}</p>
                    <StatusChip vocabulary="loan" code={loan.status} />
                    <span className="ms-auto text-end">
                      <MoneyText money={loan.principal} emphasis />
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Balance <MoneyText money={loan.balance} />
                    {loan.tenure ? ` · ${loan.tenure} ${loan.kind === "ADVANCE" ? "pay runs" : "months"}` : ""}
                    {loan.purpose ? ` · ${loan.purpose}` : ""}
                  </p>
                </Link>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
      {canApply && (
        <NewLoanModal
          open={apply.open}
          onOpenChange={apply.onOpenChange}
          currency={currency}
          policy={policy}
          onDirtyChange={setDirty}
          onDone={(id) => {
            finish();
            void reload();
            if (id) toast.success("Application sent for approval. You'll be notified of the decision.");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ apply */

export interface LoanFormProps {
  currency: string;
  /** The live limits (GET /me/payroll/loan-policy); without them the server's refusal explains. */
  policy?: LoanPolicyState;
  onDone: (id: number | null) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** id of the form element (the modal puts the submit button in its footer). */
  formId?: string;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * New loan / advance (3.8 §6, `lg`). The limits that apply today come from the policy preview (the same
 * figures `apply_loan` checks): the maximum amount (only when the server could compute it from known pay),
 * the term, interest, service length and open loans, with the person's own usage. The amount and term
 * are checked against them as the person types; the server still has the final say and its exact
 * reasons are shown if it refuses.
 */
export function LoanForm({ currency, policy, onDone, onCancel, onDirtyChange, formId = "new-loan", onBusyChange }: LoanFormProps) {
  const [kind, setKind] = useState("LOAN");
  const [amount, setAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !!(amount || tenure || purpose);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  // A submitted error goes once the field changes; the live policy checks take over from there.
  const clearError = (field: string) =>
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  const preview = policy?.preview;
  const kindPolicy = preview ? (kind === "ADVANCE" ? preview.advance : preview.loan) : undefined;
  const usable = !kindPolicy || (kindPolicy.enabled && kindPolicy.policy_status === "RESOLVED");
  const maxAmount = kindPolicy?.limits?.max_amount ?? null;
  const maxTenure = kind === "LOAN" ? preview?.loan.limits?.max_tenure_months ?? null : null;

  // Live checks against the policy (only what the preview actually states).
  const live = useMemo(() => {
    const out: Record<string, string> = {};
    const parsed = amount.trim() && currency ? parseMoneyInput(amount, currency) : null;
    if (parsed?.ok && maxAmount && maxAmount.currency === currency && compareDecimalStrings(parsed.amount, maxAmount.amount) > 0) {
      out.amount = `The most you can apply for is ${formatMoney(maxAmount.amount, maxAmount.currency)}.`;
    }
    if (maxTenure && /^\d+$/.test(tenure) && Number(tenure) > maxTenure) out.tenure = `Your policy allows at most ${maxTenure} months.`;
    return out;
  }, [amount, currency, maxAmount, tenure, maxTenure]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const parsed = parseMoneyInput(amount, currency);
    if (!currency) next.amount = "Your pay currency isn't known yet. Ask HR.";
    else if (!parsed.ok) next.amount = parsed.message;
    else if (/^0*(\.0*)?$/.test(parsed.amount)) next.amount = "The amount must be greater than zero.";
    else if (live.amount) next.amount = live.amount;
    if (tenure && (!/^\d+$/.test(tenure) || Number(tenure) < 1 || Number(tenure) > 600)) next.tenure = "Enter a whole number from 1 to 600.";
    else if (live.tenure) next.tenure = live.tenure;
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok || !usable) return;
    setBusy(true);
    setError(null);
    try {
      const result = await meApi.applyLoan({ kind, amount: { amount: parsed.amount, currency }, tenure: tenure ? Number(tenure) : null, purpose: purpose.trim() || null });
      onDone(result.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const policyRefusal = error instanceof ApiError && error.status === 409 && error.code !== "STALE_ROW_VERSION";
  return (
    <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
      {policyRefusal ? (
        <Notice tone="warning" title={(error as ApiError).code === "LOANS_DISABLED" ? "Not offered right now" : (error as ApiError).code === "NO_POLICY" ? "No policy applies to you" : "This doesn't fit your policy"}>
          {(error as ApiError).message}
        </Notice>
      ) : (
        <>
          <ConflictBanner error={error} />
          <ErrorSummary error={error} fields={fieldErrors(error)} />
        </>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What do you need?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { value: "LOAN", label: "Loan", hint: "Repaid in monthly instalments." },
            { value: "ADVANCE", label: "Salary advance", hint: "Part of your salary early, recovered from the next pay runs." },
          ].map((o) => (
            <label key={o.value} className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-2xl border p-3 ${kind === o.value ? "border-primary bg-primary-soft/50" : "border-border"}`}>
              <input type="radio" name="loan-kind" value={o.value} checked={kind === o.value} onChange={() => setKind(o.value)} className="mt-1 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {preview ? (
        <LoanLimits preview={preview} kind={kind} />
      ) : policy?.loading ? (
        <Skeleton className="h-20 w-full rounded-2xl" />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Amount${currency ? ` (${currency})` : ""}`} required error={errors.amount ?? live.amount}>
          <Input value={amount} onChange={(e) => (setAmount(e.target.value), clearError("amount"))} inputMode="decimal" dir="ltr" className="min-h-[44px]" />
        </Field>
        <Field
          label={kind === "ADVANCE" ? "Recover over (pay runs)" : "Repay over (months)"}
          error={errors.tenure ?? live.tenure}
          hint={maxTenure ? `Up to ${maxTenure} months. Leave empty for your policy's standard term.` : "Leave empty for your policy's standard term."}
        >
          <Input value={tenure} onChange={(e) => (setTenure(e.target.value.replace(/[^\d]/g, "")), clearError("tenure"))} inputMode="numeric" dir="ltr" className="min-h-[44px]" />
        </Field>
      </div>
      <Field label="Purpose (optional)">
        <Textarea rows={2} maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">
        {preview
          ? "These limits are your employer's policy today. It is checked again when you apply; if something doesn't fit, you'll see exactly why."
          : "Your employer's policy checks the maximum amount, the term, how long you've worked here and other open loans when you apply. If something doesn't fit, you'll see exactly why."}
      </p>
      {!formId.startsWith("new-loan-modal") && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-[44px]" loading={busy} disabled={!usable}>
            Apply
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * The limits of the chosen kind, from the policy preview: switched off, no policy, or each limit next to
 * the person's own usage. A maximum the server couldn't compute (pay not known) says so instead of a guess.
 */
export function LoanLimits({ preview, kind }: { preview: LoanPolicyPreview; kind: string }) {
  const advance = kind === "ADVANCE";
  const k = advance ? preview.advance : preview.loan;
  const what = advance ? "Salary advances" : "Loans";
  if (!k.enabled) {
    return (
      <Notice tone="warning" title="Not offered right now">
        {what} aren&apos;t available from your employer at the moment.
      </Notice>
    );
  }
  if (k.policy_status !== "RESOLVED" || !k.limits) {
    return (
      <Notice tone="warning" title="No policy applies to you">
        No {advance ? "salary advance" : "loan"} policy covers you today, so you can&apos;t apply yet. Ask HR.
      </Notice>
    );
  }
  const rows: { label: string; value: ReactNode; warn?: string | null }[] = [];
  const max = k.limits.max_amount;
  rows.push({ label: "Maximum amount", value: max ? <MoneyText money={max} hideable={false} /> : "Worked out from your pay when you apply" });
  if (!advance) {
    const l = preview.loan.limits!;
    const u = preview.loan.usage;
    if (l.max_tenure_months) rows.push({ label: "Longest term", value: `${l.max_tenure_months} months` });
    if (l.interest_rate_percent !== null) rows.push({ label: "Interest", value: isZeroPercent(l.interest_rate_percent) ? "None" : `${l.interest_rate_percent}% a year${l.interest_method ? ` (${l.interest_method.toLowerCase().replace(/_/g, " ")})` : ""}` });
    if (l.max_instalment_percent_of_net) rows.push({ label: "Instalment at most", value: `${l.max_instalment_percent_of_net}% of net pay` });
    if (l.min_service_months) {
      const short = u?.service_months !== null && u?.service_months !== undefined && u.service_months < l.min_service_months;
      rows.push({
        label: "Minimum service",
        value: `${l.min_service_months} months${u?.service_months !== null && u?.service_months !== undefined ? ` (you: ${u.service_months})` : ""}`,
        warn: short ? `You need ${l.min_service_months} months of service to apply.` : null,
      });
    }
    if (l.max_active_loans) {
      const full = !!u && u.open >= l.max_active_loans;
      rows.push({ label: "Open loans", value: `${u?.open ?? 0} of ${l.max_active_loans}`, warn: full ? "You already have the most open loans your policy allows." : null });
    }
  } else {
    const l = preview.advance.limits!;
    const u = preview.advance.usage;
    if (l.max_percent_of_monthly_net) rows.push({ label: "Up to", value: `${l.max_percent_of_monthly_net}% of your monthly net pay` });
    if (l.recover_in_runs) rows.push({ label: "Recovered over", value: `${l.recover_in_runs} pay run${l.recover_in_runs === 1 ? "" : "s"}` });
    if (l.max_per_year) {
      const full = !!u && u.this_year >= l.max_per_year;
      rows.push({ label: "Advances this year", value: `${u?.this_year ?? 0} of ${l.max_per_year}`, warn: full ? "You've had the most advances your policy allows this year." : null });
    }
  }
  const warnings = rows.map((r) => r.warn).filter((w): w is string => !!w);
  return (
    <section aria-label="Your limits" className="space-y-2 rounded-2xl border border-border bg-surface-muted/50 p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your limits{k.policy?.name ? ` · ${k.policy.name}` : ""}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
      {preview.protected_net_percent && (
        <p className="text-xs text-muted-foreground">At least {preview.protected_net_percent}% of your net pay is always left after recoveries.</p>
      )}
      {warnings.map((w) => (
        <p key={w} role="alert" className="text-sm font-medium text-warning">
          {w}
        </p>
      ))}
    </section>
  );
}

function isZeroPercent(value: string): boolean {
  return /^0*(\.0*)?$/.test(value.trim());
}

function NewLoanModal({
  open,
  onOpenChange,
  currency,
  policy,
  onDone,
  onDirtyChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currency: string;
  policy?: LoanPolicyState;
  onDone: (id: number | null) => void;
  onDirtyChange?: (d: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Apply for a loan or advance"
      description="Your application goes to the approvers in your company."
      footer={
        <>
          <Link href="/me/loans/new" className="me-auto inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium hover:bg-surface-muted">
            Open full page ↗
          </Link>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-loan-modal" className="min-h-[44px]" loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      {open && <LoanForm formId="new-loan-modal" currency={currency} policy={policy} onDone={onDone} onCancel={() => onOpenChange(false)} onDirtyChange={onDirtyChange} onBusyChange={setBusy} />}
    </Modal>
  );
}

/** Full page of the apply modal (D-12 parity). */
export function NewLoanPage() {
  const router = useRouter();
  const policy = useLoanPolicy();
  const currency = usePayCurrency(policy);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/me/loans" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Loans
      </Link>
      <MeHeader title="Apply for a loan or advance" description="Your application goes to the approvers in your company." />
      <Card className="p-5">
        <LoanForm
          currency={currency}
          policy={policy}
          onCancel={() => router.push("/me/loans")}
          onDone={(id) => {
            toast.success("Application sent for approval. You'll be notified of the decision.");
            router.push(id ? `/me/loans/${id}` : "/me/loans");
          }}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

/** One loan: summary, repayment schedule, ledger and a downloadable statement. */
export function MyLoanPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => meApi.loan(id), [id]);
  const [busy, setBusy] = useState(false);
  const statement = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const doc = await meApi.loanStatement(data.id);
      await downloadDocument(() => meApi.documentLink(doc.id), doc.file_name || `loan-${data.id}.pdf`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The statement couldn't be created. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Loan" backHref="/me/loans" backLabel="Back to My Loans">
      {data && (
        <div className="mx-auto max-w-3xl">
          <Link href="/me/loans" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Loans
          </Link>
          <MeHeader
            title={`${KIND_LABEL[data.kind] ?? data.kind} #${data.id}`}
            description={<StatusChip vocabulary="loan" code={data.status} />}
            actions={
              <Button variant="secondary" className="min-h-[44px]" loading={busy} onClick={statement}>
                <Download className="h-4 w-4" aria-hidden /> Statement
              </Button>
            }
          />
          {data.status_reason && (
            <Notice tone={data.status === "REJECTED" ? "danger" : "info"} title={data.status === "REJECTED" ? "Not approved" : "Note"} className="mb-4">
              {data.status_reason}
            </Notice>
          )}
          <Card className="p-5">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="text-lg font-semibold">
                  <MoneyText money={data.principal} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Still to repay</dt>
                <dd className="text-lg font-semibold">
                  <MoneyText money={data.balance} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Term</dt>
                <dd className="text-lg font-semibold">{data.tenure ? `${data.tenure} ${data.kind === "ADVANCE" ? "pay runs" : "months"}` : "—"}</dd>
              </div>
            </dl>
            {data.disbursed_on && <p className="mt-2 text-sm text-muted-foreground">Paid out on {fmtDate(data.disbursed_on)}</p>}
            {data.application_issues.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {data.application_issues.map((i) => (
                  <li key={i.code}>• {i.message ?? i.code}</li>
                ))}
              </ul>
            )}
          </Card>
          {data.schedule && data.schedule.instalments.length > 0 && (
            <Card className="mt-4 p-5">
              <h2 className="text-sm font-semibold">Repayment schedule</h2>
              {data.schedule.explanation && <p className="mt-1 text-xs text-muted-foreground">{data.schedule.explanation}</p>}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Repayment schedule</caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col" className="py-1 text-start font-medium">#</th>
                      <th scope="col" className="py-1 text-end font-medium">Principal</th>
                      <th scope="col" className="py-1 text-end font-medium">Interest</th>
                      <th scope="col" className="py-1 text-end font-medium">Instalment</th>
                      <th scope="col" className="py-1 text-end font-medium">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schedule.instalments.map((row) => (
                      <tr key={row.number} className="border-t border-border/60">
                        <td className="py-1.5">{row.number}</td>
                        <td className="py-1.5 text-end"><MoneyText amount={row.principal} currency={data.schedule!.currency} /></td>
                        <td className="py-1.5 text-end"><MoneyText amount={row.interest} currency={data.schedule!.currency} /></td>
                        <td className="py-1.5 text-end"><MoneyText amount={row.total} currency={data.schedule!.currency} /></td>
                        <td className="py-1.5 text-end"><MoneyText amount={row.balance_after} currency={data.schedule!.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {(data.transactions?.length ?? 0) > 0 && (
            <Card className="mt-4 p-5">
              <h2 className="mb-3 text-sm font-semibold">History</h2>
              <Timeline
                label="Loan history"
                items={[...(data.transactions ?? [])].reverse().map((t) => ({
                  id: t.id,
                  at: t.effective_on,
                  title: (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {TX_LABEL[t.kind] ?? t.kind} <MoneyText money={t.amount} />
                    </span>
                  ),
                  body: t.note ?? undefined,
                }))}
              />
            </Card>
          )}
        </div>
      )}
    </DetailGate>
  );
}
