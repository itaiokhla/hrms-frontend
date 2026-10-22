"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarClock, ChevronDown, Download, History, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { BreakdownTable } from "@/components/payroll/compensation/BreakdownTable";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { percentChange } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { meApi } from "./api";
import { downloadPayslip } from "./MyPayslips";
import { canSelf, HonestyBadge, isCurrentPayslip, LinkButton, MeChip, MeHeader, Notice, payslipMarkers, SelfServiceLinks, shareOf } from "./shared";
import type { EmployeeCompensation, MyInstruction, MyPaymentPeriod, MyPayslipDetail, PayslipLine } from "./types";

/**
 * My Salary (3.8 §5.17): the latest published payslip as a net-pay hero with gross and deductions,
 * Earnings / Deductions / "Paid by your employer (not in net pay)" expanders, the payment's progress
 * from evidence only, and the current package. Shows only what the API returns for the employee
 * (disclosure policy, contract §22.1): HR-only lines never reach this page.
 */
export function MySalary() {
  const { me } = useCan();
  const canSlips = canSelf(me, P.PAYROLL_PAYSLIP_READ);
  const canPackage = canSelf(me, P.PAYROLL_COMPENSATION_READ);
  const employeeId = me?.employee?.id ?? 0;

  const list = useApi(() => meApi.payslips({ limit: 12 }), [], { enabled: canSlips });
  const latestId = useMemo(() => list.data?.items.find(isCurrentPayslip)?.id ?? null, [list.data]);
  // Opening the latest payslip here counts as viewing it (the breakdown is the payslip itself).
  const latest = useApi(() => meApi.payslip(latestId ?? 0), [latestId], { enabled: canSlips && latestId !== null });
  const payments = useApi(() => meApi.payments(), [], { enabled: canSlips });
  const pkg = useApi(() => meApi.compensation(employeeId), [employeeId], { enabled: canPackage && !!employeeId });

  const period = useMemo<MyPaymentPeriod | undefined>(() => {
    const runId = latest.data?.run_id;
    return runId ? payments.data?.items.find((p) => p.run_id === runId) : undefined;
  }, [latest.data, payments.data]);

  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader title="My Salary" description="Your latest pay, how it adds up, and when it reaches your account." />
      <div className="space-y-5">
        {canSlips && <LatestPay list={list} latest={latest} period={period} />}
        {canPackage && <MyPackage state={pkg} />}
        <SelfServiceLinks />
      </div>
    </div>
  );
}

type ApiState<T> = { data: T | undefined; error: { message: string } | null; loading: boolean; reload: () => unknown };

function LatestPay({ list, latest, period }: { list: ApiState<{ items: { id: number }[] }>; latest: ApiState<MyPayslipDetail>; period?: MyPaymentPeriod }) {
  if (list.error && !list.data) return <Card><ErrorState message={list.error.message} onRetry={list.reload} /></Card>;
  if ((list.loading && !list.data) || (list.data?.items.length && latest.loading && !latest.data)) {
    return (
      <Card className="space-y-3 p-5" aria-busy="true" aria-label="Loading your latest pay">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }
  if (!list.data?.items.length) {
    return (
      <Card>
        <EmptyState
          icon={<Wallet />}
          title="No payslip yet"
          description="Your first payslip appears here once your employer finalizes a pay run that includes you. Meanwhile, check that your bank account is set up."
          action={<LinkButton href="/me/bank-accounts">My bank accounts</LinkButton>}
        />
      </Card>
    );
  }
  if (latest.error && !latest.data) return <Card><ErrorState message={latest.error.message} onRetry={latest.reload} /></Card>;
  const slip = latest.data;
  if (!slip) return null;
  const content = slip.content;
  const markers = payslipMarkers(slip);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {slip.period_label ?? slip.title}
            {markers.includes("REVISED") && <MeChip vocabulary="payslip_marker" code="REVISED" />}
          </p>
          {content && <p className="text-sm text-muted-foreground">{content.payment.text}</p>}
        </div>
        <Button variant="secondary" className="min-h-[44px]" onClick={() => void downloadPayslip(slip)}>
          <Download className="h-4 w-4" aria-hidden /> Download payslip
        </Button>
      </div>
      {markers.includes("REVISED") && (
        <Notice tone="warning" title="Your payslip was revised" className="mt-3">
          A correction replaced the earlier payslip for this period. The figures below are the revised ones.
        </Notice>
      )}
      {content ? (
        <>
          {content.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {content.labels.map((l) => (
                <HonestyBadge key={l}>{l}</HonestyBadge>
              ))}
            </div>
          )}
          <p className="mt-4 text-sm text-muted-foreground">Net pay</p>
          <p className="text-4xl font-semibold tracking-tight">
            <MoneyText amount={content.totals.net} currency={content.currency} />
          </p>
          <GrossBar gross={content.totals.gross} deductions={content.totals.deductions} currency={content.currency} />
          <div className="mt-4 space-y-2">
            <Expander title="Earnings" total={content.totals.gross} currency={content.currency} lines={content.earnings} />
            <Expander title="Deductions" total={content.totals.deductions} currency={content.currency} lines={content.deductions} deduction />
            {content.reimbursements.length > 0 && (
              <Expander title="Reimbursements (paid with your salary)" total={content.totals.reimbursements} currency={content.currency} lines={content.reimbursements} />
            )}
            {(content.employer_contributions?.length ?? 0) > 0 && (
              <Expander title="Paid by your employer (not in net pay)" currency={content.currency} lines={content.employer_contributions ?? []} note={content.employer_note} />
            )}
          </div>
          <PaymentProgress period={period} fallbackText={content.payment.text} bank={content.employee.bank ?? null} />
        </>
      ) : (
        <Notice tone="info" title="This payslip has no web view" className="mt-3">
          Download the PDF to see the breakdown.
        </Notice>
      )}
      <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Your next pay date appears here once your employer publishes the pay calendar.
      </p>
      <div className="mt-3">
        <Link href="/me/payslips" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">
          All payslips
        </Link>
      </div>
    </Card>
  );
}

