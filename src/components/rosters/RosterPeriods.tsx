"use client";

import { CalendarRange, Plus, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { FilterBar } from "@/components/shared/FilterBar";
import { FormHost, type FormRenderProps } from "@/components/shared/FormHost";
import { addDays, todayIn } from "@/components/shifts/shiftModel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { useModalRoute } from "@/lib/useModalRoute";

import { rostersApi, type GenerateAheadResult, type RosterPeriod } from "./api";
import { RosterErrorNotice } from "./RosterResults";
import { MAX_PERIOD_DAYS, daySpan, validatePeriod, type PeriodValues } from "./rosterModel";

interface Branch { id: number; name?: string; code?: string }

/** Branches for the period owner picker and the list's Branch column (best effort). */
export function useBranches() {
  const { data } = useApi(() => api.get<Branch[]>("/branches").catch(() => [] as Branch[]), []);
  return useMemo(() => {
    const items = (Array.isArray(data) ? data : []).map((b) => ({ id: Number(b.id), label: String(b.name ?? b.code ?? `Branch #${b.id}`) }));
    return { items, name: (id: number | null | undefined) => (id ? items.find((b) => b.id === id)?.label ?? `Branch #${id}` : "—") };
  }, [data]);
}

export const PERIOD_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PUBLISHED: { label: "Published", tone: "success" },
  AMENDING: { label: "Changes pending", tone: "warning" },
  CLOSED: { label: "Closed", tone: "info" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export function PeriodStatusBadge({ status }: { status: string }) {
  const s = PERIOD_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot data-testid="period-status">{s.label}</Badge>;
}

/* ------------------------------------------------------------------ new period form */

/** New roster period (§4.1): code, name, the branch it plans and up to 62 days. */
export function RosterPeriodForm({ formId, idempotencyKey, setDirty, setSubmitting, onSuccess }: FormRenderProps) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const branches = useBranches();
  const [values, setValues] = useState<PeriodValues>({ code: "", name: "", branch_id: "", start_date: today, end_date: addDays(today, 13) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!values.branch_id && branches.items.length === 1) setValues((v) => ({ ...v, branch_id: String(branches.items[0].id) }));
  }, [branches.items, values.branch_id]);
  const set = (key: keyof PeriodValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validatePeriod(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await rostersApi.create({ code: values.code.trim(), name: values.name.trim(), branch_id: Number(values.branch_id),
        start_date: values.start_date, end_date: values.end_date }, idempotencyKey);
      onSuccess({ id: created.id });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };
  const span = values.start_date && values.end_date && values.end_date >= values.start_date ? daySpan(values.start_date, values.end_date) : null;
  return (
    <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <RosterErrorNotice error={error} nameOf={(id) => `Employee #${id}`} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input value={values.code} maxLength={40} placeholder="e.g. BLR-NOV-W1" onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={values.name} maxLength={100} placeholder="e.g. Bengaluru, first half of November" onChange={(e) => set("name", e.target.value)} />
        </Field>
      </div>
      <Field label="Branch" required error={errors.branch_id} hint="The people of this branch are the rows of the grid.">
        <Select value={values.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
          <option value="">Choose a branch</option>
          {branches.items.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" required error={errors.start_date}>
          <Input type="date" value={values.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="Last day" required error={errors.end_date}
          hint={span ? `${span} ${span === 1 ? "day" : "days"} (at most ${MAX_PERIOD_DAYS}).` : `At most ${MAX_PERIOD_DAYS} days.`}>
          <Input type="date" value={values.end_date} min={values.start_date || undefined} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ list */

const STATUS_FILTERS = ["DRAFT", "PUBLISHED", "AMENDING", "CLOSED", "CANCELLED"];

/**
 * `/rosters` (§13): roster periods newest first, with status and waiting drafts; a row opens its grid. "New period"
 * (`roster:plan`) opens `RosterPeriodForm` in a Modal (`?modal=roster-period`).
 */
export function RosterPeriodsWorkspace() {
  const { me } = useCan();
  const router = useRouter();
  const plan = can(me, P.ROSTER_PLAN);
  const create = useModalRoute("roster-period", { keys: ["id", "mode", "pane"] });
  const branches = useBranches();
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const [generating, setGenerating] = useState(false);
  const limit = 25;
  const { data, error, loading, reload } = useApi(() => rostersApi.list({ status: status || undefined, skip, limit }), [status, skip]);
  const columns: Column<RosterPeriod>[] = [
    { key: "code", header: "Code", primary: true, cell: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { key: "name", header: "Name", cell: (p) => p.name },
    { key: "branch", header: "Branch", hideOnMobile: true, cell: (p) => branches.name(p.branch_id) },
    { key: "dates", header: "Dates", cell: (p) => `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` },
    { key: "status", header: "Status", cell: (p) => <PeriodStatusBadge status={p.status} /> },
    { key: "drafts", header: "Drafts", hideOnMobile: true, cell: (p) => (p.drafts ? `${p.drafts} waiting` : "—") },
    { key: "published", header: "Last published", hideOnMobile: true, cell: (p) => (p.last_published_at ? fmtDate(p.last_published_at) : "Never") },
  ];
  return (
    <div>
      <WorkspaceHeader eyebrow="Rosters" title="Rosters" showHideAmounts={false}
        description="Plan who works which shift, day by day, then publish it to their schedules."
        actions={<>
          <Link href="/rosters/my-schedule" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium hover:bg-muted">My schedule</Link>
          {plan && <Button variant="secondary" data-testid="open-generate" onClick={() => setGenerating(true)}>
            <Wand2 className="h-4 w-4" aria-hidden /> Generate 90 days</Button>}
          {plan && <Button onClick={() => create.openModal()}><Plus className="h-4 w-4" aria-hidden /> New period</Button>}
        </>} />
      <Card>
        <FilterBar resultCount={data?.total}
          chips={status ? [{ key: "status", label: "Status", values: [PERIOD_STATUS[status]?.label ?? status] }] : []}
          onRemoveChip={() => { setStatus(""); setSkip(0); }} onClearAll={() => { setStatus(""); setSkip(0); }}>
          <Field label="Status" className="w-44">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{PERIOD_STATUS[s].label}</option>)}
            </Select>
          </Field>
        </FilterBar>
        {error ? <ErrorState message={error.message} onRetry={reload} /> : (
          <DataTable columns={columns} rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(p) => p.id}
            rowHref={(p) => `/rosters/${p.id}`} onRowClick={(p) => router.push(`/rosters/${p.id}`)} cardBelowMd caption="Roster periods"
            empty={<EmptyState icon={<CalendarRange />} title="No roster periods yet"
              description={plan ? "Create a period to start planning shifts." : "Nothing has been planned for the people you can see."} />} />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
      </Card>
      <FormHost formKey="roster-period" objectName="Roster period" createTitle="New roster period"
        submitLabel={{ create: "Create period" }} afterCreate="close" onChanged={() => void reload()}
        renderForm={(p) => <RosterPeriodForm {...p} />} />
      <GenerateAheadModal open={generating} onOpenChange={setGenerating} branches={branches.items}
        onDone={() => void reload()} />
    </div>
  );
}

/**
 * The roster generator (WI-AS-5.3): month periods for a branch from its local today, with every active rotation
 * assignment expanded into drafts ("Generate 90 days"; periods already there are reused).
 */
export function GenerateAheadModal({ open, onOpenChange, branches, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: { id: number; label: string }[];
  onDone: () => void;
}) {
  const [branch, setBranch] = useState("");
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateAheadResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      if (!branch && branches.length === 1) setBranch(String(branches[0].id));
    }
  }, [open, branches, branch]);
  const count = Number(days);
  const valid = !!branch && Number.isInteger(count) && count >= 1 && count <= 366;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const done = await rostersApi.generateAhead(Number(branch), count);
      setResult(done);
      toast.success(`Generated ${done.generated} draft cells in ${done.periods.length} periods.`);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Generate rosters"
      description="Creates month periods for the branch and fills them with the rotation drafts."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{result ? "Close" : "Cancel"}</Button>
        {!result && <Button data-testid="generate-confirm" loading={busy} disabled={!valid || busy} onClick={() => void submit()}>Generate</Button>}
      </>}>
      <div className="space-y-4" data-testid="generate-modal">
        {error ? <RosterErrorNotice error={error} nameOf={(id) => `Employee #${id}`} /> : null}
        <Field label="Branch" required
          hint={branches.length ? undefined : "You can't see any branches. Ask an administrator for access to the organisation structure."}>
          <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Choose a branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </Field>
        <Field label="Days ahead" hint="From the branch's today; at most 366.">
          <Input type="number" min={1} max={366} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        {result && (
          <div data-testid="generate-result" className="space-y-2 text-sm">
            <p>{fmtDate(result.from)} – {fmtDate(result.to)}: {result.generated} draft cells.</p>
            <ul className="space-y-1">
              {result.periods.map((p) => (
                <li key={p.period_id} data-testid="generate-period">
                  <Link href={`/rosters/${p.period_id}`} className="font-mono font-semibold hover:underline">{p.code}</Link>
                  {" "}· {fmtDate(p.start_date)} – {fmtDate(p.end_date)} · {p.generated} cells
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
