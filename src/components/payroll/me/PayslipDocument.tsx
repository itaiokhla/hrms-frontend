"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { MoneyText } from "@/components/payroll/MoneyText";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { formatDays } from "@/lib/payroll/labels";

import { HonestyBadge, Notice } from "./shared";
import type { PayslipContent, PayslipLine } from "./types";

const FIXTURE = "FIXTURE — not law";

/**
 * The web view of a published payslip, rendered from the frozen view model the PDF uses
 * (services/payslips.py `build`): only what the payslip carries, so it matches the PDF exactly.
 * Bank details arrive masked; employer contributions are kept apart from net pay; payment status is
 * the sentence the server derived from evidence ("Paid on …" only with verified settlement).
 */
export function PayslipDocument({ content, compact }: { content: PayslipContent; compact?: boolean }) {
  const currency = content.currency;
  const revised = content.title_key === "REVISED_PAYSLIP";
  const fixture = content.labels.includes(FIXTURE) || [...content.earnings, ...content.deductions].some((l) => l.fixture);
  const otherLabels = content.labels.filter((l) => l !== FIXTURE);
  const employer = content.employer_contributions ?? [];

  return (
    <article className="space-y-5" aria-label={`Payslip ${content.period.label}`}>
      {revised && (
        <Notice tone="warning" title="Revised payslip">
          This payslip replaces {content.replaces ? <bdi dir="ltr">{content.replaces}</bdi> : "an earlier payslip"} for the same period.
        </Notice>
      )}
      {(fixture || otherLabels.length > 0) && (
        <div className="flex flex-wrap gap-2" aria-label="Notices from your employer's payroll">
          {fixture && <HonestyBadge>{FIXTURE}</HonestyBadge>}
          {otherLabels.map((label) => (
            <HonestyBadge key={label}>{label}</HonestyBadge>
          ))}
        </div>
      )}

      <header className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{revised ? "Revised payslip" : "Payslip"}</p>
          <p className="mt-1 text-lg font-semibold">{content.period.label}</p>
          <p className="text-sm text-muted-foreground">
            {fmtDate(content.period.start)} – {fmtDate(content.period.end)} · Pay date {fmtDate(content.period.pay_date)}
          </p>
          {content.employer.legal_name && <p className="mt-2 text-sm">{content.employer.legal_name}</p>}
          {content.employer.address_line && <p className="text-xs text-muted-foreground">{content.employer.address_line}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm sm:justify-self-end">
          <Pair label="Name" value={content.employee.name} />
          <Pair label="Employee ID" value={<bdi dir="ltr">{content.employee.code}</bdi>} />
          {content.employee.designation && <Pair label="Designation" value={content.employee.designation} />}
          {content.employee.department && <Pair label="Department" value={content.employee.department} />}
          {content.employee.pay_group && <Pair label="Pay group" value={content.employee.pay_group} />}
          {content.employee.bank && <Pair label="Paid to" value={<bdi dir="ltr">{content.employee.bank}</bdi>} />}
        </dl>
      </header>

      <div className="rounded-2xl bg-primary-soft/60 p-4">
        <p className="text-sm text-muted-foreground">Net pay</p>
        <p className="mt-1 text-3xl font-semibold">
          <MoneyText amount={content.totals.net} currency={currency} />
        </p>
        {content.totals.net_words && <p className="mt-1 text-xs text-muted-foreground">{content.totals.net_words}</p>}
        <p className="mt-2 text-sm">
          Payment: <span className="font-medium">{content.payment.text}</span>
          {content.payment.sandbox && (
            <span className="ms-2">
              <HonestyBadge tone="info">SANDBOX — no real money moved</HonestyBadge>
            </span>
          )}
        </p>
      </div>

      <div className={cn("grid gap-5", !compact && "lg:grid-cols-2")}>
        <Section title="Earnings" lines={content.earnings} currency={currency} total={content.totals.gross} totalLabel="Gross pay" showYtd={content.show_ytd} />
        <Section title="Deductions" lines={content.deductions} currency={currency} total={content.totals.deductions} totalLabel="Total deductions" showYtd={content.show_ytd} deduction />
      </div>
      {content.reimbursements.length > 0 && (
        <Section
          title="Reimbursements"
          note="Paid back to you with your salary; not part of your wages."
          lines={content.reimbursements}
          currency={currency}
          total={content.totals.reimbursements}
          totalLabel="Total reimbursements"
        />
      )}
      {employer.length > 0 && (
        <Section title="Paid by your employer" note={content.employer_note} lines={employer} currency={currency} muted />
      )}

      {(content.attendance || (content.leave_balances && content.leave_balances.length > 0)) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {content.attendance && (
            <section aria-label="Attendance summary" className="rounded-2xl border border-border p-4">
              <h3 className="text-sm font-semibold">Attendance</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                <Pair label="Days in period" value={content.attendance.days_in_period ?? "Not available"} />
                <Pair label="Paid days" value={content.attendance.paid_days ? formatDays(content.attendance.paid_days) : "Not available"} />
                <Pair label="Loss of pay" value={content.attendance.lop_days ? formatDays(content.attendance.lop_days) : "—"} />
                <Pair label="Leave taken" value={content.attendance.leave_days ? formatDays(content.attendance.leave_days) : "—"} />
                <Pair label="Overtime" value={content.attendance.overtime_hours ? `${content.attendance.overtime_hours} h` : "—"} />
              </dl>
            </section>
          )}
          {content.leave_balances && content.leave_balances.length > 0 && (
            <section aria-label="Leave balances" className="rounded-2xl border border-border p-4">
              <h3 className="text-sm font-semibold">Leave balances</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                {content.leave_balances.map((b) => (
                  <Pair key={b.code} label={b.name} value={b.remaining === null ? `${formatDays(b.used)} used` : `${formatDays(b.remaining)} left`} />
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {content.template?.footer_note && <p className="text-xs text-muted-foreground">{content.template.footer_note}</p>}
    </article>
  );
}

function Pair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium sm:text-start">{value}</dd>
    </>
  );
}

function Section({
  title,
  note,
  lines,
  currency,
  total,
  totalLabel,
  showYtd,
  deduction,
  muted,
}: {
  title: string;
  note?: string;
  lines: PayslipLine[];
  currency: string;
  total?: string;
  totalLabel?: string;
  showYtd?: boolean;
  deduction?: boolean;
  muted?: boolean;
}) {
  const ytd = showYtd && lines.some((l) => l.ytd);
  return (
    <section aria-label={title} className={cn("rounded-2xl border border-border p-4", muted && "bg-surface-muted/50")}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {note}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None this period.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Amount</th>
              {ytd && <th scope="col">Year to date</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={`${line.code}-${i}`} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-2 pe-3 text-start font-normal">
                  <span className="block">{line.label}</span>
                  {(line.units || line.period_ref_label || line.fixture) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {line.units && line.rate && (
                        <span>
                          <bdi dir="ltr">{line.units}</bdi> × <MoneyText amount={line.rate} currency={currency} />
                        </span>
                      )}
                      {line.units && !line.rate && <bdi dir="ltr">{line.units} units</bdi>}
                      {line.period_ref_label && <span>for {line.period_ref_label}</span>}
                      {line.fixture && <HonestyBadge>{FIXTURE}</HonestyBadge>}
                    </span>
                  )}
                </th>
                <td className="py-2 text-end align-top">
                  <MoneyText amount={line.amount} currency={currency} negativeCue={deduction ? false : undefined} />
                </td>
                {ytd && (
                  <td className="hidden py-2 ps-3 text-end align-top text-xs text-muted-foreground sm:table-cell">
                    {line.ytd ? <MoneyText amount={line.ytd} currency={currency} /> : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {total !== undefined && (
            <tfoot>
              <tr>
                <th scope="row" className="pt-2 text-start font-semibold">
                  {totalLabel}
                </th>
                <td className="pt-2 text-end">
                  <MoneyText amount={total} currency={currency} emphasis />
                </td>
                {ytd && <td className="hidden sm:table-cell" />}
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </section>
  );
}