function GrossBar({ gross, deductions, currency }: { gross: string; deductions: string; currency: string }) {
  const reduceMotion = useReducedMotion();
  const deductionShare = shareOf(deductions, gross);
  const netShare = Math.max(0, 100 - deductionShare);
  return (
    <div className="mt-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-danger-soft" role="img" aria-label={`Take-home is ${netShare.toFixed(1)}% of gross pay; deductions are ${deductionShare.toFixed(1)}%`}>
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${netShare}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          Gross <MoneyText amount={gross} currency={currency} />
        </span>
        <span>
          Deductions <MoneyText amount={deductions} currency={currency} negativeCue={false} />
        </span>
      </p>
    </div>
  );
}

function Expander({ title, total, currency, lines, deduction, note }: { title: string; total?: string; currency: string; lines: PayslipLine[]; deduction?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const id = `exp-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="rounded-2xl border border-border">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-start">
        <span className="flex-1 text-sm font-medium">{title}</span>
        {total !== undefined && <MoneyText amount={total} currency={currency} negativeCue={false} />}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-2">
              {note && <p className="py-1 text-xs text-muted-foreground">{note}</p>}
              <ul>
                {lines.map((l, i) => (
                  <li key={`${l.code}-${i}`} className="flex items-baseline gap-3 py-1.5 text-sm">
                    <span className="flex-1">
                      {l.label}
                      {l.period_ref_label && <span className="text-xs text-muted-foreground"> · for {l.period_ref_label}</span>}
                      {l.fixture && (
                        <span className="ms-2">
                          <HonestyBadge>FIXTURE — not law</HonestyBadge>
                        </span>
                      )}
                    </span>
                    <MoneyText amount={l.amount} currency={currency} negativeCue={deduction ? false : undefined} />
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Step = { key: string; label: string; at: string | null; done: boolean };

/** Scheduled → Processing → Paid, each step lit only by recorded evidence (I-17). */
export function paymentSteps(instruction: MyInstruction | undefined): Step[] {
  const paid = instruction?.label.key === "PAID";
  const processing = !!instruction && (!!instruction.submitted_at || ["PROCESSING", "SUBMITTED_MANUAL_UNVERIFIED", "PARTLY_PAID", "SENT_AGAIN", "PAID"].includes(instruction.label.key));
  return [
    { key: "SCHEDULED", label: "Scheduled", at: null, done: true },
    { key: "PROCESSING", label: instruction?.label.key === "SUBMITTED_MANUAL_UNVERIFIED" ? "Submitted — unverified" : "Processing", at: instruction?.submitted_at ?? null, done: processing },
    { key: "PAID", label: "Paid", at: paid ? instruction?.settled_at ?? instruction?.reconciled_at ?? null : null, done: paid },
  ];
}

function PaymentProgress({ period, fallbackText, bank }: { period?: MyPaymentPeriod; fallbackText: string; bank: string | null }) {
  const instruction = period?.instructions[period.instructions.length - 1];
  const steps = paymentSteps(instruction);
  const problem = instruction && ["FAILED", "ON_HOLD", "REVERSED", "CANCELLED"].includes(instruction.label.key);
  const account = instruction?.beneficiary.account_masked ?? null;
  return (
    <section aria-label="Payment" className="mt-5 rounded-2xl bg-surface-muted/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Payment</h3>
        {instruction && <StatusChip vocabulary="employee_payment" code={instruction.label.key} />}
        {instruction?.sandbox && <HonestyBadge tone="info">SANDBOX — no real money moved</HonestyBadge>}
      </div>
      {problem ? (
        <p className="mt-2 text-sm text-danger">{instruction?.label.text}</p>
      ) : (
        <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Payment progress">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1", s.done ? "bg-primary-soft font-medium text-foreground" : "bg-muted text-muted-foreground")} aria-current={s.done && !steps[i + 1]?.done ? "step" : undefined}>
                {s.label}
                {s.at && <span className="text-xs text-muted-foreground">{fmtDate(s.at)}</span>}
                <span className="sr-only">{s.done ? "(done)" : "(not yet)"}</span>
              </span>
              {i < steps.length - 1 && <span aria-hidden className="text-muted-foreground">→</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-sm text-muted-foreground">
        {instruction ? instruction.label.text : fallbackText}
        {(account || bank) && (
          <>
            {" "}
            · <bdi dir="ltr">{account ? `${instruction?.beneficiary.bank_name ? `${instruction.beneficiary.bank_name} ` : ""}${account}` : bank}</bdi>
          </>
        )}
      </p>
      <Link href="/me/payments" className="mt-1 inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">
        Payment history
      </Link>
    </section>
  );
}

function MyPackage({ state }: { state: ApiState<EmployeeCompensation> }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  if (state.error && !state.data) return <Card><ErrorState message={state.error.message} onRetry={state.reload} /></Card>;
  if (state.loading && !state.data) return <Skeleton className="h-32 w-full rounded-2xl" />;
  const data = state.data;
  if (!data) return null;
  const current = data.current;
  const ctc = data.breakdown?.totals.ctc?.annual ?? null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">My package</h2>
          {current ? (
            <p className="text-sm text-muted-foreground">
              {current.structure.name} · since {fmtDate(current.effective_from)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No salary is set up for you yet. HR assigns it before your first pay run.</p>
          )}
        </div>
        {data.history.length > 0 && (
          <Button variant="ghost" className="min-h-[44px]" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <History className="h-4 w-4" aria-hidden /> History
          </Button>
        )}
      </div>
      {current && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {ctc && (
            <Figure label={<abbr title="Cost to company: everything your employer spends on your pay in a year">CTC (annual)</abbr>}>
              <MoneyText money={ctc} emphasis />
            </Figure>
          )}
          <Figure label="Pay basis">
            <MoneyText money={current.pay_basis_amount} emphasis />
          </Figure>
        </dl>
      )}
      {data.scheduled.length > 0 && (
        <Notice tone="info" title="A change is scheduled" className="mt-3">
          From {fmtDate(data.scheduled[0].effective_from)} your pay basis becomes <MoneyText money={data.scheduled[0].pay_basis_amount} />.
        </Notice>
      )}
      {data.breakdown && (
        <div className="mt-3">
          <Button variant="ghost" className="min-h-[44px]" aria-expanded={showBreakdown} onClick={() => setShowBreakdown(!showBreakdown)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showBreakdown && "rotate-180")} aria-hidden /> {showBreakdown ? "Hide breakdown" : "Show monthly breakdown"}
          </Button>
          {showBreakdown && (
            <div className="mt-2 overflow-x-auto">
              <BreakdownTable breakdown={data.breakdown} period="monthly" caption="My monthly salary breakdown" />
            </div>
          )}
        </div>
      )}
      {showHistory && (
        <div className="mt-4">
          <Timeline
            label="Salary history"
            items={data.history.map((h) => ({
              id: h.id,
              at: h.effective_from,
              title: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <MoneyText money={h.pay_basis_amount} /> · {h.structure.name}
                  <StatusChip vocabulary="compensation" code={h.status} />
                </span>
              ),
              body: h.change?.change_pct ? <span>{percentChange(h.change.change_pct).text} from the previous salary</span> : undefined,
            }))}
          />
        </div>
      )}
    </Card>
  );
}

function Figure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-muted/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg">{children}</dd>
    </div>
  );
}
