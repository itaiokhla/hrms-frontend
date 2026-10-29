"use client";

import { ArrowUpRight, Info, PauseCircle, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DAY_CLASSES, DayLedgerCalendar, type LedgerDay } from "@/components/payroll/DayLedgerCalendar";
import { ExplainPanel, type ExplainInput, type ExplainSource } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { RetroBreakdown } from "@/components/payroll/RetroBreakdown";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { formatDays } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";
import type { Money } from "@/lib/money";

import { runsApi } from "./api";
import { canHold, canRelease, hasAction, isFinalized, useRun } from "./context";
import { ChangeText } from "./EmployeesTab";
import { ReleaseHoldModal, useHoldRoute } from "./HoldModal";
import { EXCLUSION_LABELS, EmployeeStatusChip, HOLD_REASON_LABELS, NotFoundState, isNotFound, humanize, periodLabel } from "./shared";
import { FIXTURE_LABEL, PackBadges } from "./SummaryTab";
import type { LedgerDayDto, LineSource, PayrollLineDto, RunEmployeeDetail } from "./types";

const KIND_ORDER: { kind: string; title: string }[] = [
  { kind: "EARNING", title: "Earnings" },
  { kind: "DEDUCTION", title: "Deductions" },
  { kind: "REIMBURSEMENT", title: "Reimbursements" },
  { kind: "EMPLOYER_CONTRIBUTION", title: "Employer contributions" },
  { kind: "BENEFIT_IN_KIND", title: "Benefits in kind" },
  { kind: "INFORMATIONAL", title: "For information" },
  { kind: "ROUNDING", title: "Rounding" },
];

const SOURCE_KIND: Record<string, string> = {
  attendance: "Attendance day",
  leave: "Leave request",
  overtime_entry: "Overtime entry",
  task: "Task",
  wage_input: "Wage input",
  compensation_assignment: "Salary",
  claim: "Claim",
  loan: "Loan",
  advance: "Advance",
  arrears: "Arrears",
  policy: "Policy",
  pack_rule: "Country pack rule",
  minimum_wage: "Minimum wage",
  holiday: "Holiday",
  manual_lop: "Manual loss of pay",
};

/** A backend source reference as a link the viewer may open (the API strips links they may not, EC-UX-08). */
export function toSource(source: LineSource): ExplainSource {
  const kind = source.type ? SOURCE_KIND[source.type] ?? humanize(source.type) : undefined;
  if (source.restricted) return { label: "Restricted record", kind };
  const label = source.id !== undefined ? `#${source.id}` : kind ?? "Source";
  return { label, href: typeof source.link === "string" && source.link.startsWith("/") ? source.link : undefined, kind };
}

function isMoney(value: unknown): value is Money {
  return !!value && typeof value === "object" && typeof (value as Money).amount === "string" && typeof (value as Money).currency === "string";
}

function plainValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  if (isMoney(value)) return <MoneyText money={value} />;
  if (typeof value === "object") return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  return <bdi dir="ltr">{String(value)}</bdi>;
}

/** ExplainPanel props from a payroll line: explanation first, then formula with values, inputs, rounding and sources. */
export function explainProps(line: PayrollLineDto) {
  const trace = line.trace ?? {};
  const steps = Array.isArray(trace.steps) ? (trace.steps as unknown[]) : [];
  const formula =
    typeof trace.formula === "string"
      ? trace.formula
      : steps.length
        ? steps.map((s) => (typeof s === "string" ? s : typeof s === "object" && s && "text" in s ? String((s as { text: unknown }).text) : JSON.stringify(s))).join(" → ")
        : undefined;
  const inputs: ExplainInput[] = [];
  if (isMoney(trace.rate)) inputs.push({ label: "Rate", value: <MoneyText money={trace.rate} /> });
  else if (line.rate) inputs.push({ label: "Rate", value: <bdi dir="ltr">{line.rate}</bdi> });
  if (trace.units !== undefined || line.units) inputs.push({ label: "Units", value: <bdi dir="ltr">{String(trace.units ?? line.units)}</bdi> });
  if (trace.proration && typeof trace.proration === "object") {
    Object.entries(trace.proration as Record<string, unknown>).forEach(([k, v]) => inputs.push({ label: humanize(k), value: plainValue(v) }));
  }
  if (trace.unrounded !== undefined) inputs.push({ label: "Before rounding", value: <bdi dir="ltr">{String(trace.unrounded)}</bdi> });
  const r = trace.rounding as { mode?: string; increment?: string; stage?: string } | undefined;
  const rounding = r && (r.mode || r.increment) ? `${humanize(r.mode ?? "")} to ${r.increment ?? "—"}${trace.unrounded !== undefined ? ` (${String(trace.unrounded)} → ${line.amount?.amount ?? "—"})` : ""}` : undefined;
  const notes = Array.isArray(trace.notes) ? (trace.notes as unknown[]).map(String).join(" ") : typeof trace.notes === "string" ? trace.notes : "";
  return {
    explanation: line.explanation || notes || "No explanation was recorded for this line.",
    formula,
    inputs,
    rounding,
    sources: (line.sources ?? []).map(toSource),
  };
}

