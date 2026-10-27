"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can, canBeyondSelf } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { nextDayIso, zonedIso } from "@/lib/timezone";
import { ColumnChooser } from "@/components/shared/ColumnChooser";
import { FilterBar as SharedFilterBar } from "@/components/shared/FilterBar";
import { SavedViews, ViewActions } from "@/components/shared/SavedViews";
import { savedViewsApi } from "@/lib/savedViews";
import { PAGE_SIZES, useListQuery } from "@/lib/useListQuery";

import { overtimeApi, type OvertimeBody } from "./api";
import { ConflictBanner, DecisionModal, DetailGate, EmployeeField, ErrorSummary, FilterBar, Hours, LocalStatusChip, ReasonModal, WorkspaceHeader, fieldErrors } from "./shared";
import { OVERTIME_STATUSES, type OvertimeEntry } from "./types";
import { useTabParam } from "./WageInputsWorkspace";

const LIMIT = 50;
/** work_items.MAX_OVERTIME_MINUTES is 24 h. */
const MAX_MINUTES = 24 * 60;
const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const SOURCE: Record<string, string> = { APPROVED_REQUESTS: "Request", ATTENDANCE_WITH_APPROVAL: "From attendance", ATTENDANCE_AUTO: "From attendance (auto)" };

/** "2" → 120, "1.5" → 90, "1:30" → 90; null when it is not a duration. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 60);
}

/* ------------------------------------------------------------------ request form */

export function OvertimeRequestModal({ open, onOpenChange, onCreated, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: () => void; onDirtyChange?: (d: boolean) => void }) {
  const { me } = useCan();
  const forOthers = canBeyondSelf(me, P.OVERTIME_REQUEST) || canBeyondSelf(me, P.OVERTIME_APPROVE);
  const [someoneElse, setSomeoneElse] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [compOff, setCompOff] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSomeoneElse(!me?.employee && forOthers);
    setEmployeeId(null);
    setDate("");
    setDuration("");
    setStart("");
    setEnd("");
    setReason("");
    setCompOff(false);
    setErrors({});
    setError(null);
  }, [open, me, forOthers]);
  const dirty = open && (!!date || !!duration || !!reason);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (someoneElse && !employeeId) next.employee_id = "Choose the employee.";
    if (!date) next.date = "Choose the date you worked overtime.";
    const minutes = parseDuration(duration);
    if (minutes === null || minutes <= 0 || minutes > MAX_MINUTES) next.minutes = "Enter hours as 2, 1.5 or 1:30 (up to 24 hours).";
    if ((start && !end) || (!start && end)) next.start_at = "Give both the start and end time, or neither.";
    if (!reason.trim()) next.reason = "Say what the overtime was for.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: OvertimeBody = { date, minutes: minutes!, reason: reason.trim(), comp_off: compOff };
    if (someoneElse && employeeId) body.employee_id = employeeId;
    if (start && end) {
      // Company-local wall times with their offset (BUG-AS-21); an end before the start is the next day.
      const zone = me?.company?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      body.start_at = zonedIso(date, start, zone);
      body.end_at = zonedIso(end < start ? nextDay(date) : date, end, zone);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await overtimeApi.create(body);
      toast.success(result.status === "APPROVED" ? "Overtime recorded and approved." : "Overtime request sent to your manager.");
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Request overtime"
      description="Your manager approves it; approved overtime is paid by the pay run that covers the date (or banked as comp-off)."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="overtime-form" className="min-h-[44px]" loading={busy}>
            Send request
          </Button>
        </>
      }
    >
      <form id="overtime-form" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={errors} />
        {forOthers && (
          <div className="flex min-h-[44px] items-center justify-between gap-3">
            <span id="ot-for" className="text-sm">
              For someone in my team
            </span>
            <Switch checked={someoneElse} onChange={setSomeoneElse} aria-labelledby="ot-for" disabled={!me?.employee} />
          </div>
        )}
        {someoneElse && <EmployeeField value={employeeId} onChange={setEmployeeId} error={errors.employee_id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" required error={errors.date}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hours" required error={errors.minutes} hint="2, 1.5 or 1:30">
            <Input inputMode="decimal" dir="ltr" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From (optional)" error={errors.start_at}>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To (optional)" error={errors.end_at}>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <span id="ot-comp" className="text-sm">
            Take as comp-off instead of pay
          </span>
          <Switch checked={compOff} onChange={setCompOff} aria-labelledby="ot-comp" />
        </div>
      </form>
    </Modal>
  );
}

