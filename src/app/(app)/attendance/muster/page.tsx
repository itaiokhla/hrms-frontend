"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ClipboardCheck, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, toApiError } from "@/lib/api";
import { can } from "@/lib/access";
import { MUSTER_LABELS, MUSTER_MARKS, requestsApi, type MusterMark } from "@/lib/attendanceRequests";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface RowState { mark: MusterMark | ""; in_time: string; out_time: string; reason_code: string }
interface Option { id: number; name: string }
const DEFAULT_ROW: RowState = { mark: "", in_time: "09:00", out_time: "18:00", reason_code: "" };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Supervisor muster (04-attendance/04 §11; D-AS-75): mark a crew or site for one date; each row is saved on its own. */
export default function MusterPage() {
  return (
    <RequireAccess check={(me) => can(me, P.ATTENDANCE_MUSTER)}>
      <Muster />
    </RequireAccess>
  );
}

function Muster() {
  const [date, setDate] = useState(today());
  const [scope, setScope] = useState<"branch" | "team">("branch");
  const [scopeId, setScopeId] = useState<number | null>(null);
  const { data: branches } = useApi(() => api.get<Option[]>("/branches"), []);
  const { data: teams } = useApi(() => api.get<{ items: Option[] }>("/teams", { params: { limit: 200 } }).catch(() => ({ items: [] })), []);
  const options = scope === "branch" ? branches ?? [] : teams?.items ?? [];
  useEffect(() => {
    if (scopeId === null && options.length) setScopeId(options[0].id);
  }, [options, scopeId]);
  const params = useMemo(() => (scopeId === null ? null : { date, ...(scope === "branch" ? { branch_id: scopeId } : { team_id: scopeId }) }),
    [date, scope, scopeId]);
  const { data, loading, error, reload } = useApi(() => requestsApi.muster(params!), [params], { enabled: params !== null });
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [results, setResults] = useState<Record<number, { status: string; message?: string }>>({});
  const [saving, setSaving] = useState(false);

  // A new date or crew starts clean; a reload after saving keeps the per-row results on screen.
  useEffect(() => {
    setRows({});
    setResults({});
  }, [params]);

  const set = (id: number, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...DEFAULT_ROW, ...prev[id], ...patch } }));
  const marked = Object.entries(rows).filter(([, r]) => r.mark);

  const markAll = (mark: MusterMark) => data?.rows.forEach((r) => set(r.employee_id, { mark }));

  const submit = async () => {
    if (!params) return;
    setSaving(true);
    try {
      const result = await requestsApi.submitMuster({
        date, ...(scope === "branch" ? { branch_id: scopeId } : { team_id: scopeId }),
        rows: marked.map(([id, r]) => ({
          employee_id: Number(id), mark: r.mark,
          ...(r.mark === "IN_OUT" ? { in_time: r.in_time, out_time: r.out_time } : {}),
          ...(r.reason_code ? { reason_code: r.reason_code } : {}),
        })),
      });
      setResults(Object.fromEntries(result.results.map((x) => [x.employee_id, { status: x.status, message: x.message }])));
      toast.success(`${result.applied} saved${result.refused ? `, ${result.refused} refused` : ""}`);
      setRows({});
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Muster" description="Mark your crew for a shift date: punch times, or a day mark with a reason. Originals are never overwritten." />
      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Date" className="sm:w-44"><Input data-testid="muster-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Crew by" className="sm:w-36">
          <Select value={scope} onChange={(e) => { setScope(e.target.value as "branch" | "team"); setScopeId(null); }}>
            <option value="branch">Site</option><option value="team">Team</option>
          </Select>
        </Field>
        <Field label={scope === "branch" ? "Site" : "Team"} className="sm:w-64">
          <Select data-testid="muster-scope" value={scopeId ?? ""} onChange={(e) => setScopeId(Number(e.target.value))}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => markAll("PRESENT")} disabled={!data?.rows.length}>All present</Button>
        <Button data-testid="muster-submit" loading={saving} disabled={!marked.length} onClick={submit}>
          <ClipboardCheck className="h-4 w-4" /> Save {marked.length || ""} row{marked.length === 1 ? "" : "s"}
        </Button>
      </Card>
      {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : loading || !data ? <Skeleton className="h-72" /> : (
        !data.rows.length ? <EmptyState icon={<Users />} title="Nobody to muster" description="No one in this crew is in your scope on this date." /> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="muster-grid">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Employee</th><th className="p-3">Recorded</th><th className="p-3">Day</th><th className="p-3">Mark</th><th className="p-3">Times / reason</th><th className="p-3">Result</th></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {data.rows.map((r, index) => {
                    const state = rows[r.employee_id];
                    const result = results[r.employee_id];
                    return (
                      <motion.tr key={r.employee_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index, 12) * 0.02 }}
                        className="border-t border-border/70" data-testid={`muster-row-${r.employee_id}`}>
                        <td className="p-3"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.employee_code}</p></td>
                        <td className="p-3 text-xs">{r.sessions.length ? r.sessions.map((s) => `${s.in ?? "–"}–${s.out ?? "…"}`).join(", ") : "—"}
                          {r.open_requests > 0 && <Badge tone="warning" className="ml-1">{r.open_requests} open</Badge>}</td>
                        <td className="p-3 text-xs">{r.day_result?.toLowerCase().replace("_", " ") ?? "—"}</td>
                        <td className="p-3">
                          <Select aria-label={`Mark for ${r.name}`} data-testid={`muster-mark-${r.employee_id}`} value={state?.mark ?? ""}
                            onChange={(e) => set(r.employee_id, { mark: e.target.value as MusterMark })}>
                            <option value="">—</option>
                            {MUSTER_MARKS.map((m) => <option key={m} value={m}>{MUSTER_LABELS[m]}</option>)}
                          </Select>
                        </td>
                        <td className="p-3">
                          {state?.mark === "IN_OUT" && (
                            <div className="flex gap-2">
                              <Input aria-label="In" type="time" value={state.in_time} onChange={(e) => set(r.employee_id, { in_time: e.target.value })} />
                              <Input aria-label="Out" type="time" value={state.out_time} onChange={(e) => set(r.employee_id, { out_time: e.target.value })} />
                            </div>
                          )}
                          {state?.mark === "IDLE" && (
                            <Select aria-label="Reason" value={state.reason_code || "RAIN_OFF"} onChange={(e) => set(r.employee_id, { reason_code: e.target.value })}>
                              <option value="RAIN_OFF">Rain / weather stoppage</option><option value="EMPLOYER_IDLE">Work stopped by employer</option>
                            </Select>
                          )}
                        </td>
                        <td className="p-3" data-testid={`muster-result-${r.employee_id}`}>
                          {result && (result.status === "APPLIED"
                            ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Saved</span>
                            : <span className="flex items-center gap-1 text-danger"><XCircle className="h-4 w-4" /> {result.message}</span>)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </Card>
        )
      )}
    </div>
  );
}
