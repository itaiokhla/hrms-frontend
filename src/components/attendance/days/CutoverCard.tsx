"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DataTable, ErrorState, PageHeader, type Column } from "@/components/ui/layout";
import { Badge, Card } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { withStepUp } from "@/lib/payroll/api";

import { attendanceCutoverApi, type CutoverStatus, type ReconcileDifference } from "./api";

const STATE_TEXT: Record<CutoverStatus["state"], { label: string; tone: "success" | "info" | "neutral"; help: string }> = {
  LEGACY: { label: "Attendance v1", tone: "neutral",
            help: "Payroll reads the sessions as today. Prepare, then reconcile a past window to switch to v2." },
  RECONCILING: { label: "Reconciling", tone: "info",
                 help: "Another administrator switches v2 on once a reconcile from the last 24 hours shows no differences." },
  V2_ACTIVE: { label: "Attendance v2: active", tone: "success",
               help: "Every day is evaluated; payroll reads the evaluations." },
};

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Settings › Attendance › Overview: the cut-over status card and its three actions (spine §15.1; AS 13 §4.6). */
export function CutoverCard() {
  const { me } = useCan();
  const { data, error, loading, reload } = useApi(() => attendanceCutoverApi.status(), []);
  const yesterday = shift(todayISO(), -1);
  const [start, setStart] = useState(shift(yesterday, -30));
  const [end, setEnd] = useState(yesterday);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, action: () => Promise<unknown>, done: string) {
    setBusy(name);
    try {
      await action();
      toast.success(done);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  const last = data?.last_reconcile ?? null;
  const state = data ? STATE_TEXT[data.state] : null;
  const mine = last?.started_by_user_id === me?.user.id;
  const ready = !!last && last.status === "SUCCEEDED" && last.differences === 0;
  const columns: Column<ReconcileDifference>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (row) => `#${row.employee_id}` },
    { key: "date", header: "Date", cell: (row) => fmtDate(row.date) },
    { key: "field", header: "Field", cell: (row) => row.field.replace(/_/g, " ") },
    { key: "legacy", header: "Today", cell: (row) => String(row.legacy) },
    { key: "v2", header: "v2", cell: (row) => String(row.v2) },
  ];
  return (
    <div className="space-y-4" data-testid="attendance-cutover">
      <PageHeader eyebrow="Settings · Attendance" title="Overview"
        description="Switch this company to attendance v2: days are evaluated once and payroll reads the evaluations."
        actions={<Link href="/settings/attendance/rules" className="text-sm font-medium text-primary hover:underline">Attendance rules</Link>} />
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          {state && <Badge tone={state.tone} dot data-testid="cutover-state">{state.label}</Badge>}
          {data && <span className="text-sm text-muted-foreground">{state?.help}</span>}
        </div>
        {data && data.state !== "V2_ACTIVE" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "prepare"} disabled={loading}
              onClick={() => run("prepare", attendanceCutoverApi.prepare, "Prepared: current behaviour is kept.")}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {data.prepared ? "Prepared" : "Prepare"}
            </Button>
          </div>
        )}
      </Card>
      {data && data.state !== "V2_ACTIVE" && (
        <Card className="space-y-4 p-5">
          <p className="text-sm font-medium">Reconcile a past window</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From"><Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={end} min={start} max={yesterday} onChange={(e) => setEnd(e.target.value)} /></Field>
            <div className="flex items-end">
              <Button loading={busy === "reconcile"} disabled={!data.prepared}
                onClick={() => run("reconcile", () => attendanceCutoverApi.reconcile(start, end),
                                   "Reconcile started. Refresh in a moment for the report.")}>
                Reconcile
              </Button>
            </div>
          </div>
          {last && (
            <div className="space-y-3" data-testid="reconcile-report">
              <p className="text-sm text-muted-foreground">
                Last reconcile {fmtDate(last.start)} – {fmtDate(last.end)} · {last.status.toLowerCase()}
                {last.created_at ? ` · ${fmtDateTime(last.created_at)}` : ""}
                {last.differences !== null ? ` · ${last.days ?? 0} days, ${last.differences} differences` : ""}
              </p>
              {last.items.length > 0 && (
                <DataTable columns={columns} rows={last.items} rowKey={(row) => `${row.employee_id}-${row.date}-${row.field}`} />
              )}
              <Button variant={ready ? "primary" : "secondary"} disabled={!ready || mine} loading={busy === "cutover"}
                onClick={() => run("cutover", () => withStepUp(() => attendanceCutoverApi.cutover(last.job_id)),
                                   "Attendance v2 is active.")}>
                <ShieldCheck className="h-4 w-4" aria-hidden /> Switch on attendance v2
              </Button>
              {ready && mine && (
                <p className="text-xs text-muted-foreground">You ran this reconcile: another administrator approves the switch.</p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
