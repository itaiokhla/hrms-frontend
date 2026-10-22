"use client";

import { ListChecks, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCan } from "@/components/access/Can";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import { VOCABULARIES } from "@/lib/payroll/catalogues.generated";
import { RUN_STAGES } from "@/lib/payroll/labels";

import { runsApi } from "./api";
import { NewRunModal } from "./NewRunModal";
import { MoneyStack, RUN_TYPE_LABELS, WorkspaceHeader, canCreateRuns, figureByCurrency, periodLabel, useLookups } from "./shared";
import type { Run } from "./types";

const LIMIT = 50;
/** Actions that are a decision or a step for the viewer ("Needs my action"); server-computed per user. */
export const MY_ACTIONS = new Set([
  "PRECHECK_PASSED",
  "PRECHECK_BLOCKED",
  "CALCULATE",
  "SUBMIT_FOR_APPROVAL",
  "APPROVE_STEP",
  "APPROVE_FINAL",
  "FINALIZE",
  "REWORK",
  "RESUME_REVIEW",
  "APPROVE_PAYMENTS",
  "SUBMIT_PAYMENTS",
  "RECONCILE",
  "CLOSE",
]);

export function needsMyAction(run: Run): boolean {
  return run.available_actions.some((a) => MY_ACTIONS.has(a));
}

export function stageText(run: Pick<Run, "stage">): string {
  if (!run.stage) return "—";
  const stage = RUN_STAGES.find((s) => s.stage === run.stage);
  return `${run.stage} of ${RUN_STAGES.length} · ${stage?.label ?? ""}`;
}

/** Pay Runs list (3.8 §5.2). */
export function RunsList() {
  const router = useRouter();
  const { me } = useCan();
  const lookups = useLookups();
  const newRun = useModalRoute("new-run", { keys: ["pay_group"] });
  const [entity, setEntity] = useState("");
  const [group, setGroup] = useState("");
  const [period, setPeriod] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [skip, setSkip] = useState(0);
  const groupNumber = Number(group) || 0;
  const periods = useApi(() => runsApi.periods(groupNumber), [groupNumber], { enabled: groupNumber > 0 });

  const params = useMemo(
    () => ({
      legal_entity_id: entity,
      pay_group_id: group,
      pay_period_id: period,
      run_type: type,
      status,
      // "Needs my action" filters the newest 200 runs on the client: the API has no such filter.
      skip: mine ? 0 : skip,
      limit: mine ? 200 : LIMIT,
    }),
    [entity, group, period, type, status, skip, mine],
  );
  const { data, error, loading, reload } = useApi(() => runsApi.list(params), [params]);
  const rows = useMemo(() => (mine ? (data?.items ?? []).filter(needsMyAction) : data?.items), [data, mine]);
  const reset = () => setSkip(0);

  const columns: Column<Run>[] = [
    {
      key: "label",
      header: "Pay run",
      primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium">{r.label}</p>
          <p className="text-xs text-muted-foreground">{r.pay_group.name}</p>
        </div>
      ),
    },
    { key: "number", header: "Number", cell: (r) => <bdi dir="ltr" className="font-mono text-xs">{r.number}</bdi> },
    { key: "period", header: "Period", cell: (r) => periodLabel(r.period) },
    { key: "type", header: "Type", hideOnMobile: true, cell: (r) => RUN_TYPE_LABELS[r.run_type] ?? r.run_type },
    { key: "employees", header: "Employees", className: "text-end", cell: (r) => <span className="tabular-nums">{r.population?.included ?? "—"}</span> },
    { key: "net", header: "Net", className: "text-end", cell: (r) => <MoneyStack amounts={figureByCurrency(r.totals, "net")} empty="Not calculated" /> },
    { key: "status", header: "Status", cell: (r) => <StatusChip vocabulary="run" code={r.status} /> },
    { key: "stage", header: "Stage", hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{stageText(r)}</span> },
    {
      key: "updated",
      header: "Created",
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{r.created_at ? r.created_at.slice(0, 10) : "—"}</span>,
    },
  ];

  const create = canCreateRuns(me);
  const filtered = !!(entity || group || period || type || status || mine);

  return (
    <div>
      <WorkspaceHeader
        title="Pay Runs"
        description="Every run of every pay group in your scope. Open one to calculate, review, approve and finalize it."
        actions={
          create && (
            <Button onClick={() => newRun.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> New pay run
            </Button>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Filters">
          <Field label="Legal entity">
            <Select value={entity} onChange={(e) => (setEntity(e.target.value), setGroup(""), setPeriod(""), reset())}>
              <option value="">All entities</option>
              {lookups.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legal_name || e.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pay group">
            <Select value={group} onChange={(e) => (setGroup(e.target.value), setPeriod(""), reset())}>
              <option value="">All pay groups</option>
              {lookups.payGroups
                .filter((g) => !entity || String(g.legal_entity_id) === entity)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Period" hint={!groupNumber ? "Choose a pay group to filter by period." : undefined}>
            <Select value={period} disabled={!groupNumber} onChange={(e) => (setPeriod(e.target.value), reset())}>
              <option value="">All periods</option>
              {(periods.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => (setType(e.target.value), reset())}>
              <option value="">All types</option>
              {Object.entries(RUN_TYPE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => (setStatus(e.target.value), reset())}>
              <option value="">All statuses</option>
              {Object.entries(VOCABULARIES.run.states).map(([code, entry]) => (
                <option key={code} value={code}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <label className="flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl border border-border px-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(e) => (setMine(e.target.checked), reset())} />
              Needs my action
            </label>
          </div>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <>
            <DataTable
              caption="Pay runs"
              columns={columns}
              rows={rows}
              loading={loading}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/payroll/runs/${r.id}`)}
              cardBelowMd
              empty={
                <EmptyState
                  icon={<ListChecks />}
                  title={filtered ? "No runs match these filters" : "No pay runs yet"}
                  description={
                    mine
                      ? "Nothing in the newest 200 runs waits for you."
                      : filtered
                        ? "Clear a filter to see more runs."
                        : create
                          ? "Create the first regular run of a pay group once salaries are assigned."
                          : "Runs appear here once payroll creates them."
                  }
                  action={
                    !filtered && create ? (
                      <Button onClick={() => newRun.openModal()}>
                        <Plus className="h-4 w-4" aria-hidden /> New pay run
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
            {!mine && data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
          </>
        )}
      </Card>
      {create && <NewRunModal />}
    </div>
  );
}
