"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  History,
  PauseCircle,
  Plus,
  SlidersHorizontal,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { ChecklistEmptyState } from "@/components/payroll/ChecklistEmptyState";
import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { KpiCard, type KpiState } from "@/components/payroll/KpiCard";
import { MoneyText } from "@/components/payroll/MoneyText";
import { SetupChecklist } from "@/components/payroll/settings/SetupChecklist";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Stepper } from "@/components/payroll/Stepper";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CURRENCY_LIST } from "@/lib/payroll/catalogues.generated";
import { PAYROLL_WORKSPACE_ITEMS, canSeeLegacyPayroll } from "@/lib/navigation";
import { P } from "@/lib/permissions.generated";

import { runsApi } from "./api";
import { NewRunModal } from "./NewRunModal";
import { Notice, WorkspaceHeader, canCreateRuns, canReadOverview, dateRange, linkButton, primaryLink, useLookups } from "./shared";
import type { ApprovalRequestDetail, Overview as OverviewDto, OverviewDeadline, OverviewMoneyRow, Run } from "./types";

const KPI_LISTS = ["eligible", "with_salary", "without_salary", "processed", "paid", "on_hold"] as const;
type KpiList = (typeof KPI_LISTS)[number];
const KPI_TITLES: Record<KpiList, string> = {
  eligible: "Total employees",
  with_salary: "With salary",
  without_salary: "Without salary",
  processed: "Processed",
  paid: "Paid",
  on_hold: "On hold",
};
const STATUS_FILTERS = [
  { value: "", label: "Final (default)" },
  { value: "APPROVED", label: "Approved" },
  { value: "DRAFT", label: "Draft" },
  { value: "ALL", label: "All stages" },
];
const PAY_CURRENCIES = CURRENCY_LIST.filter((c) => c.payroll_allowed).map((c) => c.code);

/** "2026-11" → first and last day of the month. */
export function monthRange(month: string): { period_from?: string; period_to?: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) return {};
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { period_from: `${month}-01`, period_to: `${month}-${String(last).padStart(2, "0")}` };
}

function kpiState(stage: string | undefined): KpiState | null {
  if (stage === "Final") return "FINAL";
  if (stage === "Approved") return "APPROVED";
  if (stage === "Draft") return "DRAFT";
  return null;
}

/** What the current run is waiting for, in plain words (3.8 §5.1 "Waiting for"). */
export function waitingFor(status: string, approval?: ApprovalRequestDetail | null): string {
  switch (status) {
    case "DRAFT":
      return "Pre-checks";
    case "INPUTS_PENDING":
      return "Blocking pre-check findings to be fixed";
    case "READY":
      return "Inputs to be locked and calculated";
    case "CALCULATING":
      return "The calculation to finish";
    case "CALCULATED":
      return "Validation";
    case "VALIDATION_FAILED":
      return "Calculation errors to be fixed";
    case "REVIEW_REQUIRED":
      return "Review and submission for approval";
    case "APPROVAL_PENDING": {
      const step = approval?.steps.find((s) => s.step_order === approval.current_step) ?? approval?.steps.find((s) => s.status === "pending");
      return step ? `${step.approver ?? step.approver_label}` : "An approver";
    }
    case "REJECTED":
      return "Rework after rejection";
    case "APPROVED":
      return "Finalization";
    case "FINALIZED":
      return "Payment batches";
    case "PAYMENT_READY":
      return "Payment release";
    case "SUBMITTED":
    case "PARTIALLY_PAID":
      return "Bank settlement evidence";
    case "PAID":
      return "Reconciliation";
    case "RECONCILED":
      return "Closing the run";
    case "REOPENED_FOR_CORRECTION":
      return "Corrections, then review or a fresh draft";
    default:
      return "Nothing";
  }
}

