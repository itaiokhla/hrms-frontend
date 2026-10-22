"use client";

import { PauseCircle, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorState, Pagination, SearchInput, type Column } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { useApi, useDebounced } from "@/lib/hooks";
import { percentChange } from "@/lib/payroll/labels";

import { runsApi } from "./api";
import { canHold, hasAction, useRun } from "./context";
import { useHoldRoute } from "./HoldModal";
import { EmployeeStatusChip, EXCLUSION_LABELS, humanize } from "./shared";
import { EMPLOYEE_FILTERS, type EmployeeFilter, type RunEmployeeRow } from "./types";

const LIMIT = 50;
const FILTER_LABELS: Record<EmployeeFilter, string> = {
  flags: "Flags",
  errors: "Errors",
  holds: "Holds",
  joiners: "Joiners",
  leavers: "Leavers",
  variance: "Variance",
  calculated: "Calculated",
  excluded: "Excluded",
};

export function ChangeText({ value }: { value: string | null }) {
  const change = percentChange(value);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", change.direction === "up" && "text-success", change.direction === "down" && "text-danger")}>
      <span aria-hidden>{change.text}</span>
      <span className="sr-only">{change.spoken}</span>
    </span>
  );
}

/** Run › Employees (3.8 §5.3): search, filters, selection for bulk recalculate or hold; row → sheet (§5.4). */
export function EmployeesTab({ initialFilter }: { initialFilter?: EmployeeFilter | null }) {
  const { run, me, version, startCalculation, calculating } = useRun();
  const sheet = useModalRoute("employee", { keys: ["employee"] });
  const hold = useHoldRoute();
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const [filter, setFilter] = useState<EmployeeFilter | "">(initialFilter ?? "");
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<Map<number, RunEmployeeRow>>(new Map());
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);
  const params = useMemo(() => ({ search: search.trim() || undefined, filter: filter || undefined, skip, limit: LIMIT }), [search, filter, skip]);
  const { data, error, loading, reload } = useApi(() => runsApi.employees(run.id, params), [run.id, params, version]);
  useEffect(() => setSelected(new Map()), [version]);

  const recalc = hasAction(run, "RECALCULATE");
  const holdable = canHold(me, run);
  const selectable = recalc || holdable;
  const rows = data?.items;
  const toggle = (row: RunEmployeeRow) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  const pageIds = (rows ?? []).filter((r) => r.status !== "EXCLUDED").map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const columns: Column<RunEmployeeRow>[] = [
    ...(selectable
      ? [
          {
            key: "select",
            header: (
              <input
                type="checkbox"
                className="h-4 w-4"
                aria-label="Select all on this page"
                checked={allOnPage}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Map(current);
                    (rows ?? []).filter((r) => r.status !== "EXCLUDED").forEach((r) => (allOnPage ? next.delete(r.id) : next.set(r.id, r)));
                    return next;
                  })
                }
              />
            ),
            hideInCard: true,
            className: "w-10",
            cell: (r: RunEmployeeRow) =>
              r.status === "EXCLUDED" ? null : (
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="inline-flex min-h-[44px] items-center">
                  <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.employee_name ?? r.employee_id}`} checked={selected.has(r.id)} onChange={() => toggle(r)} />
                </span>
              ),
          } satisfies Column<RunEmployeeRow>,
        ]
      : []),
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium">{r.employee_name ?? `Employee #${r.employee_id}`}</p>
          {r.employee_code && <p className="text-xs text-muted-foreground">{r.employee_code}</p>}
        </div>
      ),
    },
    { key: "gross", header: "Gross", className: "text-end", cell: (r) => <MoneyText money={r.gross} /> },
    { key: "deductions", header: "Deductions", className: "text-end", hideOnMobile: true, cell: (r) => <MoneyText money={r.deductions} negativeCue={false} /> },
    { key: "net", header: "Net", className: "text-end", cell: (r) => <MoneyText money={r.net} emphasis /> },
    { key: "change", header: "Δ vs previous", className: "text-end", hideOnMobile: true, cell: (r) => <ChangeText value={r.net_change_percent} /> },
    {
      key: "flags",
      header: "Flags",
      cell: (r) => (
        <span className="flex flex-wrap gap-1 text-xs">
          {r.variance_pending && <span className="rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning">⚑ variance</span>}
          {r.exceptions.blocking > 0 && <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">{r.exceptions.blocking} blocking</span>}
          {r.flags
            .filter((f) => !["NET_VARIANCE", "COMPONENT_VARIANCE"].includes(f))
            .slice(0, 3)
            .map((f) => (
              <span key={f} className="rounded-full bg-muted px-2 py-0.5">
                {humanize(f)}
              </span>
            ))}
          {r.error?.message && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">{r.error.code ?? "Error"}</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <EmployeeStatusChip status={r.status} holdType={r.hold_type} />
          {r.exclusion_reason && <span className="text-xs text-muted-foreground">{EXCLUSION_LABELS[r.exclusion_reason] ?? humanize(r.exclusion_reason)}</span>}
        </span>
      ),
    },
  ];

  const chosen = Array.from(selected.values());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={(v) => (setQ(v), setSkip(0))} placeholder="Search name or code" className="w-full sm:w-72" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter employees">
          <FilterChip active={!filter} onClick={() => (setFilter(""), setSkip(0))} label="All" />
          {EMPLOYEE_FILTERS.map((f) => (
            <FilterChip key={f} active={filter === f} onClick={() => (setFilter(filter === f ? "" : f), setSkip(0))} label={FILTER_LABELS[f]} count={data?.counts?.[f]} />
          ))}
        </div>
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{chosen.length} selected</span>
          {recalc && (
            <Button size="sm" className="min-h-[44px]" disabled={calculating} onClick={() => void startCalculation(chosen.map((r) => r.employee_id)).then(() => setSelected(new Map()))}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Recalculate selected
            </Button>
          )}
          {holdable && (
            <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => hold.openModal({ employee: chosen.filter((r) => !r.hold_type).map((r) => r.id).join(",") })}>
              <PauseCircle className="h-4 w-4" aria-hidden /> Hold selected
            </Button>
          )}
          <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setSelected(new Map())}>
            Clear
          </Button>
        </div>
      )}
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <>
          <DataTable
            caption="Employees in this run"
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(r) => r.id}
            onRowClick={(r) => sheet.openModal({ employee: r.id })}
            cardBelowMd
            stickyHeader
            empty={<EmptyState icon={<Users />} title={filter || search ? "Nobody matches" : "No employees in this run"} description={filter || search ? "Clear the search or filter." : "Run the pre-checks to build the population."} />}
          />
          {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium sm:min-h-[32px]", active ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-muted")}
    >
      {label}
      {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
}
