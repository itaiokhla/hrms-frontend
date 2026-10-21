"use client";

import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can, canAny } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { fmtDate } from "@/lib/format";

import { lookupsApi, overtimeApi, tasksApi, wageInputsApi } from "./api";
import { ImportCsvModal, recentImports } from "./ImportCsvModal";
import {
  DecisionModal,
  Decimal,
  FilterBar,
  Hours,
  LocalStatusChip,
  Notice,
  ReasonModal,
  WorkspaceHeader,
  errorText,
  useEmployeeDirectory,
} from "./shared";
import {
  OVERTIME_STATUSES,
  TASK_STATUSES,
  WAGE_INPUT_STATUSES,
  type OvertimeEntry,
  type PayGroupOption,
  type Task,
  type WageInput,
  type WageInputImport,
} from "./types";
import { WageInputModal } from "./WageInputModal";

const LIMIT = 50;
export const INPUT_TABS = ["one-time", "overtime", "tasks", "arrears", "imports"] as const;
type InputTab = (typeof INPUT_TABS)[number];

/** `?tab=` kept in the URL so a tab is bookmarkable; replace (not push) so Back leaves the page. */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("tab") as T | null;
  const tab = raw && allowed.includes(raw) ? raw : fallback;
  const setTab = useCallback(
    (t: T) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      next.set("tab", t);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [search, router, pathname],
  );
  return [tab, setTab];
}

export function usePayGroups(): PayGroupOption[] {
  const { me } = useCan();
  const allowed = canAny(me, [P.ORG_READ, P.ORG_MANAGE_DIMENSIONS, P.PAYROLL_CONFIGURATION_READ]);
  const { data } = useApi(() => lookupsApi.payGroups(), [], { enabled: allowed });
  return (data ?? []).filter((g) => g.status !== "ARCHIVED");
}

export interface InputFilters {
  period: string;
  entity: string;
  payGroup: string;
  status: string;
  component: string;
}