export function PayrollOverview() {
  const { me } = useCan();
  const newRun = useModalRoute("new-run", { keys: ["pay_group"] });
  if (!me) return null;
  const readOverview = canReadOverview(me);
  const create = canCreateRuns(me);
  return (
    <div>
      <WorkspaceHeader
        title="Payroll"
        description="Prepare, approve and pay salaries per legal entity and pay group."
        actions={
          <>
            {can(me, P.PAYROLL_CONFIGURATION_READ) && (
              <Link href="/settings/payroll/general" className={linkButton}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden /> Payroll settings
              </Link>
            )}
            {canSeeLegacyPayroll(me) && (
              <Link href="/payroll/legacy" className={linkButton}>
                <History className="h-4 w-4" aria-hidden /> Legacy payroll
              </Link>
            )}
          </>
        }
      />
      {readOverview ? <OverviewBody canCreate={create} onNewRun={() => newRun.openModal()} /> : <ShellOnly />}
      {create && <NewRunModal />}
    </div>
  );
}

/* ------------------------------------------------------------------ without run access: the earlier shell */

function ShellOnly() {
  const { me } = useCan();
  if (!me) return null;
  const pages = PAYROLL_WORKSPACE_ITEMS.filter((item) => item.href !== "/payroll" && item.visible(me));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {can(me, P.PAYROLL_CONFIGURATION_READ) ? (
          <SetupChecklist />
        ) : (
          <Card className="p-5">
            <p className="font-semibold">Payroll figures</p>
            <p className="mt-1 text-sm text-muted-foreground">Pay run figures need pay-run read access. Use the pages your role covers.</p>
          </Card>
        )}
      </div>
      <PagesCard pages={pages} />
    </div>
  );
}

