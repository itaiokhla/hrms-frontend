"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DetailGate, NotFoundState, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { ColumnChooser } from "@/components/shared/ColumnChooser";
import { FilterBar } from "@/components/shared/FilterBar";
import { FormHost, FormPage } from "@/components/shared/FormHost";
import { SavedViews, ViewActions } from "@/components/shared/SavedViews";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs, type Column } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { can, canBeyondSelf } from "@/lib/access";
import { ATTENDANCE_TABS, isIdSegment, visibleTabs } from "@/lib/attendance-routes";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { savedViewsApi } from "@/lib/savedViews";
import type { Shift, ShiftDetail, ShiftRule } from "@/lib/types";
import { PAGE_SIZES, useListQuery } from "@/lib/useListQuery";
import { useModalRoute } from "@/lib/useModalRoute";
import { useTabParam } from "@/lib/useTabParam";

import { shiftsApi } from "./api";
import { AssignmentRuleForm, RuleView, useOrgOptions, useShiftOptions } from "./AssignmentRuleForm";
import { BulkAssignModal } from "./BulkAssignModal";
import { ShiftChip } from "./ShiftChip";
import { ShiftExplainSheet } from "./ShiftExplainSheet";
import { ShiftErrorNotice, ShiftForm } from "./ShiftForm";
import { SHIFT_KINDS, breaksSummary, criteriaChips, fmtMinutes, kindLabel, priorityBand, timesLabel, versionNetMinutes } from "./shiftModel";
import { ShiftVersionModal } from "./ShiftVersionModal";
import { ShiftVersionTimeline, versionRange } from "./ShiftVersionTimeline";

type MainTab = "catalogue" | "rules";

const CATALOGUE_FILTERS = ["kind", "status"] as const;
const CATALOGUE_SORTS = ["code", "name", "kind", "status"] as const;
const OPTIONAL_COLUMNS = [
  { key: "name", label: "Name" }, { key: "kind", label: "Kind" }, { key: "times", label: "Times today" },
  { key: "net", label: "Net" }, { key: "breaks", label: "Breaks" }, { key: "owner", label: "Owner" },
  { key: "version", label: "Version" }, { key: "status", label: "Status" },
];
const RULE_FILTERS = ["shift_id", "status"] as const;

function ownerLabel(s: Pick<Shift, "legal_entity_id" | "branch_id">, name: (d: string, id: number) => string | undefined): string {
  if (s.branch_id) return name("branch_ids", s.branch_id) ?? `Branch #${s.branch_id}`;
  if (s.legal_entity_id) return name("legal_entity_ids", s.legal_entity_id) ?? `Entity #${s.legal_entity_id}`;
  return "Whole company";
}

const statusText = (status?: string) => (status === "ARCHIVED" ? "Archived" : "Active");

/* ------------------------------------------------------------------ shift detail (Sheet body and page twin) */

type Pane = "details" | "versions" | "rules";