function nextDay(date: string): string {
  return nextDayIso(date);
}

/* ------------------------------------------------------------------ approve with edited minutes */

function ApproveOvertime({ entry, decision, onClose, onDone }: { entry: OvertimeEntry; decision: "approve" | "reject"; onClose: () => void; onDone: () => void }) {
  const requested = entry.minutes_requested ?? entry.minutes_computed ?? 0;
  const [hours, setHours] = useState(String(Math.round((requested / 60) * 100) / 100));
  const [compOff, setCompOff] = useState(entry.comp_off);
  const [hoursError, setHoursError] = useState<string | undefined>();
  return (
    <DecisionModal
      open
      onOpenChange={(o) => !o && onClose()}
      decision={decision}
      subject={`${entry.employee_name ?? `Employee #${entry.employee_id}`} · ${fmtDate(entry.date)}`}
      summary={
        <div className="rounded-xl bg-muted/60 p-3 text-sm">
          <p>
            Requested <Hours minutes={entry.minutes_requested} />
            {entry.minutes_computed !== null && (
              <>
                {" "}
                · attendance shows <Hours minutes={entry.minutes_computed} />
              </>
            )}
          </p>
          {entry.reason && <p className="mt-1 text-muted-foreground">{entry.reason}</p>}
        </div>
      }
      extra={
        decision === "approve" && (
          <div className="space-y-3">
            <Field label="Hours to approve" error={hoursError} hint="Lower it to approve part of the request.">
              <Input inputMode="decimal" dir="ltr" value={hours} onChange={(e) => { setHours(e.target.value); setHoursError(undefined); }} />
            </Field>
            <div className="flex min-h-[44px] items-center justify-between gap-3">
              <span id={`ot-co-${entry.id}`} className="text-sm">
                Comp-off instead of pay
              </span>
              <Switch checked={compOff} onChange={setCompOff} aria-labelledby={`ot-co-${entry.id}`} />
            </div>
          </div>
        )
      }
      onSubmit={async (remarks) => {
        if (decision === "approve") {
          const minutes = parseDuration(hours);
          if (minutes === null || minutes < 0 || minutes > MAX_MINUTES) {
            setHoursError("Enter hours as 2, 1.5 or 1:30.");
            throw new ApiError(422, "Enter hours as 2, 1.5 or 1:30.", "VALIDATION", [{ field: "minutes_approved", msg: "Enter hours as 2, 1.5 or 1:30." }]);
          }
          await overtimeApi.approve(entry.id, {
            minutes_approved: minutes !== requested ? minutes : undefined,
            comp_off: compOff !== entry.comp_off ? compOff : undefined,
            remarks: remarks || undefined,
            expected_step: entry.approval?.current_step ?? null,
          });
          toast.success(minutes < requested ? "Part of the overtime approved." : "Overtime approved.");
        } else {
          await overtimeApi.reject(entry.id, remarks);
          toast.success("Overtime rejected. The employee sees your reason.");
        }
        onDone();
      }}
      onReload={onDone}
    />
  );
}

/* ------------------------------------------------------------------ lists */

function EntryTable({ params, mode, refresh }: { params: Record<string, unknown>; mode: "mine" | "approve" | "all"; refresh: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(mode === "approve" ? "" : "");
  const [start, setStart] = useState("");
  const [skip, setSkip] = useState(0);
  const [decide, setDecide] = useState<{ entry: OvertimeEntry; kind: "approve" | "reject" } | null>(null);
  const [cancel, setCancel] = useState<OvertimeEntry | null>(null);
  useEffect(() => setSkip(0), [status, start]);
  const { data, error, loading, reload } = useApi(
    () => overtimeApi.list({ ...params, status: mode === "approve" ? undefined : status, start, skip, limit: LIMIT }),
    [JSON.stringify(params), status, start, skip, refresh],
  );
  const columns: Column<OvertimeEntry>[] = [
    ...(mode !== "mine" ? [{ key: "employee", header: "Employee", primary: true, cell: (r: OvertimeEntry) => r.employee_name ?? `Employee #${r.employee_id}` } as Column<OvertimeEntry>] : []),
    { key: "date", header: "Date", primary: mode === "mine", cell: (r) => <Link href={`/overtime/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{fmtDate(r.date)}</Link> },
    { key: "hours", header: "Requested", cell: (r) => <Hours minutes={r.minutes_requested ?? r.minutes_computed} /> },
    { key: "approved", header: "Approved", hideOnMobile: true, cell: (r) => <Hours minutes={r.minutes_approved} /> },
    { key: "source", header: "Source", hideOnMobile: true, cell: (r) => SOURCE[r.source] ?? r.source },
    { key: "status", header: "Status", cell: (r) => <LocalStatusChip vocabulary="overtime" code={r.status} /> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {mode === "approve" && r.status === "PENDING_APPROVAL" && (
            <>
              <Button size="sm" variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecide({ entry: r, kind: "reject" })}>
                Reject
              </Button>
              <Button size="sm" className="min-h-[44px]" onClick={() => setDecide({ entry: r, kind: "approve" })}>
                Approve
              </Button>
            </>
          )}
          {mode === "mine" && r.status === "PENDING_APPROVAL" && (
            <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setCancel(r)}>
              Withdraw
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <Card>
      {mode !== "approve" && (
        <FilterBar>
          <Field label="From date" className="w-44">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {OVERTIME_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      )}
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/overtime/${r.id}`)}
          cardBelowMd
          caption={mode === "approve" ? "Overtime waiting for your approval" : "Overtime entries"}
          empty={
            <EmptyState
              title={mode === "approve" ? "No overtime waiting for you" : mode === "mine" ? "You haven't requested overtime" : "No overtime entries"}
              description={mode === "approve" ? "Requests from your team appear here." : "Approved overtime is paid by the pay run that covers its date."}
            />
          }
        />
      )}
      {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      {decide && <ApproveOvertime entry={decide.entry} decision={decide.kind} onClose={() => setDecide(null)} onDone={() => void reload()} />}
      {cancel && (
        <ReasonModal
          open
          onOpenChange={(o) => !o && setCancel(null)}
          title="Withdraw this request?"
          consequence="The request is cancelled and will not be paid."
          confirmLabel="Withdraw"
          optional
          onSubmit={async (remarks) => {
            await overtimeApi.cancel(cancel.id, remarks);
            toast.success("Request withdrawn.");
            void reload();
          }}
        />
      )}
    </Card>
  );
}

const TABS = ["mine", "approvals", "all"] as const;

/**
 * Overtime (3.8 §3.4 managers): the employee request form (overtime:request) and the manager
 * approval list (overtime:approve). No pay amounts here (contract §25): hours only.
 */
export function OvertimeWorkspace() {
  const { me } = useCan();
  const canRequest = can(me, P.OVERTIME_REQUEST) && !!me?.employee;
  const canApprove = can(me, P.OVERTIME_APPROVE);
  const seeAll = canBeyondSelf(me, P.OVERTIME_APPROVE) || canBeyondSelf(me, P.PAYROLL_INPUTS_READ);
  const allowed = TABS.filter((t) => (t === "mine" ? canRequest : t === "approvals" ? canApprove : seeAll));
  const [tab, setTab] = useTabParam<(typeof TABS)[number]>(allowed.length ? allowed : TABS, allowed[0] ?? "mine");
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute("overtime-request", { keys: [], dirty });
  const [refresh, setRefresh] = useState(0);
  const forOthers = canBeyondSelf(me, P.OVERTIME_REQUEST) || canApprove;

  return (
    <div>
      <WorkspaceHeader
        eyebrow="Time"
        title="Overtime"
        description="Request overtime, and approve your team's. Hours only; pay is calculated by the pay run."
        showHideAmounts={false}
        actions={
          (canRequest || forOthers) && (
            <Button className="min-h-[44px]" onClick={() => modal.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> Request overtime
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as (typeof TABS)[number])}
        tabs={allowed.map((t) => ({ value: t, label: t === "mine" ? "My overtime" : t === "approvals" ? "Waiting for my approval" : "All entries" }))}
      >
        {canRequest && (
          <TabPanel value="mine">
            <EntryTable params={{ mine: true }} mode="mine" refresh={refresh} />
          </TabPanel>
        )}
        {canApprove && (
          <TabPanel value="approvals">
            <EntryTable params={{ awaiting: true }} mode="approve" refresh={refresh} />
          </TabPanel>
        )}
        {seeAll && (
          <TabPanel value="all">
            <OvertimeAllEntries refresh={refresh} />
          </TabPanel>
        )}
      </Tabs>
      <OvertimeRequestModal open={modal.open} onOpenChange={modal.onOpenChange} onDirtyChange={setDirty} onCreated={() => setRefresh((n) => n + 1)} />
    </div>
  );
}

/* ------------------------------------------------- X-M3 pilot list (OD-AS-03) */

const ALL_FILTERS = ["status", "start", "end", "employee_id"] as const;
const ALL_SORTS = ["date", "employee", "minutes", "status"] as const;
const OPTIONAL_COLUMNS = [
  { key: "minutes", label: "Requested" },
  { key: "approved", label: "Approved" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
];

/**
 * "All entries" on the list standard (X 04 §2; list key `overtime.entries`): URL-bound query, saved views, search,
 * server sort, 25 / 50 pages, column chooser, and the existing payroll detail in a right-side Sheet
 * (`?modal=overtime-entry&id=`). The request form and the other tabs are unchanged (D-X-13).
 */
function OvertimeAllEntries({ refresh }: { refresh: number }) {
  const list = useListQuery({ filters: ALL_FILTERS, sortKeys: ALL_SORTS });
  const sheet = useModalRoute("overtime-entry", { keys: ["id"] });
  const views = useApi(() => savedViewsApi.list("overtime.entries"), []);
  const [columns, setColumns] = useState<string[]>(OPTIONAL_COLUMNS.map((c) => c.key));
  const { data, error, loading, reload } = useApi(
    () => overtimeApi.list(list.params),
    [JSON.stringify(list.params), refresh],
  );
  const active = list.view;
  const stored = [...(views.data?.system_views ?? []), ...(views.data?.views ?? [])].find((v) => String(v.id) === active)?.query;
  const currentQuery: Record<string, unknown> = {
    ...list.filters, ...(list.q ? { q: list.q } : {}), ...(list.sort ? { sort: list.sort } : {}),
    ...(list.limit !== 25 ? { limit: list.limit } : {}), columns,
  };
  const modified = !!active && !!stored && JSON.stringify({ ...stored, columns: undefined }) !==
    JSON.stringify({ ...currentQuery, columns: undefined });
  const chips = Object.entries(list.filters).map(([key, value]) => ({
    key,
    label: key === "status" ? "Status" : key === "start" ? "From" : key === "end" ? "To" : "Employee",
    values: (Array.isArray(value) ? value : [value]).map((v) => (key === "status" ? human(v) : v)),
  }));
  const table: Column<OvertimeEntry>[] = [
    { key: "employee", header: "Employee", primary: true, hideable: false, sortKey: "employee",
      cell: (r) => r.employee_name ?? `Employee #${r.employee_id}` },
    { key: "date", header: "Date", hideable: false, sortKey: "date", cell: (r) => fmtDate(r.date) },
    { key: "minutes", header: "Requested", sortKey: "minutes", cell: (r) => <Hours minutes={r.minutes_requested ?? r.minutes_computed} /> },
    { key: "approved", header: "Approved", hideOnMobile: true, cell: (r) => <Hours minutes={r.minutes_approved} /> },
    { key: "source", header: "Source", hideOnMobile: true, cell: (r) => SOURCE[r.source] ?? r.source },
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <LocalStatusChip vocabulary="overtime" code={r.status} /> },
  ];
  return (
    <Card>
      <SharedFilterBar
        views={<SavedViews data={views.data} active={active} modified={modified}
          onSelect={(id, query) => {
            list.selectView(id, query);
            if (query && Array.isArray(query.columns)) setColumns(query.columns as string[]);
          }} />}
        search={{ value: list.qInput, onChange: list.setQ, label: "Search name or code" }}
        tools={<ColumnChooser columns={OPTIONAL_COLUMNS} visible={columns} onChange={setColumns}
          defaults={OPTIONAL_COLUMNS.map((c) => c.key)} />}
        chips={chips}
        onRemoveChip={(key) => list.setFilter(key, null)}
        onClearAll={list.clearFilters}
        resultCount={data?.total}
        chipsEnd={<ViewActions listKey="overtime.entries" data={views.data} active={active} query={currentQuery}
          onReset={() => list.selectView(active ?? null, stored)}
          onSaved={(view) => { void views.reload(); list.selectView(String(view.id), view.query); }} />}
      >
        <Field label="Status" className="w-48">
          <Select value={(list.filters.status as string) ?? ""} onChange={(e) => list.setFilter("status", e.target.value || null)}>
            <option value="">All statuses</option>
            {OVERTIME_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
          </Select>
        </Field>
      </SharedFilterBar>
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <DataTable
          columns={table}
          visibleColumns={columns}
          rows={data?.items}
          loading={loading && !data}
          busy={loading && !!data}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          rowHref={(r) => `/overtime?tab=all&modal=overtime-entry&id=${r.id}`}
          onRowClick={(r) => sheet.openModal({ id: r.id })}
          cardBelowMd
          caption="Overtime entries"
          empty={<EmptyState title="No overtime entries" description="Try another view or clear the filters." />}
        />
      )}
      {data && <Pagination total={data.total} skip={list.skip} limit={list.limit} onChange={list.setSkip}
        pageSizes={[...PAGE_SIZES]} onLimitChange={list.setLimit} />}
      <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange} width="max-w-2xl"
        title={sheet.id ? `Overtime entry #${sheet.id}` : "Overtime entry"}>
        {sheet.id && <OvertimeDetail id={sheet.id} embedded onChanged={() => void reload()} />}
      </Sheet>
    </Card>
  );
}