/** Shared filter bar (3.8 §5.5): period, entity, pay group, status, component. */
function InputFilterBar({
  filters,
  onChange,
  statuses,
  vocabulary,
  payGroups,
  show = { period: true, entity: true, payGroup: true, status: true, component: true },
}: {
  filters: InputFilters;
  onChange: (f: InputFilters) => void;
  statuses: readonly string[];
  vocabulary: (code: string) => string;
  payGroups: PayGroupOption[];
  show?: Partial<Record<keyof InputFilters, boolean>>;
}) {
  const entities = Array.from(new Set(payGroups.map((g) => g.legal_entity_id).filter((v): v is number => !!v)));
  const groups = filters.entity ? payGroups.filter((g) => String(g.legal_entity_id) === filters.entity) : payGroups;
  const set = (k: keyof InputFilters, v: string) => onChange({ ...filters, [k]: v, ...(k === "entity" ? { payGroup: "" } : {}) });
  return (
    <FilterBar>
      {show.period && (
        <Field label="Period starting" className="w-44">
          <Input type="date" value={filters.period} onChange={(e) => set("period", e.target.value)} />
        </Field>
      )}
      {show.entity && entities.length > 0 && (
        <Field label="Entity" className="w-44">
          <Select value={filters.entity} onChange={(e) => set("entity", e.target.value)}>
            <option value="">All entities</option>
            {entities.map((id) => (
              <option key={id} value={id}>
                Legal entity {id}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.payGroup && groups.length > 0 && (
        <Field label="Pay group" className="w-48">
          <Select value={filters.payGroup} onChange={(e) => set("payGroup", e.target.value)}>
            <option value="">All pay groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.status && (
        <Field label="Status" className="w-48">
          <Select value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {vocabulary(s)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.component && (
        <Field label="Component" className="w-40">
          <Input value={filters.component} placeholder="BONUS" maxLength={40} onChange={(e) => set("component", e.target.value.toUpperCase())} />
        </Field>
      )}
    </FilterBar>
  );
}

const EMPTY_FILTERS: InputFilters = { period: "", entity: "", payGroup: "", status: "", component: "" };

/**
 * Payroll › Wage Inputs (3.8 §5.5): One-time · Overtime · Tasks · Arrears proposals · Imports, with
 * "Add wage input" (`?modal=wage-input`) and "Import CSV" (`?modal=import&type=wage-inputs`).
 */
export function WageInputsWorkspace() {
  const { me } = useCan();
  const [tab, setTab] = useTabParam<InputTab>(INPUT_TABS, "one-time");
  const [dirty, setDirty] = useState(false);
  const inputModal = useModalRoute("wage-input", { keys: ["id", "employee"], dirty });
  const importModal = useModalRoute("import", { keys: ["id", "type"] });
  const [refresh, setRefresh] = useState(0);
  const canEdit = can(me, P.PAYROLL_INPUTS_EDIT);
  const canImport = can(me, P.PAYROLL_INPUTS_IMPORT);

  return (
    <div>
      <WorkspaceHeader
        title="Wage Inputs"
        description="One-time pay and deductions, approved overtime and tasks waiting for a pay run, and CSV imports."
        actions={
          <>
            {canImport && (
              <Button variant="secondary" className="min-h-[44px]" onClick={() => importModal.openModal({ type: "wage-inputs" })}>
                <FileUp className="h-4 w-4" aria-hidden /> Import CSV
              </Button>
            )}
            {canEdit && (
              <Button className="min-h-[44px]" onClick={() => inputModal.openModal()}>
                <Plus className="h-4 w-4" aria-hidden /> Add wage input
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as InputTab)}
        tabs={[
          { value: "one-time", label: "One-time" },
          { value: "overtime", label: "Overtime" },
          { value: "tasks", label: "Tasks" },
          { value: "arrears", label: "Arrears proposals" },
          { value: "imports", label: "Imports" },
        ]}
      >
        <TabPanel value="one-time">
          <OneTimeTab refresh={refresh} onEdit={(id) => inputModal.openModal({ id })} onAdd={canEdit ? () => inputModal.openModal() : undefined} />
        </TabPanel>
        <TabPanel value="overtime">
          <OvertimeAwaitingTab />
        </TabPanel>
        <TabPanel value="tasks">
          <TasksUnpaidTab />
        </TabPanel>
        <TabPanel value="arrears">
          <ArrearsTab />
        </TabPanel>
        <TabPanel value="imports">
          <ImportsTab refresh={refresh} onOpen={(id) => importModal.openModal({ id, type: "wage-inputs" })} onImport={canImport ? () => importModal.openModal({ type: "wage-inputs" }) : undefined} />
        </TabPanel>
      </Tabs>

      <WageInputModal
        open={inputModal.open}
        onOpenChange={inputModal.onOpenChange}
        inputId={inputModal.id}
        employeeId={inputModal.param("employee") ? Number(inputModal.param("employee")) : null}
        onDirtyChange={setDirty}
        onSaved={() => setRefresh((n) => n + 1)}
      />
      <ImportCsvModal
        open={importModal.open}
        onOpenChange={importModal.onOpenChange}
        importId={importModal.id}
        canImport={canImport}
        onImported={() => setRefresh((n) => n + 1)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ One-time */

function OneTimeTab({ refresh, onEdit, onAdd }: { refresh: number; onEdit: (id: number) => void; onAdd?: () => void }) {
  const { me } = useCan();
  const router = useRouter();
  const payGroups = usePayGroups();
  const people = useEmployeeDirectory();
  const [filters, setFilters] = useState<InputFilters>(EMPTY_FILTERS);
  const [skip, setSkip] = useState(0);
  const [decision, setDecision] = useState<{ row: WageInput; kind: "approve" | "reject" } | null>(null);
  const [cancelRow, setCancelRow] = useState<WageInput | null>(null);
  const canEdit = can(me, P.PAYROLL_INPUTS_EDIT);
  const canApprove = can(me, P.PAYROLL_INPUTS_APPROVE);

  useEffect(() => setSkip(0), [filters]);
  const { data, error, loading, reload } = useApi(
    () =>
      wageInputsApi.list({
        status: filters.status,
        pay_group_id: filters.payGroup,
        period_start: filters.period,
        component_code: filters.component,
        skip,
        limit: LIMIT,
      }),
    [filters.status, filters.payGroup, filters.period, filters.component, skip, refresh],
  );
  // The API has no entity filter: an entity choice narrows the pay groups and this page's rows.
  const rows = useMemo(
    () => (data?.items ?? []).filter((r) => !filters.entity || String(r.legal_entity_id) === filters.entity),
    [data, filters.entity],
  );

  const submit = async (row: WageInput) => {
    try {
      const result = await wageInputsApi.submit(row.id);
      toast.success(result.status === "APPROVED" ? "Input submitted and approved automatically (below the approval threshold)." : "Input sent for approval.");
      void reload();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const columns: Column<WageInput>[] = [
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (r) => (
        <Link href={`/payroll/inputs/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {people.name(r.employee_id)}
        </Link>
      ),
    },
    { key: "component", header: "Component", cell: (r) => <span className="font-mono text-xs">{r.component_code}</span> },
    {
      key: "value",
      header: <span className="block text-end">Amount</span>,
      className: "text-end",
      cell: (r) =>
        r.amount ? (
          <MoneyText money={r.amount} />
        ) : (
          <span className="text-sm">
            <Decimal value={r.units} suffix="units" />
            {r.rate && (
              <>
                {" × "}
                <MoneyText amount={r.rate} currency={r.currency} />
              </>
            )}
          </span>
        ),
    },
    {
      key: "period",
      header: "Period",
      hideOnMobile: true,
      cell: (r) => (
        <span className="whitespace-nowrap text-sm">
          {fmtDate(r.target_period.start, "d MMM")} – {fmtDate(r.target_period.end, "d MMM yyyy")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusChip vocabulary="wage_input" code={r.status} />
          {r.flags.length > 0 && (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning" title={r.flags.map((f) => f.message ?? f.code).join("; ")}>
              {r.flags.length} flag{r.flags.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && r.status === "DRAFT" && (
            <>
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => onEdit(r.id)}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => submit(r)}>
                Submit
              </Button>
            </>
          )}
          {canApprove && r.status === "PENDING_APPROVAL" && (
            <>
              <Button size="sm" className="min-h-[44px]" onClick={() => setDecision({ row: r, kind: "approve" })}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecision({ row: r, kind: "reject" })}>
                Reject
              </Button>
            </>
          )}
          {canEdit && !r.reserved_by_run_employee_id && (r.status === "DRAFT" || r.status === "PENDING_APPROVAL" || r.status === "APPROVED") && (
            <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setCancelRow(r)}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <InputFilterBar
        filters={filters}
        onChange={setFilters}
        statuses={WAGE_INPUT_STATUSES}
        vocabulary={(s) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        payGroups={payGroups}
      />
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/payroll/inputs/${r.id}`)}
          cardBelowMd
          caption="One-time wage inputs"
          empty={
            <EmptyState
              title={Object.values(filters).some(Boolean) ? "No inputs match these filters" : "No wage inputs yet"}
              description="Bonuses, commissions, adjustments and deductions for one pay period appear here. Approved inputs are picked up by the next pay run."
              action={onAdd && <Button className="min-h-[44px]" onClick={onAdd}>Add wage input</Button>}
            />
          }
        />
      )}
      {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}

      {decision && (
        <DecisionModal
          open
          onOpenChange={(o) => !o && setDecision(null)}
          decision={decision.kind}
          subject={`${decision.row.component_code} for ${people.name(decision.row.employee_id)}`}
          summary={
            <div className="rounded-xl bg-muted/60 p-3 text-sm">
              {decision.row.amount ? <MoneyText money={decision.row.amount} emphasis /> : <Decimal value={decision.row.units} suffix="units" />}
              {decision.row.reason && <p className="mt-1 text-muted-foreground">{decision.row.reason}</p>}
            </div>
          }
          acknowledge={decision.row.flags.map((f) => f.message ?? f.code)}
          onReload={reload}
          onSubmit={async (remarks) => {
            if (decision.kind === "approve") await wageInputsApi.approve(decision.row.id, remarks);
            else await wageInputsApi.reject(decision.row.id, remarks);
            toast.success(decision.kind === "approve" ? "Input approved — the next pay run picks it up." : "Input rejected. The requester sees your reason.");
            void reload();
          }}
        />
      )}
      {cancelRow && (
        <ReasonModal
          open
          onOpenChange={(o) => !o && setCancelRow(null)}
          title="Cancel this input?"
          consequence="A cancelled input is never paid. To correct it, add a new input."
          confirmLabel="Cancel input"
          danger
          onReload={reload}
          onSubmit={async (reason) => {
            await wageInputsApi.cancel(cancelRow.id, reason);
            toast.success("Input cancelled.");
            void reload();
          }}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Overtime awaiting payroll */

function OvertimeAwaitingTab() {
  const [filters, setFilters] = useState<InputFilters>({ ...EMPTY_FILTERS, status: "APPROVED" });
  const [skip, setSkip] = useState(0);
  useEffect(() => setSkip(0), [filters]);
  const { data, error, loading, reload } = useApi(
    () => overtimeApi.list({ status: filters.status, start: filters.period, skip, limit: LIMIT }),
    [filters.status, filters.period, skip],
  );
  const columns: Column<OvertimeEntry>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (r) => <Link href={`/overtime/${r.id}`} className="font-medium hover:underline">{r.employee_name ?? `Employee #${r.employee_id}`}</Link> },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.date) },
    { key: "hours", header: "Hours", cell: (r) => <Hours minutes={r.minutes_approved ?? r.minutes_requested ?? r.minutes_computed} /> },
    { key: "bucket", header: "Day type", hideOnMobile: true, cell: (r) => (r.bucket ? r.bucket.replace("_", " ").toLowerCase() : "—") },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.consumed_by_run_employee_id ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">In a pay run</span>
        ) : (
          <LocalStatusChip vocabulary="overtime" code={r.status} />
        ),
    },
  ];
  if (error?.status === 403) return <Card><Notice tone="warning" title="Overtime isn't visible to your role">Viewing overtime needs overtime:request, overtime:approve or payroll:inputs:read.</Notice></Card>;
  return (
    <Card>
      <InputFilterBar
        filters={filters}
        onChange={setFilters}
        statuses={OVERTIME_STATUSES}
        vocabulary={(s) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        payGroups={[]}
        show={{ period: true, status: true }}
      />
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(r) => r.id}
          cardBelowMd
          caption="Overtime entries"
          empty={<EmptyState title="No overtime here" description="Approved overtime waiting for a pay run is listed here. Requests are filed and approved on the Overtime page." action={<Link href="/overtime" className="text-sm font-medium text-primary hover:underline">Open Overtime</Link>} />}
        />
      )}
      {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ Tasks approved and unpaid */

function TasksUnpaidTab() {
  const [filters, setFilters] = useState<InputFilters>({ ...EMPTY_FILTERS, status: "APPROVED" });
  const [skip, setSkip] = useState(0);
  useEffect(() => setSkip(0), [filters]);
  const { data, error, loading, reload } = useApi(() => tasksApi.list({ status: filters.status, skip, limit: LIMIT }), [filters.status, skip]);
  // The tasks API has no period filter: the period narrows this page by approval date.
  const rows = useMemo(() => (data?.items ?? []).filter((t) => !filters.period || (t.approved_on ?? "") >= filters.period), [data, filters.period]);

  if (error?.code === "TASKS_DISABLED") {
    return (
      <Card>
        <Notice title="The tasks module is turned off">Task pay is tracked only when Settings › Payroll › Task pay turns tasks on for your company.</Notice>
      </Card>
    );
  }
  if (error?.status === 403) {
    return (
      <Card>
        <Notice tone="warning" title="Tasks aren't visible to your role">Viewing tasks needs task:read, task:manage or task:approve.</Notice>
      </Card>
    );
  }
  const columns: Column<Task>[] = [
    { key: "title", header: "Task", primary: true, cell: (t) => <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link> },
    { key: "assignees", header: "Assignees", cell: (t) => t.assignees.map((a) => a.employee_name ?? `#${a.employee_id}`).join(", ") },
    { key: "qty", header: "Accepted", cell: (t) => <Decimal value={t.accepted_quantity ?? t.quantity} suffix={t.unit} /> },
    { key: "rate", header: <span className="block text-end">Rate</span>, className: "text-end", hideOnMobile: true, cell: (t) => <MoneyText money={t.rate} /> },
    { key: "approved", header: "Approved on", cell: (t) => fmtDate(t.approved_on) },
    { key: "status", header: "Status", cell: (t) => <StatusChip vocabulary="task" code={t.status} /> },
  ];
  return (
    <Card>
      <InputFilterBar
        filters={filters}
        onChange={setFilters}
        statuses={TASK_STATUSES}
        vocabulary={(s) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        payGroups={[]}
        show={{ period: true, status: true }}
      />
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(t) => t.id}
          cardBelowMd
          caption="Approved tasks"
          empty={<EmptyState title="No approved tasks waiting for pay" description="Tasks approved by managers appear here until a finalized pay run pays them." />}
        />
      )}
      {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ Arrears proposals */

/** No corrections / arrears-proposals API exists yet (3.4 §17): say so instead of showing an empty list. */
function ArrearsTab() {
  return (
    <Card className="p-2">
      <EmptyState
        title="Arrears proposals are not available yet"
        description="Proposals appear when a back-dated salary change or a correction to a finalized run creates arrears. The corrections service that produces them isn't connected yet. Until then, enter arrears as a one-time wage input."
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ Imports */

function ImportsTab({ refresh, onOpen, onImport }: { refresh: number; onOpen: (id: number) => void; onImport?: () => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [rows, setRows] = useState<WageInputImport[] | undefined>(undefined);
  const [lookup, setLookup] = useState("");
  useEffect(() => setIds(recentImports()), [refresh]);
  useEffect(() => {
    let live = true;
    if (!ids.length) {
      setRows([]);
      return;
    }
    Promise.all(ids.map((id) => wageInputsApi.getImport(id).catch(() => null))).then((found) => {
      if (live) setRows(found.filter((r): r is WageInputImport => !!r));
    });
    return () => {
      live = false;
    };
  }, [ids]);

  const columns: Column<WageInputImport>[] = [
    { key: "file", header: "File", primary: true, cell: (r) => <Link href={`/payroll/inputs/imports/${r.id}`} className="font-medium hover:underline">{r.file_name}</Link> },
    { key: "rows", header: "Rows", cell: (r) => <span className="tabular-nums">{r.row_count} ({r.error_count} with errors)</span> },
    { key: "status", header: "Status", cell: (r) => <LocalStatusChip vocabulary="import" code={r.status} /> },
    { key: "when", header: "Uploaded", hideOnMobile: true, cell: (r) => fmtDate(r.created_at, "d MMM yyyy, h:mm a") },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Field label="Open import number" className="w-44">
          <Input inputMode="numeric" value={lookup} onChange={(e) => setLookup(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button variant="secondary" className="min-h-[44px]" disabled={!lookup} onClick={() => onOpen(Number(lookup))}>
          Open
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          Shows the imports opened in this browser. A company-wide import history needs an imports list from the server, which isn&apos;t available yet.
        </p>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        loading={rows === undefined}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r.id)}
        cardBelowMd
        caption="Recent imports"
        empty={<EmptyState title="No imports in this browser yet" description="Upload a CSV of bonuses, commissions or deductions; every row is checked before anything is created." action={onImport && <Button className="min-h-[44px]" onClick={onImport}>Import CSV</Button>} />}
      />
    </Card>
  );
}
