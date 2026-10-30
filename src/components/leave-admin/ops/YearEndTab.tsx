"use client";

import { CalendarClock, CheckCircle2, Play, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, SearchInput, StatCard, type Column } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { YearEndRow, YearEndRun } from "@/lib/leave/adminTypes";
import { useSession } from "@/store/session";

import { ErrorNotice, TypedConfirm, fmtUnits, typedMatches, useOrgOptions } from "../shared";

const STATUS_TONE: Record<string, "info" | "success" | "neutral"> = { DRAFT: "info", POSTED: "success", REVERSED: "neutral" };

const YEAR_END_HELP: Record<string, string> = {
  SELF_DECISION_FORBIDDEN: "Maker ≠ checker: the person who prepared this preview cannot post it. Another holder of year-end rights posts it.",
  CYCLE_NOT_ENDED: "This is an early preview: the leave year has not ended yet. Post it after the cycle end date.",
  YEAR_END_RUN_EXISTS: "This year end is already posted. Reverse it first to run it again.",
  STEP_UP_REQUIRED: "Posting and reversing need a fresh identity check. Confirm it's you and try again.",
  INVALID_TRANSITION: "The run changed state. Reload the list.",
};

function ActionModal({ run, action, open, onOpenChange, onDone }: {
  run: YearEndRun;
  action: "post" | "reverse";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (run: YearEndRun) => void;
}) {
  const expected = action === "post" ? "POST" : "REVERSE";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = action === "post" ? await leaveAdminApi.postYearEnd(run.id) : await leaveAdminApi.reverseYearEnd(run.id);
      toast.success(action === "post" ? "Year end posted" : "Year end reversed");
      onOpenChange(false);
      onDone(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const code = (error as { code?: string } | null)?.code;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={action === "post" ? `Post year end ${fmtDate(run.cycle_end)}` : `Reverse year end ${fmtDate(run.cycle_end)}`}
      description={action === "post" ? "Carry-forward, encashment and lapse rows are written to the ledger." : "Every ledger row of this run is reversed; approved encashments it created are cancelled."}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={action === "post" ? "primary" : "danger"} disabled={!typedMatches(text, expected)} loading={busy} onClick={() => void submit()} data-testid={`year-end-${action}-submit`}>
          {action === "post" ? <CheckCircle2 className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />} {action === "post" ? "Post" : "Reverse"}
        </Button></>}>
      <div className="space-y-4">
        {run.summary && (
          <div className="grid grid-cols-4 gap-2 rounded-xl bg-surface-muted/60 p-3 text-center text-sm">
            <div><p className="font-semibold tabular-nums">{run.summary.employees}</p><p className="text-xs text-muted-foreground">employees</p></div>
            <div><p className="font-semibold tabular-nums">{fmtUnits(run.summary.carry)}</p><p className="text-xs text-muted-foreground">carried</p></div>
            <div><p className="font-semibold tabular-nums">{fmtUnits(run.summary.encash)}</p><p className="text-xs text-muted-foreground">encashed</p></div>
            <div><p className="font-semibold tabular-nums">{fmtUnits(run.summary.lapse)}</p><p className="text-xs text-muted-foreground">lapsed</p></div>
          </div>
        )}
        <Notice tone="info" title="You will be asked to confirm it's you" />
        <TypedConfirm expected={expected} value={text} onChange={setText} testId={`year-end-${action}-confirm`} />
        {code && YEAR_END_HELP[code] && <Notice tone="warning" title={YEAR_END_HELP[code]} />}
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}