/** `/overtime/[id]`: one entry with its approval state (also the body of the list's Sheet when `embedded`). */
export function OvertimeDetail({ id, embedded = false, onChanged }: { id: string; embedded?: boolean; onChanged?: () => void }) {
  const { me } = useCan();
  const { data, error, loading, reload } = useApi(() => overtimeApi.get(id), [id]);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const canApprove = can(me, P.OVERTIME_APPROVE);
  const own = !!data && data.employee_id === me?.employee?.id;
  const events: TimelineItem[] = data
    ? ([
        data.created_at && { id: "c", at: data.created_at, title: `Recorded (${SOURCE[data.source] ?? data.source})`, tone: "info" },
        data.decided_at && { id: "d", at: data.decided_at, title: human(data.status), tone: data.status === "APPROVED" ? "success" : data.status === "REJECTED" ? "danger" : "neutral" },
      ].filter(Boolean) as TimelineItem[])
    : [];
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Overtime entry" backHref="/overtime" backLabel="Back to Overtime">
      {data && (
        <div className="space-y-6">
          {!embedded && (
            <Link href="/overtime" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Overtime
            </Link>
          )}
          <WorkspaceHeader
            eyebrow="Time"
            showHideAmounts={false}
            title={`Overtime on ${fmtDate(data.date)}`}
            description={data.employee_name ?? `Employee #${data.employee_id}`}
            actions={
              canApprove &&
              !own &&
              data.status === "PENDING_APPROVAL" && (
                <>
                  <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecision("reject")}>
                    Reject
                  </Button>
                  <Button className="min-h-[44px]" onClick={() => setDecision("approve")}>
                    Approve
                  </Button>
                </>
              )
            }
          />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="p-5">
              <div className="mb-4">
                <LocalStatusChip vocabulary="overtime" code={data.status} />
              </div>
              <dl className="grid gap-4 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Requested</dt>
                  <dd className="mt-1">
                    <Hours minutes={data.minutes_requested} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">From attendance</dt>
                  <dd className="mt-1">
                    <Hours minutes={data.minutes_computed} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Approved</dt>
                  <dd className="mt-1">
                    <Hours minutes={data.minutes_approved} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Time</dt>
                  <dd className="mt-1">{data.start_at ? `${fmtTime(data.start_at)} – ${fmtTime(data.end_at)}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Day type</dt>
                  <dd className="mt-1">{data.bucket ? human(data.bucket) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Compensation</dt>
                  <dd className="mt-1">{data.comp_off ? "Comp-off" : "Paid"}</dd>
                </div>
              </dl>
              {data.reason && <p className="mt-4 text-sm text-muted-foreground">{data.reason}</p>}
              {data.approval?.pending_reason && <p className="mt-2 text-sm text-warning">{data.approval.pending_reason}</p>}
              {data.consumed_by_run_employee_id && <p className="mt-2 text-sm">Included in a pay run.</p>}
            </Card>
            <Card>
              <CardHeader title="History" />
              <div className="px-5 pb-5">
                <Timeline items={events} label="Overtime history" />
              </div>
            </Card>
          </div>
          {decision && <ApproveOvertime entry={data} decision={decision} onClose={() => setDecision(null)}
            onDone={() => { void reload(); onChanged?.(); }} />}
        </div>
      )}
    </DetailGate>
  );
}
