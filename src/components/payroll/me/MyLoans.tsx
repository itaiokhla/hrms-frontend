"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Coins, Download, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
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
import { parseMoneyInput } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { downloadDocument, meApi } from "./api";
import { canSelf, ConflictBanner, DetailGate, ErrorSummary, fieldErrors, LoansClaimsNav, MeHeader, Notice, useCloseWhenClean } from "./shared";
import type { Loan } from "./types";

const KIND_LABEL: Record<string, string> = { LOAN: "Loan", ADVANCE: "Salary advance" };
const TX_LABEL: Record<string, string> = {
  DISBURSEMENT: "Paid out to you",
  INSTALMENT: "Instalment recovered from salary",
  PREPAYMENT: "Prepayment",
  WAIVER: "Waived",
  ADJUSTMENT: "Adjustment",
};

/** The pay group currency for new applications: from the claim-types response, an earlier loan, or the company. */
function usePayCurrency(loans?: Loan[]): string {
  const { me } = useCan();
  const hint = useApi(() => meApi.claimTypes(), [], { enabled: !!me?.employee });
  return hint.data?.currency ?? loans?.[0]?.currency ?? me?.company.currency ?? "";
}

/** My Loans & Advances (3.8 §5.18): apply, track, schedules and balances. */
export function MyLoans() {
  const { me } = useCan();
  const reduceMotion = useReducedMotion();
  const [dirty, setDirty] = useState(false);
  const apply = useModalRoute("new-loan", { keys: [], dirty });
  const finish = useCloseWhenClean(dirty, setDirty, apply.close);
  const { data, error, loading, reload } = useApi(() => meApi.loans(), []);
  const currency = usePayCurrency(data?.items);
  const canApply = canSelf(me, P.PAYROLL_LOANS_READ) || canSelf(me, P.PAYROLL_LOANS_MANAGE);
  const items = data?.items;

  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader
        title="My Loans & Claims"
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
  onDone: (id: number | null) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** id of the form element (the modal puts the submit button in its footer). */
  formId?: string;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * New loan / advance (3.8 §6, `lg`). The API offers no limits preview for employees yet, so the
 * policy check (maximum, tenure, service length, open loans) is shown when the server answers, with
 * its exact reasons; nothing is guessed in the browser.
 */
export function LoanForm({ currency, onDone, onCancel, onDirtyChange, formId = "new-loan", onBusyChange }: LoanFormProps) {
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const parsed = parseMoneyInput(amount, currency);
    if (!currency) next.amount = "Your pay currency isn't known yet. Ask HR.";
    else if (!parsed.ok) next.amount = parsed.message;
    else if (/^0*(\.0*)?$/.test(parsed.amount)) next.amount = "The amount must be greater than zero.";
    if (tenure && (!/^\d+$/.test(tenure) || Number(tenure) < 1 || Number(tenure) > 600)) next.tenure = "Enter a whole number from 1 to 600.";
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok) return;
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Amount${currency ? ` (${currency})` : ""}`} required error={errors.amount}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="min-h-[44px]" />
        </Field>
        <Field label={kind === "ADVANCE" ? "Recover over (pay runs)" : "Repay over (months)"} error={errors.tenure} hint="Leave empty for your policy's standard term.">
          <Input value={tenure} onChange={(e) => setTenure(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" dir="ltr" className="min-h-[44px]" />
        </Field>
      </div>
      <Field label="Purpose (optional)">
        <Textarea rows={2} maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Your employer&apos;s policy checks the maximum amount, the term, how long you&apos;ve worked here and other open loans when you apply. If something doesn&apos;t fit, you&apos;ll see exactly why.
      </p>
      {!formId.startsWith("new-loan-modal") && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-[44px]" loading={busy}>
            Apply
          </Button>
        </div>
      )}
    </form>
  );
}

function NewLoanModal({ open, onOpenChange, currency, onDone, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; currency: string; onDone: (id: number | null) => void; onDirtyChange?: (d: boolean) => void }) {
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
      {open && <LoanForm formId="new-loan-modal" currency={currency} onDone={onDone} onCancel={() => onOpenChange(false)} onDirtyChange={onDirtyChange} onBusyChange={setBusy} />}
    </Modal>
  );
}

/** Full page of the apply modal (D-12 parity). */
export function NewLoanPage() {
  const router = useRouter();
  const currency = usePayCurrency();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/me/loans" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> My Loans
      </Link>
      <MeHeader title="Apply for a loan or advance" description="Your application goes to the approvers in your company." />
      <Card className="p-5">
        <LoanForm
          currency={currency}
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