function PagesCard({ pages }: { pages: typeof PAYROLL_WORKSPACE_ITEMS }) {
  if (!pages.length) return null;
  return (
    <Card className="h-fit">
      <CardHeader title="Your payroll pages" description="Only the pages your role covers are listed." />
      <ul className="p-2">
        {pages.map((item, index) => (
          <MotionSafe key={item.href}>
            <motion.li initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.025 }}>
              <Link href={item.href} className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-surface-muted">
                <item.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                {item.label}
              </Link>
            </motion.li>
          </MotionSafe>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ the overview */

interface Filters {
  month: string;
  legal_entity_id: string;
  pay_group_id: string;
  currency: string;
  status: string;
  branch_id: string;
  convert_to: string;
}

const EMPTY: Filters = { month: "", legal_entity_id: "", pay_group_id: "", currency: "", status: "", branch_id: "", convert_to: "" };

function OverviewBody({ canCreate, onNewRun }: { canCreate: boolean; onNewRun: () => void }) {
  const { me } = useCan();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const lookups = useLookups({ branches: true });
  const params = useMemo(
    () => ({
      ...monthRange(filters.month),
      legal_entity_id: filters.legal_entity_id,
      pay_group_id: filters.pay_group_id,
      currency: filters.currency,
      status: filters.status,
      branch_id: filters.branch_id,
      convert_to: filters.convert_to,
    }),
    [filters],
  );
  const { data, error, loading, reload } = useApi(() => runsApi.overview(params), [params]);
  const kpiSheet = useModalRoute("kpi", { keys: ["kpi"] });
  const set = (key: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const currencies = useMemo(() => Array.from(new Set((data?.money ?? []).map((m) => m.currency))).sort(), [data]);
  const currentRunRef = useMemo(() => pickCurrentRun(data?.deadlines ?? []), [data]);
  const hasRuns = (data?.deadlines ?? []).some((d) => d.run);
  const disabledReason = data?.processing_disabled_reason ?? null;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Overview filters">
          <Field label="Period">
            <Input type="month" value={filters.month} onChange={(e) => set("month")(e.target.value)} />
          </Field>
          <Field label="Legal entity">
            <Select value={filters.legal_entity_id} onChange={(e) => set("legal_entity_id")(e.target.value)}>
              <option value="">All entities</option>
              {lookups.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legal_name || e.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pay group">
            <Select value={filters.pay_group_id} onChange={(e) => set("pay_group_id")(e.target.value)}>
              <option value="">All pay groups</option>
              {lookups.payGroups
                .filter((g) => !filters.legal_entity_id || String(g.legal_entity_id) === filters.legal_entity_id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={filters.currency} onChange={(e) => set("currency")(e.target.value)}>
              <option value="">All currencies</option>
              {PAY_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Run stage">
            <Select value={filters.status} onChange={(e) => set("status")(e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location">
            <Select value={filters.branch_id} onChange={(e) => set("branch_id")(e.target.value)} disabled={!lookups.branches.length}>
              <option value="">{lookups.branches.length ? "All locations" : "All locations (list unavailable)"}</option>
              {lookups.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {data?.filters?.period_from ? `Showing ${dateRange(String(data.filters.period_from), String(data.filters.period_to))}` : "Showing the current month"}
            {" · Money figures default to finalized runs; change Run stage to see drafts."}
          </p>
          {canCreate && (
            <span className="inline-flex flex-col items-end gap-1">
              <Button onClick={onNewRun} disabled={!!disabledReason} aria-describedby={disabledReason ? "new-run-disabled" : undefined}>
                <Plus className="h-4 w-4" aria-hidden /> New pay run
              </Button>
              {disabledReason && (
                <span id="new-run-disabled" className="text-xs text-muted-foreground">
                  {disabledReason}
                </span>
              )}
            </span>
          )}
        </div>
      </Card>

      {error ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : data.empty_state === "NO_EMPLOYEES" ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title="Add employees first"
            description="Payroll counts employees placed in a pay group for the period. Nobody matches these filters yet."
            action={
              <Link href="/employees" className={primaryLink}>
                Go to employees
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {data.empty_state === "NO_SALARIES" && <NoSalaries data={data} />}
          <KpiGrid data={data} loading={loading} onDrill={(kpi) => kpiSheet.openModal({ kpi })} currentRunId={currentRunRef?.run?.id ?? null} />
          <MoneySection data={data} currencies={currencies} convertTo={filters.convert_to} onConvert={set("convert_to")} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <CurrentRunCard deadline={currentRunRef} canCreate={canCreate && !disabledReason} onNewRun={onNewRun} />
            <ExceptionsCard data={data} runId={currentRunRef?.run?.id ?? null} />
            <DeadlinesCard deadlines={data.deadlines} />
          </div>
        </>
      )}

      {data && (data.empty_state || !hasRuns) && me && can(me, P.PAYROLL_CONFIGURATION_READ) && <SetupChecklist />}

      <KpiListSheet open={kpiSheet.open} kpi={(kpiSheet.param("kpi") as KpiList | null) ?? null} params={params} onOpenChange={kpiSheet.onOpenChange} />
    </div>
  );
}

function pickCurrentRun(deadlines: OverviewDeadline[]): OverviewDeadline | null {
  const withRun = deadlines.filter((d) => d.run);
  const live = withRun.find((d) => d.run && !["CLOSED", "RECONCILED", "CANCELLED"].includes(d.run.status));
  return live ?? withRun[withRun.length - 1] ?? null;
}

function NoSalaries({ data }: { data: OverviewDto }) {
  return (
    <Card>
      <ChecklistEmptyState
        className="max-w-none px-4 py-6 sm:px-6"
        icon={<Wallet />}
        title={`${data.kpis.eligible} ${data.kpis.eligible === 1 ? "employee" : "employees"} · 0 salaries`}
        description="Nothing has been processed or paid yet. Finish these steps before the first pay run."
        steps={[
          { id: "structure", label: "Create a salary structure", href: "/payroll/structures" },
          { id: "assign", label: "Assign salaries", href: "/payroll/compensation" },
          { id: "banks", label: "Add bank accounts", href: "/payroll/bank-details" },
          { id: "run", label: "Create your first pay run", blockedReason: data.processing_disabled_reason ?? "Assign salaries before processing payroll." },
        ]}
      />
    </Card>
  );
}

function KpiGrid({ data, loading, onDrill, currentRunId }: { data: OverviewDto; loading: boolean; onDrill: (kpi: KpiList) => void; currentRunId: number | null }) {
  const k = data.kpis;
  const d = data.definitions ?? {};
  return (
    <section aria-label="Headcount" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="Total employees" count={k.eligible} icon={<Users />} definition={d.eligible} onClick={() => onDrill("eligible")} loading={loading && !data} delay={0} />
      <KpiCard label="With salary" count={k.with_salary} icon={<UserCheck />} tone="success" onClick={() => onDrill("with_salary")} delay={0.03} />
      <KpiCard
        label="Without salary"
        count={k.without_salary}
        icon={<UserX />}
        tone={k.without_salary > 0 ? "warning" : "success"}
        onClick={() => onDrill("without_salary")}
        delay={0.06}
        footer={
          k.without_salary > 0 ? (
            <Link href="/payroll/compensation" className="inline-flex min-h-[44px] items-center gap-1 font-medium text-primary hover:underline sm:min-h-0">
              {k.without_salary} → Assign <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null
        }
      />
      <KpiCard
        label="Processed"
        count={k.processed}
        icon={<CheckCircle2 />}
        tone="info"
        definition={d.processed}
        onClick={() => onDrill("processed")}
        delay={0.09}
        footer={
          currentRunId ? (
            <Link href={`/payroll/runs/${currentRunId}`} className="inline-flex min-h-[44px] items-center gap-1 font-medium text-primary hover:underline sm:min-h-0">
              Open run <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null
        }
      />
      <KpiCard label="Paid" count={k.paid} icon={<Banknote />} tone="success" definition={d.paid} hint="Settlement evidence only" onClick={() => onDrill("paid")} delay={0.12} />
      <KpiCard label="On hold" count={k.on_hold} icon={<PauseCircle />} tone={k.on_hold ? "warning" : "primary"} definition={d.on_hold} onClick={() => onDrill("on_hold")} delay={0.15} />
      {!data.consistency?.eligible_equals_with_plus_without && (
        <p role="alert" className="text-sm text-danger sm:col-span-2 lg:col-span-3 xl:col-span-6">
          With and without salary don&apos;t add up to the total. Reload; if it persists, report it.
        </p>
      )}
    </section>
  );
}

function MoneySection({ data, currencies, convertTo, onConvert }: { data: OverviewDto; currencies: string[]; convertTo: string; onConvert: (v: string) => void }) {
  const stages = Array.from(new Set(data.money.map((m) => m.stage)));
  const byStage = (stage: string | null) => data.money.filter((m) => stage === null || m.stage === stage);
  const amounts = (rows: OverviewMoneyRow[], key: "gross" | "net" | "employer_cost") => {
    // One currency can come from several runs of the same stage; the server already summed those per (currency, stage).
    return rows.map((r) => ({ amount: r[key], currency: r.currency }));
  };
  const groups: (string | null)[] = stages.length > 1 ? stages : [stages[0] ?? null];
  const empty = data.money.length === 0;
  return (
    <section aria-label="Pay figures" className="space-y-4">
      {groups.map((stage) => {
        const rows = byStage(stage);
        const state = kpiState(stage ?? undefined);
        const hint = empty ? "No calculated run in this view yet" : `${rows.reduce((n, r) => n + r.employees, 0)} employees · ${rows.reduce((n, r) => n + r.runs, 0)} run(s)`;
        return (
          <div key={stage ?? "none"} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Gross" amounts={amounts(rows, "gross")} state={state} icon={<CircleDollarSign />} hint={hint} />
            <KpiCard label="Net" amounts={amounts(rows, "net")} state={state} icon={<Wallet />} tone="success" hint={hint} />
            <KpiCard label="Employer cost" amounts={amounts(rows, "employer_cost")} state={state} icon={<Banknote />} tone="info" hint={hint} />
            <StatutoryCard data={data} stage={stage} />
          </div>
        );
      })}
      {currencies.length > 1 && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Show one total in" hint="Only with a recorded FX rate; otherwise amounts stay per currency.">
            <Select value={convertTo} onChange={(e) => onConvert(e.target.value)}>
              <option value="">Per currency (no conversion)</option>
              {["USD", "EUR", "GBP", ...currencies].filter((c, i, all) => all.indexOf(c) === i).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {data.converted && <ConvertedTotals converted={data.converted} />}
        </Card>
      )}
    </section>
  );
}

function ConvertedTotals({ converted }: { converted: NonNullable<OverviewDto["converted"]> }) {
  if (!converted.available) {
    return (
      <Notice tone="warning" title={`Can't show one total in ${converted.currency}`} className="flex-1">
        {converted.message}
        {converted.issues?.length ? ` Missing: ${converted.issues.map((i) => i.currency).join(", ")}.` : ""}
      </Notice>
    );
  }
  const source = converted.rates?.[0];
  return (
    <div className="min-w-0 flex-1 text-sm">
      <p className="font-medium">
        Show in {converted.currency} (rates of {fmtDate(converted.date)}
        {source ? `, source ${source.source}` : ""})
      </p>
      <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        {Object.entries(converted.totals ?? {}).map(([key, money]) => (
          <div key={key} className="flex gap-2">
            <dt className="text-muted-foreground">{key === "employer_cost" ? "Employer cost" : key === "gross" ? "Gross" : "Net"}</dt>
            <dd>
              <MoneyText money={money} useCode />
            </dd>
          </div>
        ))}
      </dl>
      {converted.label && <p className="mt-1 text-xs text-muted-foreground">{converted.label}</p>}
    </div>
  );
}

function StatutoryCard({ data, stage }: { data: OverviewDto; stage: string | null }) {
  const entries = data.statutory.flatMap((entity) => entity.items.filter((i) => stage === null || i.stage === stage).map((i) => ({ ...i, watermark: entity.watermark })));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">Statutory</p>
        {stage && kpiState(stage) && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{stage}</span>}
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Shown only for entities whose verified country pack defines contributions.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {entries.slice(0, 6).map((i) => (
            <li key={`${i.code}-${i.currency}-${i.stage}`} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{i.label}</span>
              <MoneyText amount={i.amount} currency={i.currency} compact />
            </li>
          ))}
          {entries.some((e) => e.watermark) && <li className="text-xs font-semibold text-warning">{entries.find((e) => e.watermark)?.watermark}</li>}
        </ul>
      )}
      <Link href="/payroll/compliance" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-primary hover:underline sm:min-h-0">
        Compliance <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
      </Link>
    </Card>
  );
}

function CurrentRunCard({ deadline, canCreate, onNewRun }: { deadline: OverviewDeadline | null; canCreate: boolean; onNewRun: () => void }) {
  const runId = deadline?.run?.id ?? 0;
  const run = useApi<Run>(() => runsApi.get(runId), [runId], { enabled: runId > 0 });
  const requestId = run.data?.status === "APPROVAL_PENDING" ? run.data.approval_request_id ?? 0 : 0;
  const approval = useApi(() => runsApi.approvalRequest(requestId).catch(() => null), [requestId], { enabled: requestId > 0 });
  if (!deadline?.run) {
    return (
      <Card className="p-5">
        <p className="font-semibold">No pay run in this period yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Create the period&apos;s regular run when inputs are ready.</p>
        {canCreate && (
          <Button className="mt-4" onClick={onNewRun}>
            <Plus className="h-4 w-4" aria-hidden /> New pay run
          </Button>
        )}
      </Card>
    );
  }
  const status = run.data?.status ?? deadline.run.status;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{run.data?.label ?? `${dateRange(deadline.period_start, deadline.period_end)} · ${deadline.pay_group}`}</p>
        <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
          {deadline.run.number}
        </bdi>
      </div>
      <Stepper state={status} compact className="mt-4" />
      <p className="mt-4 text-sm">
        <span className="text-muted-foreground">Waiting for: </span>
        <span className="font-medium">{waitingFor(status, approval.data)}</span>
      </p>
      <Link href={`/payroll/runs/${deadline.run.id}`} className={`${primaryLink} mt-4`}>
        Open run
      </Link>
    </Card>
  );
}

const EXCEPTION_TITLES: Record<string, string> = {
  NO_SALARY: "without salary",
  MISSING_BANK: "without a bank account",
  UNVERIFIED_BANK: "unverified bank accounts",
  UNMARKED_DAYS: "unmarked days",
  NET_VARIANCE: "net pay changes to review",
  COMPONENT_VARIANCE: "component changes to review",
};

function ExceptionsCard({ data, runId }: { data: OverviewDto; runId: number | null }) {
  const codes = Object.entries(data.exceptions.by_code ?? {}).sort((a, b) => b[1] - a[1]);
  const extra: { key: string; text: string; href: string }[] = [];
  if (data.kpis.without_salary > 0) extra.push({ key: "nosalary", text: `${data.kpis.without_salary} without salary`, href: "/payroll/compensation" });
  const count = data.exceptions.open + extra.length;
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Exceptions ({data.exceptions.open})
      </p>
      {data.exceptions.blocking > 0 && <p className="mt-1 text-xs font-medium text-danger">{data.exceptions.blocking} blocking</p>}
      {count === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing needs attention.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {extra.map((e) => (
            <ExceptionRow key={e.key} text={e.text} href={e.href} />
          ))}
          {codes.slice(0, 8).map(([code, n]) => (
            <ExceptionRow key={code} text={`${n} ${EXCEPTION_TITLES[code] ?? code.replace(/_/g, " ").toLowerCase()}`} href={runId ? `/payroll/runs/${runId}?tab=exceptions` : undefined} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExceptionRow({ text, href }: { text: string; href?: string }): ReactNode {
  return (
    <li className="flex min-h-[44px] items-center justify-between gap-2 text-sm">
      <span>⚠ {text}</span>
      {href && (
        <Link href={href} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-xs font-medium text-primary hover:bg-surface-muted">
          Fix<span className="sr-only">: {text}</span>
        </Link>
      )}
    </li>
  );
}

function DeadlinesCard({ deadlines }: { deadlines: OverviewDeadline[] }) {
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-semibold">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden /> Deadlines
      </p>
      {deadlines.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No pay periods in this view.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {deadlines.slice(0, 6).map((d) => (
            <li key={`${d.pay_group_id}-${d.period_start}`} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{d.pay_group}</span>
                {d.run ? <StatusChip vocabulary="run" code={d.run.status} /> : <span className="text-xs text-muted-foreground">No run yet</span>}
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Input cutoff</dt>
                  <dd>{fmtDate(d.input_cutoff, "d MMM")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Approval</dt>
                  <dd>{fmtDate(d.approval_deadline, "d MMM")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pay date</dt>
                  <dd>{fmtDate(d.pay_date, "d MMM")}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ drill-down (same query and scope, EC-UX-03) */

function KpiListSheet({ open, kpi, params, onOpenChange }: { open: boolean; kpi: KpiList | null; params: Record<string, unknown>; onOpenChange: (o: boolean) => void }) {
  const valid = !!kpi && (KPI_LISTS as readonly string[]).includes(kpi);
  const list = useApi(() => runsApi.overviewList(kpi as string, params), [kpi, params], { enabled: open && valid });
  return (
    <Sheet open={open && valid} onOpenChange={onOpenChange} title={kpi ? KPI_TITLES[kpi] ?? "Employees" : "Employees"} description="The same people the count includes, within your scope.">
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Nobody here" />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">{list.data.total} in total{list.data.total > list.data.items.length ? `, first ${list.data.items.length} shown` : ""}</p>
          <ul className="divide-y divide-border">
            {list.data.items.map((row) => (
              <li key={row.assignment_id} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {row.employee_name}
                  {row.employee_code && <span className="ms-1.5 text-xs text-muted-foreground">{row.employee_code}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {row.pay_group} <CurrencyBadge code={row.currency} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
