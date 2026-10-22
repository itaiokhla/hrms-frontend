"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Banknote, Download, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isZero } from "@/lib/money";
import { statusEntry } from "@/lib/payroll/labels";

import { meApi } from "./api";
import { DocumentRow, downloadPayslip } from "./MyPayslips";
import { HonestyBadge, isCurrentPayslip, LinkButton, MeHeader } from "./shared";
import type { MyInstruction, MyPaymentPeriod, MyPayslip, PayDocumentDto } from "./types";

/**
 * My Payments (3.8 §5.18, 3.7 §11.1): per pay period what is owed and each payment with the
 * employee's label from evidence ("Paid on …" only after verified settlement; "Submitted for manual
 * payment — unverified" otherwise), the masked account and the timeline of recorded steps. Payment
 * advices and payslips of the period download from here.
 */
export function MyPayments() {
  const reduceMotion = useReducedMotion();
  const [year, setYear] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi(() => meApi.payments(year), [year]);
  const payslips = useApi(() => meApi.payslips({ year, limit: 120 }), [year]);
  const advices = useApi(() => meApi.documents({ doc_type: "PAYMENT_ADVICE", limit: 200 }), []);
  const [years, setYears] = useState<number[]>([]);
  // The year list comes from the unfiltered response; keep it while a year is selected.
  useEffect(() => {
    if (data && year === null) setYears(data.years);
  }, [data, year]);

  const slipByRun = useMemo(() => {
    const map = new Map<number, MyPayslip>();
    (payslips.data?.items ?? []).filter(isCurrentPayslip).forEach((p) => {
      if (p.run_id !== null && !map.has(p.run_id)) map.set(p.run_id, p);
    });
    return map;
  }, [payslips.data]);
  const advicesByRun = useMemo(() => {
    const map = new Map<number, PayDocumentDto[]>();
    (advices.data?.items ?? []).forEach((d) => {
      if (d.run_id === null) return;
      map.set(d.run_id, [...(map.get(d.run_id) ?? []), d]);
    });
    return map;
  }, [advices.data]);

  const items = data?.items;
  return (
    <div>
      <MeHeader title="My Payments" description="When and how each salary payment reached you. A payment shows as paid only after the bank confirms it." />
      {(years.length > 0 || year) && (
        <div className="mb-4">
          <Field label="Year" className="w-40">
            <Select value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)} className="min-h-[44px]">
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {error && !items ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : loading && !items ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading payments">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : !items?.length ? (
        <Card>
          <EmptyState
            icon={<Banknote />}
            title={year ? `No payments in ${year}` : "No payments yet"}
            description="Payments appear here once a pay run that includes you is finalized. Make sure your bank account is set up so nothing is held."
            action={<LinkButton href="/me/bank-accounts">My bank accounts</LinkButton>}
          />
        </Card>
      ) : (
        <ol className="space-y-4" aria-label="Payments by period">
          {items.map((period, i) => (
            <motion.li key={period.id} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.05, duration: 0.3 }}>
              <PeriodCard period={period} payslip={period.run_id !== null ? slipByRun.get(period.run_id) : undefined} advices={period.run_id !== null ? advicesByRun.get(period.run_id) ?? [] : []} />
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PeriodCard({ period, payslip, advices }: { period: MyPaymentPeriod; payslip?: MyPayslip; advices: PayDocumentDto[] }) {
  const outstanding = period.outstanding && !isZero(period.outstanding.amount) ? period.outstanding : null;
  const returned = period.returned && !isZero(period.returned.amount) ? period.returned : null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{period.run_label ?? (period.pay_date ? `Pay date ${fmtDate(period.pay_date)}` : `Payment ${period.id}`)}</h2>
          {period.pay_date && <p className="text-sm text-muted-foreground">Pay date {fmtDate(period.pay_date)}</p>}
        </div>
        <div className="text-end">
          <p className="text-xs text-muted-foreground">Net pay owed</p>
          <p className="text-xl font-semibold">
            <MoneyText money={period.amount} />
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Confirmed received</dt>
          <dd className="font-medium">
            <MoneyText money={period.paid_to_date} />
          </dd>
        </div>
        {outstanding && (
          <div>
            <dt className="text-muted-foreground">Still to come</dt>
            <dd className="font-medium">
              <MoneyText money={outstanding} />
            </dd>
          </div>
        )}
        {returned && (
          <div>
            <dt className="text-muted-foreground">Returned by the bank</dt>
            <dd className="font-medium text-danger">
              <MoneyText money={returned} />
            </dd>
          </div>
        )}
      </dl>

      {period.instructions.length === 0 ? (
        <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted-foreground">Scheduled. The payment will be prepared before the pay date.</p>
      ) : (
        <ul className="mt-4 space-y-4" aria-label="Payments for this period">
          {period.instructions.map((ins) => (
            <InstructionRow key={ins.id} instruction={ins} />
          ))}
        </ul>
      )}

      {(payslip || advices.length > 0) && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Documents</p>
          <ul className="divide-y divide-border">
            {payslip && (
              <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 text-sm font-medium">Payslip {payslip.period_label ?? ""}</span>
                <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void downloadPayslip(payslip)} aria-label={`Download payslip ${payslip.period_label ?? ""}`}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </Button>
              </li>
            )}
            {advices.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function InstructionRow({ instruction: ins }: { instruction: MyInstruction }) {
  const events: TimelineItem[] = (ins.events ?? [])
    .map((e, i) => ({ id: `${ins.id}-${i}`, at: e.at, title: e.label }))
    .reverse()
    .map((e, i) => ({ ...e, tone: i === 0 ? statusEntry("employee_payment", ins.label.key).tone : ("neutral" as const) }));
  const account = ins.beneficiary.account_masked;
  return (
    <li className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip vocabulary="employee_payment" code={ins.label.key} />
        {(ins.sandbox || ins.label.badge === "SANDBOX") && <HonestyBadge tone="info">SANDBOX — no real money moved</HonestyBadge>}
        <span className="ms-auto">
          <MoneyText money={ins.amount} />
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{ins.label.text}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {account ? (
          <>
            To {ins.beneficiary.bank_name ? `${ins.beneficiary.bank_name} ` : ""}
            <bdi dir="ltr">{account}</bdi>
          </>
        ) : (
          "Account not recorded"
        )}
        {ins.reference && (
          <>
            {" "}
            · Ref <bdi dir="ltr">{ins.reference}</bdi>
          </>
        )}
        {ins.expected_settlement_date && ins.label.key !== "PAID" && <> · expected {fmtDate(ins.expected_settlement_date)}</>}
      </p>
      {ins.account_amount && ins.amount && ins.account_amount.currency !== ins.amount.currency && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Credited in {ins.account_amount.currency}: <MoneyText money={ins.account_amount} />
        </p>
      )}
      {ins.failure_message && <p className="mt-1 text-sm text-danger">{ins.failure_message}</p>}
      {events.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-primary">Payment steps</summary>
          <Timeline items={events} label="Payment steps" className="mt-2" />
        </details>
      )}
    </li>
  );
}