function RunSheet({ runId, open, onOpenChange, onChanged }: { runId: number | null; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const me = useSession((s) => s.me);
  const run = useApi(() => leaveAdminApi.yearEnd(runId!), [runId], { enabled: !!runId && open });
  const [q, setQ] = useState("");
  const [action, setAction] = useState<"post" | "reverse" | null>(null);
  const rows = useMemo(() => (run.data?.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.leave_type.includes(q.toLowerCase())), [run.data, q]);
  const maker = run.data?.created_by_user_id != null && run.data.created_by_user_id === me?.user.id;
  const columns: Column<YearEndRow>[] = [
    { key: "name", header: "Employee", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Type", cell: (r) => <span className="font-mono text-xs">{r.leave_type}</span> },
    { key: "balance", header: "Closing", cell: (r) => <span className="tabular-nums">{fmtUnits(r.balance)}</span> },
    { key: "carry", header: "Carry", cell: (r) => <span className="tabular-nums">{fmtUnits(r.carry)}</span> },
    { key: "encash", header: "Encash", cell: (r) => <span className="tabular-nums">{fmtUnits(r.encash)}</span> },
    { key: "lapse", header: "Lapse", cell: (r) => <span className="tabular-nums">{fmtUnits(r.lapse)}</span> },
    { key: "flag", header: "", hideInCard: true, cell: (r) => (Number(r.balance) < 0 ? <Badge tone="warning">Negative</Badge> : null) },
  ];
  const data = run.data;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} width="max-w-4xl" title={data ? `Year end ${fmtDate(data.cycle_end)}` : "Year end"}
      description={data ? `Run #${data.id} · ${data.status.toLowerCase()}` : undefined}
      footer={data && (
        <>
          {data.status === "DRAFT" && <Button onClick={() => setAction("post")} data-testid="year-end-post">Post run…</Button>}
          {data.status === "POSTED" && <Button variant="danger-ghost" onClick={() => setAction("reverse")} data-testid="year-end-reverse">Reverse run…</Button>}
        </>
      )}>
      {run.error ? <ErrorState message={run.error.message} onRetry={() => void run.reload()} /> : !data ? null : (
        <div className="space-y-4" data-testid="year-end-run">
          {data.summary?.early_preview && <Notice tone="warning" title={`Early preview — figures change until ${fmtDate(data.cycle_end)}`}>It can be posted once the leave year has ended.</Notice>}
          {data.status === "DRAFT" && maker && (
            <Notice tone="info" title="Needs a second approver">In manual-review mode another person with year-end rights must post this run.</Notice>
          )}
          {data.summary && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Employees" value={data.summary.employees} tone="info" />
              <StatCard label="Carried" value={Number(data.summary.carry)} tone="primary" delay={0.05} format={(n) => fmtUnits(n)} />
              <StatCard label="Encashed" value={Number(data.summary.encash)} tone="success" delay={0.1} format={(n) => fmtUnits(n)} />
              <StatCard label="Lapsed" value={Number(data.summary.lapse)} tone="warning" delay={0.15} format={(n) => fmtUnits(n)} hint={data.summary.negative ? `${data.summary.negative} negative balance(s)` : undefined} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Prepared by user #{data.created_by_user_id}{data.posted_at && ` · posted ${fmtDateTime(data.posted_at)} by user #${data.posted_by_user_id}`}{data.reversed_at && ` · reversed ${fmtDateTime(data.reversed_at)}`}
          </p>
          <SearchInput value={q} onChange={setQ} placeholder="Search employee or type" />
          <DataTable caption="Year-end rows" columns={columns} rows={rows} rowKey={(r) => `${r.employee_id}-${r.leave_type}`} cardBelowMd
            empty={<p className="py-6 text-center text-sm text-muted-foreground">Nothing carries, encashes or lapses.</p>} />
          {action && <ActionModal run={data} action={action} open={!!action} onOpenChange={(o) => !o && setAction(null)} onDone={() => { void run.reload(); onChanged(); }} />}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Year end (09-ui-ux/02 §13): preview the carry / encash / lapse split for a cycle end, then a different holder of
 * year-end rights posts it (maker ≠ checker, fresh step-up); a posted run can be reversed.
 */
export function YearEndTab() {
  const runs = useApi(() => leaveAdminApi.yearEnds(), []);
  const org = useOrgOptions();
  const [cycleEnd, setCycleEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [entity, setEntity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openRun, setOpenRun] = useState<number | null>(null);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await leaveAdminApi.previewYearEnd({ cycle_end: cycleEnd, legal_entity_id: entity ? Number(entity) : null });
      toast.success(`Preview ready: ${run.summary?.rows ?? 0} row(s)`);
      void runs.reload();
      setOpenRun(run.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const code = (error as { code?: string } | null)?.code;

  const columns: Column<YearEndRun>[] = [
    { key: "cycle", header: "Cycle ending", primary: true, cell: (r) => <span className="font-medium">{fmtDate(r.cycle_end)}</span> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? "neutral"} dot>{r.status.toLowerCase()}{r.summary?.early_preview && r.status === "DRAFT" ? " · early" : ""}</Badge> },
    { key: "scope", header: "Scope", hideOnMobile: true, cell: (r) => (r.legal_entity_id ? org.entities.find((e) => e.id === r.legal_entity_id)?.label ?? `Entity #${r.legal_entity_id}` : "Whole company") },
    { key: "people", header: "Employees", cell: (r) => r.summary?.employees ?? "—" },
    { key: "split", header: "Carry · encash · lapse", hideOnMobile: true, cell: (r) => (r.summary ? <span className="tabular-nums">{fmtUnits(r.summary.carry)} · {fmtUnits(r.summary.encash)} · {fmtUnits(r.summary.lapse)}</span> : "—") },
    { key: "posted", header: "Posted", hideOnMobile: true, cell: (r) => (r.posted_at ? fmtDateTime(r.posted_at) : "—") },
  ];

  return (
    <div className="space-y-5" data-testid="year-end-tab">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="font-semibold">Close a leave year</h3>
          <p className="text-sm text-muted-foreground">Preview what carries forward, encashes and lapses for everyone whose leave year ends on the date. Nothing is written until the run is posted.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Cycle ending" className="w-48"><Input type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} data-testid="year-end-date" /></Field>
          <Field label="Legal entity" className="w-64">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Whole company</option>
              {org.entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </Select>
          </Field>
          <Button onClick={() => void preview()} loading={busy} disabled={!cycleEnd} data-testid="year-end-preview"><Play className="h-4 w-4" /> Preview</Button>
        </div>
        {code && YEAR_END_HELP[code] && <Notice tone="warning" title={YEAR_END_HELP[code]} />}
        <ErrorNotice error={error} />
      </Card>
      <Card className="p-4 sm:p-5">
        {runs.error && !runs.data ? <ErrorState message={runs.error.message} onRetry={() => void runs.reload()} /> : (
          <DataTable caption="Year-end runs" columns={columns} rows={runs.data} loading={runs.loading && !runs.data} rowKey={(r) => r.id}
            onRowClick={(r) => setOpenRun(r.id)} cardBelowMd
            empty={<EmptyState icon={<CalendarClock />} title="No year-end runs yet" description="Preview the first one above." />} />
        )}
      </Card>
      <RunSheet runId={openRun} open={openRun !== null} onOpenChange={(o) => !o && setOpenRun(null)} onChanged={() => void runs.reload()} />
    </div>
  );
}