/** Details · Versions · Rules of one shift (§17.2; D-X-27 order). */
export function ShiftView({ shift, pane, onPane, canRules }: { shift: ShiftDetail; pane: Pane; onPane: (p: Pane) => void; canRules: boolean }) {
  const org = useOrgOptions();
  const v = shift.current_version;
  const rules = useApi(() => (pane === "rules" && canRules ? shiftsApi.rules({ shift_id: shift.id, limit: 50 }) : Promise.resolve(null)), [pane, shift.id, canRules]);
  const tabs = [{ value: "details", label: "Details" }, { value: "versions", label: `Versions (${shift.versions.length})` },
    ...(canRules ? [{ value: "rules", label: "Rules" }] : [])];
  return (
    <Tabs tabs={tabs} value={pane} onValueChange={(p) => onPane(p as Pane)}>
      <TabPanel value="details">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Code</dt><dd className="mt-1"><ShiftChip code={shift.code} color={shift.color_token} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Kind</dt><dd className="mt-1">{kindLabel(shift.kind)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Times in force today</dt>
            <dd className="mt-1">{timesLabel(v?.start_time ?? shift.start_time, v?.end_time ?? shift.end_time, shift.kind)}{v?.anchor_timezone ? ` ${v.anchor_timezone}` : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Net scheduled</dt><dd className="mt-1">{fmtMinutes(versionNetMinutes(v, shift.kind))}</dd></div>
          {v?.core_start_time && <div><dt className="text-xs text-muted-foreground">Core hours</dt><dd className="mt-1">{v.core_start_time}–{v.core_end_time}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">Breaks</dt><dd className="mt-1">{breaksSummary(v?.break_rules, v?.unpaid_break_minutes)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1">{ownerLabel(shift, org.name)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Used by</dt><dd className="mt-1">{shift.usage.rules} rules · {shift.usage.placements} placements</dd></div>
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{statusText(shift.status)}</dd></div>
          {v && <div><dt className="text-xs text-muted-foreground">Version in force</dt><dd className="mt-1">v{v.version_no} · {versionRange(v)}</dd></div>}
          {shift.description && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Description</dt><dd className="mt-1">{shift.description}</dd></div>}
        </dl>
      </TabPanel>
      <TabPanel value="versions">
        <ShiftVersionTimeline versions={shift.versions} today={shift.owner_today} kind={shift.kind} />
      </TabPanel>
      {canRules && (
        <TabPanel value="rules">
          {rules.error ? <ShiftErrorNotice error={rules.error} /> : !rules.data ? <p className="text-sm text-muted-foreground">Loading…</p>
            : rules.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No rules assign this shift.</p> : (
              <ul className="space-y-2 text-sm">
                {rules.data.items.map((r) => (
                  <li key={r.id} className="rounded-xl border border-border px-3 py-2">
                    <Link href={`/attendance/shift-rules/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <p className="text-muted-foreground">Priority {r.priority} · {criteriaChips(r.criteria, org.name).join(", ")} · {fmtDate(r.effective_from)} – {r.effective_to ? fmtDate(r.effective_to) : "open-ended"}</p>
                  </li>
                ))}
              </ul>
            )}
        </TabPanel>
      )}
    </Tabs>
  );
}

/** Footer / header actions of a shift: change times, assign, archive or restore (`shift:manage` / `shift:assign`). */
function ShiftActions({ shift, onChanged }: { shift: ShiftDetail; onChanged: () => void }) {
  const { me } = useCan();
  const confirm = useConfirm();
  const version = useModalRoute("shift-version", { keys: ["id"] });
  const bulk = useModalRoute("shift-bulk", { keys: ["shift"] });
  const manage = can(me, P.SHIFT_MANAGE) || can(me, P.DEPARTMENT_MANAGE);
  const archived = shift.status === "ARCHIVED";
  const toggle = async () => {
    const ok = await confirm({ title: archived ? `Restore ${shift.code}?` : `Archive ${shift.code}?`,
      message: archived ? "It can be assigned again." : "It can no longer be assigned. People already on it keep it until their rules or placements change.",
      confirmLabel: archived ? "Restore" : "Archive", tone: archived ? "primary" : "danger" });
    if (!ok) return;
    try {
      if (archived) await shiftsApi.restore(shift.id, shift.row_version);
      else await shiftsApi.archive(shift.id, shift.row_version);
      toast.success(archived ? "Shift restored." : "Shift archived.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the shift.");
    }
  };
  return (
    <>
      {manage && <Button variant="ghost" onClick={() => void toggle()}>{archived ? "Restore" : "Archive"}</Button>}
      {can(me, P.SHIFT_ASSIGN) && !archived && <Button variant="secondary" onClick={() => bulk.openModal({ shift: shift.id })}>Assign to people…</Button>}
      {manage && !archived && <Button variant="secondary" onClick={() => version.openModal({ id: shift.id })}>Change times from a date…</Button>}
    </>
  );
}

/* ------------------------------------------------------------------ catalogue list */

function CatalogueList({ refresh, onOpen }: { refresh: number; onOpen: (id: number) => void }) {
  const list = useListQuery({ filters: CATALOGUE_FILTERS, sortKeys: CATALOGUE_SORTS });
  const views = useApi(() => savedViewsApi.list("shift.shifts"), []);
  const org = useOrgOptions();
  const [columns, setColumns] = useState<string[]>(OPTIONAL_COLUMNS.map((c) => c.key));
  const { data, error, loading, reload } = useApi(() => shiftsApi.list(list.params), [JSON.stringify(list.params), refresh]);
  const active = list.view;
  const stored = [...(views.data?.system_views ?? []), ...(views.data?.views ?? [])].find((v) => String(v.id) === active)?.query;
  const currentQuery: Record<string, unknown> = {
    ...list.filters, ...(list.q ? { q: list.q } : {}), ...(list.sort ? { sort: list.sort } : {}),
    ...(list.limit !== 25 ? { limit: list.limit } : {}), columns,
  };
  const modified = !!active && !!stored && JSON.stringify({ ...stored, columns: undefined }) !== JSON.stringify({ ...currentQuery, columns: undefined });
  const chips = Object.entries(list.filters).map(([key, value]) => ({
    key, label: key === "kind" ? "Kind" : "Status",
    values: (Array.isArray(value) ? value : [value]).map((v) => (key === "kind" ? kindLabel(v) : v === "ALL" ? "All" : statusText(v))),
  }));
  const table: Column<Shift>[] = [
    { key: "code", header: "Code", primary: true, hideable: false, sortKey: "code", cell: (s) => <ShiftChip code={s.code ?? s.name} color={s.color_token} /> },
    { key: "name", header: "Name", sortKey: "name", cell: (s) => s.name },
    { key: "kind", header: "Kind", sortKey: "kind", cell: (s) => kindLabel(s.kind) },
    { key: "times", header: "Times today", cell: (s) => {
      const v = s.current_version;
      const label = timesLabel(v?.start_time ?? s.start_time, v?.end_time ?? s.end_time, s.kind);
      return <span>{label.replace(" (+1)", "")}{label.endsWith("(+1)") && <span className="ms-1 rounded border border-border px-1 text-xs">+1 next day</span>}</span>;
    } },
    { key: "net", header: "Net", hideOnMobile: true, cell: (s) => fmtMinutes(versionNetMinutes(s.current_version, s.kind)) },
    { key: "breaks", header: "Breaks", hideOnMobile: true, cell: (s) => breaksSummary(s.current_version?.break_rules, s.unpaid_break_minutes) },
    { key: "owner", header: "Owner", hideOnMobile: true, cell: (s) => ownerLabel(s, org.name) },
    { key: "version", header: "Version", hideOnMobile: true, cell: (s) => (s.current_version ? `v${s.current_version.version_no}` : "—") },
    { key: "status", header: "Status", sortKey: "status", cell: (s) => statusText(s.status) },
  ];
  return (
    <Card>
      <FilterBar
        views={<SavedViews data={views.data} active={active} modified={modified} onSelect={(id, query) => {
          list.selectView(id, query);
          if (query && Array.isArray(query.columns)) setColumns(query.columns as string[]);
        }} />}
        search={{ value: list.qInput, onChange: list.setQ, label: "Search code or name", placeholder: "Search code or name…" }}
        tools={<ColumnChooser columns={OPTIONAL_COLUMNS} visible={columns} onChange={setColumns} defaults={OPTIONAL_COLUMNS.map((c) => c.key)} />}
        chips={chips}
        onRemoveChip={(key) => list.setFilter(key, null)}
        onClearAll={list.clearFilters}
        resultCount={data?.total}
        chipsEnd={<ViewActions listKey="shift.shifts" data={views.data} active={active} query={currentQuery}
          onReset={() => list.selectView(active ?? null, stored)}
          onSaved={(view) => { void views.reload(); list.selectView(String(view.id), view.query); }} />}
      >
        <Field label="Kind" className="w-40">
          <Select value={(list.filters.kind as string) ?? ""} onChange={(e) => list.setFilter("kind", e.target.value || null)}>
            <option value="">All kinds</option>
            {SHIFT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Status" className="w-40">
          <Select value={(list.filters.status as string) ?? ""} onChange={(e) => list.setFilter("status", e.target.value || null)}>
            <option value="">Active</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All</option>
          </Select>
        </Field>
      </FilterBar>
      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <DataTable columns={table} visibleColumns={columns} rows={data?.items} loading={loading && !data} busy={loading && !!data}
          rowKey={(s) => s.id} sort={list.sort} onSortChange={list.setSort}
          rowHref={(s) => `/attendance/shifts?modal=shift&id=${s.id}`} onRowClick={(s) => onOpen(s.id)}
          cardBelowMd caption="Shifts"
          empty={<EmptyState title="No shifts found" description="Try another view or clear the filters." />} />
      )}
      {data && <Pagination total={data.total} skip={list.skip} limit={list.limit} onChange={list.setSkip}
        pageSizes={[...PAGE_SIZES]} onLimitChange={list.setLimit} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ rules list */

function RulesList({ refresh, onOpen, shifts }: { refresh: number; onOpen: (id: number) => void; shifts: Map<number, Shift> }) {
  const list = useListQuery({ filters: RULE_FILTERS, sortKeys: [] });
  const views = useApi(() => savedViewsApi.list("shift.rules"), []);
  const org = useOrgOptions();
  const { data, error, loading, reload } = useApi(() => shiftsApi.rules(list.params), [JSON.stringify(list.params), refresh]);
  const active = list.view;
  const stored = [...(views.data?.system_views ?? []), ...(views.data?.views ?? [])].find((v) => String(v.id) === active)?.query;
  const currentQuery: Record<string, unknown> = { ...list.filters, ...(list.limit !== 25 ? { limit: list.limit } : {}) };
  const chips = Object.entries(list.filters).map(([key, value]) => ({
    key, label: key === "shift_id" ? "Shift" : "Status",
    values: (Array.isArray(value) ? value : [value]).map((v) => (key === "shift_id" ? shifts.get(Number(v))?.code ?? v : v === "ACTIVE" ? "Active" : "Paused")),
  }));
  const table: Column<ShiftRule>[] = [
    { key: "name", header: "Name", primary: true, hideable: false, cell: (r) => r.name },
    { key: "shift", header: "Shift", cell: (r) => { const s = shifts.get(r.shift_id); return s ? <ShiftChip code={s.code ?? s.name} color={s.color_token} /> : `#${r.shift_id}`; } },
    { key: "criteria", header: "Who", hideOnMobile: true, cell: (r) => {
      const chipsText = criteriaChips(r.criteria, org.name);
      return `${chipsText.slice(0, 2).join(", ")}${chipsText.length > 2 ? ` +${chipsText.length - 2} more` : ""}`;
    } },
    { key: "priority", header: "Priority", cell: (r) => `${r.priority} · ${priorityBand(r.priority)}` },
    { key: "dates", header: "Effective", hideOnMobile: true, cell: (r) => `${fmtDate(r.effective_from)} – ${r.effective_to ? fmtDate(r.effective_to) : "open-ended"}` },
    { key: "status", header: "Status", cell: (r) => (r.status === "ACTIVE" ? "Active" : "Paused") },
  ];
  return (
    <Card>
      <FilterBar
        views={<SavedViews data={views.data} active={active} modified={false} onSelect={(id, query) => list.selectView(id, query)} />}
        chips={chips} onRemoveChip={(key) => list.setFilter(key, null)} onClearAll={list.clearFilters} resultCount={data?.total}
        chipsEnd={<ViewActions listKey="shift.rules" data={views.data} active={active} query={currentQuery}
          onReset={() => list.selectView(active ?? null, stored)}
          onSaved={(view) => { void views.reload(); list.selectView(String(view.id), view.query); }} />}
      >
        <Field label="Shift" className="w-48">
          <Select value={(list.filters.shift_id as string) ?? ""} onChange={(e) => list.setFilter("shift_id", e.target.value || null)}>
            <option value="">All shifts</option>
            {[...shifts.values()].map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Status" className="w-40">
          <Select value={(list.filters.status as string) ?? ""} onChange={(e) => list.setFilter("status", e.target.value || null)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Paused</option>
          </Select>
        </Field>
      </FilterBar>
      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <DataTable columns={table} rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(r) => r.id}
          rowHref={(r) => `/attendance/shifts?tab=rules&modal=shift-rule&id=${r.id}`} onRowClick={(r) => onOpen(r.id)}
          cardBelowMd caption="Assignment rules"
          empty={<EmptyState title="No assignment rules" description="Rules give a shift to people by branch, department or name." />} />
      )}
      {data && <Pagination total={data.total} skip={list.skip} limit={list.limit} onChange={list.setSkip}
        pageSizes={[...PAGE_SIZES]} onLimitChange={list.setLimit} />}
    </Card>
  );
}

/** `pane` of an open Sheet (FormHost keeps it in its keys, so closing clears it). */
function usePaneParam(): [Pane, (p: Pane) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("pane");
  const pane: Pane = raw === "versions" || raw === "rules" ? raw : "details";
  const set = useCallback((p: Pane) => {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (p === "details") next.delete("pane");
    else next.set("pane", p);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [search, router, pathname]);
  return [pane, set];
}

/* ------------------------------------------------------------------ workspace */

/**
 * `/attendance/shifts` (§17.1, 09-ui-ux/02 §8.1): tabs Shifts (`shift.shifts`) and Assignment rules (`shift.rules`);
 * rows open the right-side Sheet (`?modal=shift&id=`), "New shift" opens the same `ShiftForm` in a Modal; header
 * actions "Which shift applies?" and "Bulk assign…".
 */
export function ShiftsWorkspace() {
  const { me } = useCan();
  const tabs = visibleTabs(ATTENDANCE_TABS["/attendance/shifts"], me);
  const values = tabs.map((t) => t.value as MainTab);
  const [tab, setTab] = useTabParam<MainTab>(values.length ? values : ["catalogue"], values[0] ?? "catalogue");
  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);
  const search = useSearchParams();
  const [pane, setPane] = usePaneParam();
  const shiftRoute = useModalRoute("shift", { keys: ["id", "mode", "pane"] });
  const ruleRoute = useModalRoute("shift-rule", { keys: ["id", "mode", "pane"] });
  const explain = useModalRoute("explain-resolution", { keys: ["kind", "employee_id", "date"] });
  const bulk = useModalRoute("shift-bulk", { keys: ["shift"] });
  const manage = can(me, P.SHIFT_MANAGE) || can(me, P.DEPARTMENT_MANAGE);
  const assign = can(me, P.SHIFT_ASSIGN);
  const canRules = tabs.some((t) => t.value === "rules");
  const all = useShiftOptions("ALL");
  const org = useOrgOptions();

  const sheetId = search?.get("modal") === "shift" ? search.get("id") : null;
  const sheet = useApi(() => (sheetId ? shiftsApi.get(sheetId) : Promise.resolve(null)), [sheetId, refresh]);
  const ruleId = search?.get("modal") === "shift-rule" ? search.get("id") : null;
  const rule = useApi(() => (ruleId ? shiftsApi.rule(ruleId) : Promise.resolve(null)), [ruleId, refresh]);

  return (
    <div>
      <WorkspaceHeader eyebrow="Shifts" title="Shifts" showHideAmounts={false}
        description="Which shifts exist, their times on a date, and who gets them."
        actions={<>
          {canBeyondSelf(me, P.SHIFT_READ) && <Button variant="ghost" onClick={() => explain.openModal({ kind: "SHIFT" })}>Which shift applies?</Button>}
          {assign && <Button variant="secondary" onClick={() => bulk.openModal()}>Bulk assign…</Button>}
          {tab === "rules" && assign && <Button onClick={() => ruleRoute.openModal()}><Plus className="h-4 w-4" aria-hidden /> New rule</Button>}
          {tab === "catalogue" && manage && <Button onClick={() => shiftRoute.openModal()}><Plus className="h-4 w-4" aria-hidden /> New shift</Button>}
        </>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} tabs={tabs.map((t) => ({ value: t.value, label: t.label }))}>
        <TabPanel value="catalogue">
          <CatalogueList refresh={refresh} onOpen={(id) => shiftRoute.openModal({ id })} />
        </TabPanel>
        {canRules && (
          <TabPanel value="rules">
            <RulesList refresh={refresh} onOpen={(id) => ruleRoute.openModal({ id })} shifts={all.byId} />
          </TabPanel>
        )}
      </Tabs>

      <FormHost formKey="shift" objectName="Shift" width="max-w-2xl" onChanged={bump}
        recordTitle={(id) => (sheet.data && String(sheet.data.id) === id ? `${sheet.data.code} · ${sheet.data.name}` : `Shift #${id}`)}
        canEdit={() => manage && !!sheet.data}
        renderView={() => (sheet.error ? <ShiftErrorNotice error={sheet.error} /> : sheet.data
          ? <ShiftView shift={sheet.data} pane={pane} onPane={setPane} canRules={canRules} />
          : <p className="text-sm text-muted-foreground">Loading…</p>)}
        viewActions={() => (sheet.data ? <ShiftActions shift={sheet.data} onChanged={bump} /> : null)}
        renderForm={(p) => (p.mode === "edit" && !sheet.data ? <p className="text-sm text-muted-foreground">Loading…</p>
          : <ShiftForm {...p} shift={p.mode === "edit" ? sheet.data : null} />)} />

      <FormHost formKey="shift-rule" objectName="Rule" createTitle="New assignment rule" submitLabel={{ create: "Save rule" }}
        width="max-w-2xl" onChanged={bump}
        recordTitle={(id) => (rule.data && String(rule.data.id) === id ? rule.data.name : `Rule #${id}`)}
        canEdit={() => assign && !!rule.data}
        renderView={() => (rule.error ? <ShiftErrorNotice error={rule.error} /> : rule.data
          ? <RuleView rule={rule.data} shift={all.byId.get(rule.data.shift_id)} name={org.name} />
          : <p className="text-sm text-muted-foreground">Loading…</p>)}
        renderForm={(p) => (p.mode === "edit" && !rule.data ? <p className="text-sm text-muted-foreground">Loading…</p>
          : <AssignmentRuleForm {...p} rule={p.mode === "edit" ? rule.data : null} />)} />

      <ShiftVersionModal onSaved={bump} />
      <BulkAssignModal onDone={bump} />
      <ShiftExplainSheet shifts={all.byId} />
    </div>
  );
}

/* ------------------------------------------------------------------ page twins */

/** `/attendance/shifts/{shift_id}`: the Sheet's panes as `?tab=`, the catalogue edit in `FormPage`. */
export function ShiftPage({ id }: { id: string }) {
  const { me } = useCan();
  const valid = isIdSegment(id);
  const { data, error, loading, reload } = useApi(() => (valid ? shiftsApi.get(id) : Promise.resolve(null)), [id]);
  const tabs = visibleTabs(ATTENDANCE_TABS["/attendance/shifts/[shift_id]"], me);
  const [tab, setTab] = useTabParam<Pane>(tabs.map((t) => t.value as Pane), "details");
  const manage = can(me, P.SHIFT_MANAGE) || can(me, P.DEPARTMENT_MANAGE);
  const all = useShiftOptions("ALL");
  if (!valid) return <NotFoundState what="Shift" backHref="/attendance/shifts" backLabel="Back to Shifts" />;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Shift" backHref="/attendance/shifts" backLabel="Back to Shifts">
      {data && (
        <div className="space-y-6">
          <Link href="/attendance/shifts" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Back to Shifts
          </Link>
          <WorkspaceHeader eyebrow="Shifts" showHideAmounts={false}
            title={<span className="flex items-center gap-3"><ShiftChip code={data.code} color={data.color_token} className="text-2xl" />{data.name}</span>}
            actions={<ShiftActions shift={data} onChanged={() => void reload()} />} />
          <ShiftView shift={data} pane={tab} onPane={setTab} canRules={tabs.some((t) => t.value === "rules")} />
          {manage && tab === "details" && (
            <Card className="p-5">
              <FormPage formKey="shift" title="Edit details" renderForm={(p) => (
                <ShiftForm {...p} shift={data} onSuccess={() => { p.onSuccess(); void reload(); }} />
              )} />
            </Card>
          )}
          <ShiftVersionModal onSaved={() => void reload()} />
          <BulkAssignModal />
          <ShiftExplainSheet shifts={all.byId} />
        </div>
      )}
    </DetailGate>
  );
}

/** `/attendance/shift-rules/{rule_id}`: the rule Sheet's twin (Details, edit in `FormPage`). */
export function ShiftRulePage({ id }: { id: string }) {
  const { me } = useCan();
  const valid = isIdSegment(id);
  const { data, error, loading, reload } = useApi(() => (valid ? shiftsApi.rule(id) : Promise.resolve(null)), [id]);
  const all = useShiftOptions("ALL");
  const org = useOrgOptions();
  if (!valid) return <NotFoundState what="Rule" backHref="/attendance/shifts?tab=rules" backLabel="Back to Assignment rules" />;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Rule" backHref="/attendance/shifts?tab=rules" backLabel="Back to Assignment rules">
      {data && (
        <div className="space-y-6">
          <Link href="/attendance/shifts?tab=rules" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Back to Assignment rules
          </Link>
          <WorkspaceHeader eyebrow="Shifts" showHideAmounts={false} title={data.name} />
          <Card className="p-5"><RuleView rule={data} shift={all.byId.get(data.shift_id)} name={org.name} /></Card>
          {can(me, P.SHIFT_ASSIGN) && (
            <Card className="p-5">
              <FormPage formKey="shift-rule" title="Edit rule" submitLabel="Save rule" renderForm={(p) => (
                <AssignmentRuleForm {...p} rule={data} onSuccess={() => { p.onSuccess(); void reload(); }} />
              )} />
            </Card>
          )}
        </div>
      )}
    </DetailGate>
  );
}