/** The ledger days as DayLedgerCalendar cells (AM / PM classification, paid halves, sources). */
export function toLedgerDays(days: LedgerDayDto[]): LedgerDay[] {
  return days.map((d) => {
    const am = d.slots?.[0];
    const pm = d.slots?.[1] ?? am;
    const sources = (d.slots ?? [])
      .map((s) => s.source)
      .filter((s): s is LineSource => !!s)
      .map((s) => {
        const src = toSource(s);
        return { label: `${src.kind ?? "Source"} ${typeof src.label === "string" ? src.label : ""}`.trim(), href: src.href, kind: src.kind };
      });
    const paid = (v: unknown) => v !== null && v !== undefined && Number(v) > 0;
    return {
      date: d.date,
      am: am?.classification ?? "UNMARKED",
      pm: pm?.classification ?? "UNMARKED",
      paid: { am: paid(am?.paid), pm: paid(pm?.paid) },
      note: d.holiday?.name ?? (d.slots ?? []).map((s) => s.detail).filter(Boolean).join(" · ") ?? undefined,
      sources,
    };
  });
}

/** The employee's run detail: lines with "Why this amount?", the attendance cycle, findings and actions (3.8 §5.4). */
export function EmployeeInRunView({ runEmployeeId, inSheet, onLoaded }: { runEmployeeId: string; inSheet?: boolean; onLoaded?: (detail: RunEmployeeDetail) => void }) {
  const { run, me, version, startCalculation, calculating, reload } = useRun();
  const detail = useApi(() => runsApi.employee(run.id, runEmployeeId), [run.id, runEmployeeId, version]);
  const loaded = detail.data;
  useEffect(() => {
    if (loaded) onLoaded?.(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const hold = useHoldRoute();
  const [releaseOpen, setReleaseOpen] = useState(false);
  if (detail.error && isNotFound(detail.error)) return <NotFoundState what="Employee in this run" backHref={`/payroll/runs/${run.id}?tab=employees`} backLabel="Back to the run" />;
  if (detail.error) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  const d = detail.data;
  if (!d) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const editable = !isFinalized(run.status) && run.status !== "CANCELLED";
  const addInput = editable && can(me, P.PAYROLL_INPUTS_EDIT);
  const holdable = !d.hold_type && d.status !== "EXCLUDED" && canHold(me, run);
  const releasable = !!d.hold_type && canRelease(me, run);
  const recalc = hasAction(run, "RECALCULATE") && d.status !== "EXCLUDED";

  return (
    <div className="space-y-5">
      {inSheet && (
        <Link href={`/payroll/runs/${run.id}/employees/${d.id}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open full page <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
      <Headline d={d} />
      {d.error?.message && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {d.error.code ? `${humanize(d.error.code)}: ` : ""}
          {d.error.message}
        </p>
      )}
      {d.hold && (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm">
          <span className="font-medium">{d.hold.type === "FULL" ? "Whole pay on hold" : "Payment on hold"}</span>
          {d.hold.reason_code && ` · ${HOLD_REASON_LABELS[d.hold.reason_code] ?? d.hold.reason_code}`}
          {d.hold.note && <span className="block text-muted-foreground">{d.hold.note}</span>}
        </p>
      )}
      {d.status === "EXCLUDED" && (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm">
          Excluded from this run: {EXCLUSION_LABELS[d.exclusion_reason ?? ""] ?? humanize(d.exclusion_reason)}
          {d.exclusion_note ? ` — ${d.exclusion_note}` : ""}
        </p>
      )}
      <Lines d={d} />
      <Attendance d={d} />
      <RetroBreakdown runEmployeeId={d.id} />
      {d.exceptions.length > 0 && (
        <section aria-label="Findings">
          <h3 className="mb-2 text-sm font-semibold">Findings</h3>
          <ul className="space-y-1 text-sm">
            {d.exceptions.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface-muted/60 px-3 py-2">
                <span>{e.message}</span>
                <span className="text-xs text-muted-foreground">{humanize(e.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.calculated_at && (
        <p className="text-xs text-muted-foreground">
          Calculated {fmtDateTime(d.calculated_at)}
          {d.snapshot ? ` · inputs snapshot v${d.snapshot.version}` : ""}
          {d.engine_version ? ` · engine ${d.engine_version}` : ""}
        </p>
      )}
      {(addInput || holdable || releasable || recalc) && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4" role="toolbar" aria-label="Employee actions">
          {addInput && (
            <Link href={`/payroll/inputs?modal=wage-input&employee=${d.employee.id}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
              <Plus className="h-4 w-4" aria-hidden /> Add wage input
            </Link>
          )}
          {holdable && (
            <Button variant="secondary" onClick={() => hold.openModal({ employee: d.id })}>
              <PauseCircle className="h-4 w-4" aria-hidden /> Put on hold
            </Button>
          )}
          {releasable && (
            <Button variant="secondary" onClick={() => setReleaseOpen(true)}>
              Release hold
            </Button>
          )}
          {recalc && (
            <Button onClick={() => void startCalculation([d.employee.id])} disabled={calculating}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Recalculate this employee
            </Button>
          )}
        </div>
      )}
      <ReleaseHoldModal
        open={releaseOpen}
        runEmployeeId={d.id}
        onOpenChange={setReleaseOpen}
        onDone={() => {
          setReleaseOpen(false);
          reload();
        }}
      />
    </div>
  );
}

function Headline({ d }: { d: RunEmployeeDetail }) {
  const prevNet = d.previous?.net ? { amount: d.previous.net, currency: d.previous.currency ?? d.currency } : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border p-4">
      <div>
        <p className="text-xs text-muted-foreground">Net</p>
        <p className="font-display text-2xl font-semibold">
          <MoneyText money={d.totals.net} />
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Previous{d.previous?.period_ref ? ` (${d.previous.period_ref})` : ""}</dt>
          <dd>{prevNet ? <MoneyText money={prevNet} /> : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Change</dt>
          <dd>
            <ChangeText value={d.net_change_percent} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <EmployeeStatusChip status={d.status} holdType={d.hold_type} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Lines({ d }: { d: RunEmployeeDetail }) {
  const [open, setOpen] = useState<number | null>(null);
  const groups = useMemo(() => {
    const known = new Set(KIND_ORDER.map((k) => k.kind));
    const list = KIND_ORDER.map((k) => ({ ...k, lines: d.lines.filter((l) => l.kind === k.kind) }));
    const other = d.lines.filter((l) => !known.has(l.kind));
    if (other.length) list.push({ kind: "OTHER", title: "Other", lines: other });
    return list.filter((g) => g.lines.length);
  }, [d.lines]);
  if (!d.lines.length) {
    return <p className="text-sm text-muted-foreground">{d.status === "EXCLUDED" ? "No lines: the employee is not paid by this run." : "No lines yet: they appear once the employee is calculated."}</p>;
  }
  return (
    <section aria-label="Pay lines" className="space-y-4">
      {groups.map((g) => (
        <div key={g.kind}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{g.title}</span>
            <span className="hidden text-end sm:block">Rate</span>
            <span className="text-end">This period</span>
          </div>
          <ul>
            {g.lines.map((line) => {
              const props = explainProps(line);
              const rate = isMoney(line.trace?.rate) ? <MoneyText money={line.trace.rate as Money} /> : line.rate ? <bdi dir="ltr">{line.rate}</bdi> : null;
              const expanded = open === line.id;
              return (
                <li key={line.id} className="border-b border-border/50 py-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4">
                    <span className="min-w-0 text-sm">
                      {line.name}
                      {line.fixture && <PackBadges labels={[line.label ?? FIXTURE_LABEL]} className="ms-2" />}
                    </span>
                    <span className="hidden text-end text-sm text-muted-foreground sm:block">{rate ?? ""}</span>
                    <span className="flex items-center justify-end gap-1 text-sm">
                      <MoneyText money={line.amount} />
                      <button
                        type="button"
                        className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted sm:h-8 sm:w-8", expanded && "text-primary")}
                        aria-expanded={expanded}
                        aria-label={`Why this amount? ${line.name}`}
                        onClick={() => setOpen(expanded ? null : line.id)}
                      >
                        <Info className="h-4 w-4" aria-hidden />
                      </button>
                    </span>
                  </div>
                  {!expanded && line.explanation && <p className="mt-0.5 text-xs text-muted-foreground">{line.explanation}</p>}
                  {expanded && <ExplainPanel className="mt-2" {...props} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {d.hidden_lines > 0 && <p className="text-xs text-muted-foreground">{d.hidden_lines} HR-only line(s) are hidden for your role.</p>}
    </section>
  );
}

function Attendance({ d }: { d: RunEmployeeDetail }) {
  const days = d.ledger?.days ?? [];
  const cells = useMemo(() => toLedgerDays(days), [days]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!days.length) return null;
  const start = days[0].date;
  const end = days[days.length - 1].date;
  const raw = picked ? days.find((x) => x.date === picked) : null;
  return (
    <section aria-label="Attendance">
      <h3 className="mb-2 text-sm font-semibold">Attendance {periodLabel({ start, end })}</h3>
      <DayLedgerCalendar start={start} end={end} days={cells} onSelectDay={(_, date) => setPicked((p) => (p === date ? null : date))} />
      {raw && (
        <div className="mt-3 rounded-xl border border-border p-3 text-sm" aria-live="polite">
          <p className="font-medium">{fmtDate(raw.date, "EEE d MMM yyyy")}</p>
          <ul className="mt-1 space-y-1">
            {(raw.slots ?? []).map((s, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2">
                <span>
                  {i === 0 ? "Morning" : "Afternoon"}: {DAY_CLASSES[s.classification as keyof typeof DAY_CLASSES]?.label ?? humanize(s.classification)}
                  {s.detail ? ` · ${s.detail}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.lop && Number(s.lop) > 0 ? `LOP ${formatDays(s.lop)}` : s.paid && Number(s.paid) > 0 ? "Paid" : "Unpaid"}
                  {s.source && (() => {
                    const src = toSource(s.source);
                    return src.href ? (
                      <Link href={src.href} className="ms-2 font-medium text-primary hover:underline">
                        {src.kind ?? "Source"}
                      </Link>
                    ) : (
                      <span className="ms-2">{src.kind ?? ""}</span>
                    );
                  })()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The sheet next to the employee list (`?modal=employee&employee=<run employee id>`). */
export function EmployeeSheet() {
  const { run } = useRun();
  const sheet = useModalRoute("employee", { keys: ["employee"] });
  const [head, setHead] = useState<{ id: string; name: string | null; code: string | null } | null>(null);
  const current = head && head.id === sheet.id ? head : null;
  const title = current?.name ?? "Employee";
  const code = current?.code;
  return (
    <Sheet
      open={sheet.open && !!sheet.id}
      onOpenChange={sheet.onOpenChange}
      title={title}
      description={[code, run.pay_group.name, periodLabel(run.period)].filter(Boolean).join(" · ")}
      width="max-w-2xl"
    >
      {sheet.id && (
        <EmployeeInRunView
          runEmployeeId={sheet.id}
          inSheet
          onLoaded={(d) => setHead({ id: String(d.id), name: d.employee.name, code: d.employee.code })}
        />
      )}
    </Sheet>
  );
}
