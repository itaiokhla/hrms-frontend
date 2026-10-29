"use client";

import { motion } from "framer-motion";
import { Plus, Route, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { api, toApiError } from "@/lib/api";
import { can } from "@/lib/access";
import { KIND_LABELS } from "@/lib/attendanceRequests";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface ReasonRow { code: string; label: string; applies_to: string[]; counts_toward_limit: boolean; requires_attachment: boolean;
  sensitive: boolean; status: string; is_seed: boolean; row_version: number }
interface RouteStep { approver_type: string; role_id?: number | null; sla_hours?: number | null; approver_label?: string }
interface RouteRow { id: number; module: string; route_key: string; name: string; priority: number; status: string;
  criteria: Record<string, unknown>; steps: RouteStep[]; row_version: number }

const APPROVER_TYPES = [
  ["primary_manager", "Line manager"], ["team_lead", "Team lead"], ["skip_level_manager", "Manager's manager"],
  ["department_head", "Department head"], ["role", "Role (e.g. HR)"],
] as const;

/** Settings › Attendance › Requests & approvals (04-attendance/04 §7, §9.2): reason codes and approval routes. */
export default function RequestSettingsPage() {
  const [tab, setTab] = useState("reasons");
  return (
    <RequireAccess check={(me) => can(me, P.ATTENDANCE_MANAGE_POLICY)}>
      <PageHeader title="Requests & approvals" description="Reasons people choose when they ask for a correction, and who approves which requests." />
      <Tabs tabs={[{ value: "reasons", label: "Reason codes" }, { value: "routes", label: "Approval routes" }]} value={tab} onValueChange={setTab}>
        <TabPanel value="reasons">{tab === "reasons" && <Reasons />}</TabPanel>
        <TabPanel value="routes">{tab === "routes" && <Routes />}</TabPanel>
      </Tabs>
    </RequireAccess>
  );
}

function Reasons() {
  const { data, loading, reload } = useApi(() => api.get<{ items: ReasonRow[] }>("/attendance/reason-codes", { params: { include_inactive: true } }), []);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kinds, setKinds] = useState<string[]>(["MISSED_PUNCH"]);

  const toggle = async (row: ReasonRow, patch: Partial<ReasonRow>) => {
    try {
      await api.patch(`/attendance/reason-codes/${row.code}`, { ...patch, row_version: row.row_version });
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  const add = async () => {
    try {
      await api.post("/attendance/reason-codes", { code, label, applies_to: kinds });
      toast.success("Reason added");
      setAdding(false);
      setCode("");
      setLabel("");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  return (
    <Card>
      <div className="flex justify-end border-b border-border p-3">
        <Button size="sm" data-testid="reason-add" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add reason</Button>
      </div>
      <DataTable rows={data?.items} loading={loading && !data} rowKey={(r) => r.code}
        columns={[
          { key: "label", header: "Reason", cell: (r) => <span><span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">{r.code}</span></span> },
          { key: "kinds", header: "Used for", hideOnMobile: true, cell: (r) => <span className="text-xs">{r.applies_to.map((k) => KIND_LABELS[k as keyof typeof KIND_LABELS] ?? k.toLowerCase().replace(/_/g, " ")).join(", ")}</span> },
          { key: "limit", header: "Counts toward limit", cell: (r) => (
            <input type="checkbox" aria-label={`${r.label} counts toward the limit`} checked={r.counts_toward_limit}
              onChange={(e) => void toggle(r, { counts_toward_limit: e.target.checked })} />) },
          { key: "file", header: "Needs a file", cell: (r) => (
            <input type="checkbox" aria-label={`${r.label} needs a file`} checked={r.requires_attachment}
              onChange={(e) => void toggle(r, { requires_attachment: e.target.checked })} />) },
          { key: "status", header: "Status", cell: (r) => (
            <Button size="sm" variant="ghost" data-testid={`reason-status-${r.code}`}
              onClick={() => void toggle(r, { status: r.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
              <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"} dot>{r.status.toLowerCase()}</Badge>
            </Button>) },
        ]} />
      <Modal open={adding} onOpenChange={setAdding} title="Add reason"
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          <Button data-testid="reason-save" disabled={!/^[A-Z][A-Z0-9_]{1,39}$/.test(code) || !label.trim() || kinds.length === 0} onClick={add}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Code" hint="Capital letters, digits and _, e.g. SITE_VISIT"><Input data-testid="reason-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <Field label="Label"><Input data-testid="reason-label" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <fieldset className="flex flex-wrap gap-2">
            {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => (
              <label key={k} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
                {KIND_LABELS[k]}
              </label>
            ))}
          </fieldset>
        </div>
      </Modal>
    </Card>
  );
}

function Routes() {
  const { data, loading, reload } = useApi(() => api.get<{ items: RouteRow[] }>("/approval-routes", { params: { module: "attendance" } }), []);
  const teams = useApi(() => api.get<{ items: { id: number; name: string; code: string }[] }>("/teams", { params: { limit: 200 } }).catch(() => ({ items: [] })), []);
  const [editing, setEditing] = useState<RouteRow | null>(null);
  const [draft, setDraft] = useState<{ route_key: string; name: string; priority: number; team_ids: number[]; steps: RouteStep[]; status: string }>(
    { route_key: "", name: "", priority: 50, team_ids: [], steps: [{ approver_type: "team_lead" }], status: "ACTIVE" });

  const open = (row: RouteRow | null) => {
    setEditing(row ?? ({ id: 0 } as RouteRow));
    setDraft(row ? { route_key: row.route_key, name: row.name, priority: row.priority, status: row.status,
      team_ids: (row.criteria.team_ids as number[] | undefined) ?? [], steps: row.steps.map((s) => ({ approver_type: s.approver_type, role_id: s.role_id, sla_hours: s.sla_hours })) }
      : { route_key: "", name: "", priority: 50, team_ids: [], steps: [{ approver_type: "team_lead" }], status: "ACTIVE" });
  };
  const save = async () => {
    const body = { module: "attendance", route_key: draft.route_key, name: draft.name, priority: draft.priority, status: draft.status,
      criteria: draft.team_ids.length ? { team_ids: draft.team_ids } : {}, steps: draft.steps,
      row_version: editing && editing.id ? editing.row_version : undefined };
    try {
      if (editing && editing.id) await api.put(`/approval-routes/${editing.id}`, body);
      else await api.post("/approval-routes", body);
      toast.success("Route saved");
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" data-testid="route-add" onClick={() => open(null)}><Plus className="h-4 w-4" /> Add route</Button></div>
      {(data?.items ?? []).map((r, i) => (
        <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
          <Card className="flex flex-wrap items-center gap-3 p-4" data-testid={`route-${r.route_key}`}>
            <Route className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{r.route_key} · priority {r.priority}</span></p>
              <p className="text-xs text-muted-foreground">
                {(r.criteria.team_ids as number[] | undefined)?.length
                  ? `Teams: ${(r.criteria.team_ids as number[]).map((id) => teams.data?.items.find((t) => t.id === id)?.name ?? id).join(", ")}`
                  : "Everyone"} → {r.steps.map((s) => s.approver_label ?? s.approver_type).join(" → ")}
              </p>
            </div>
            <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"}>{r.status.toLowerCase()}</Badge>
            <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button>
          </Card>
        </motion.div>
      ))}
      {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
      <Modal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} size="lg" title={editing?.id ? "Edit route" : "Add route"}
        description="The active route with the highest priority whose conditions match is used when a request is sent. Requests are never approved automatically."
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button data-testid="route-save" disabled={!draft.route_key || !draft.name || draft.steps.length === 0} onClick={() => void save()}>Save</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Key"><Input data-testid="route-key" disabled={!!editing?.id} value={draft.route_key} onChange={(e) => setDraft({ ...draft, route_key: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} /></Field>
            <Field label="Name"><Input data-testid="route-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Priority"><Input type="number" min={0} max={10000} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Only for teams" hint="Leave empty for everyone">
            <div className="flex flex-wrap gap-2">
              {(teams.data?.items ?? []).map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                  <input type="checkbox" checked={draft.team_ids.includes(t.id)}
                    onChange={(e) => setDraft({ ...draft, team_ids: e.target.checked ? [...draft.team_ids, t.id] : draft.team_ids.filter((x) => x !== t.id) })} />
                  {t.name}
                </label>
              ))}
            </div>
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">Steps</p>
            {draft.steps.map((step, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <Field label={`Step ${index + 1}`} className="w-56">
                  <Select data-testid={`route-step-${index}`} value={step.approver_type}
                    onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((s, i) => i === index ? { ...s, approver_type: e.target.value } : s) })}>
                    {APPROVER_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                  </Select>
                </Field>
                {step.approver_type === "role" && (
                  <Field label="Role id" className="w-28"><Input type="number" value={step.role_id ?? ""}
                    onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((s, i) => i === index ? { ...s, role_id: Number(e.target.value) || null } : s) })} /></Field>
                )}
                <Field label="Due within (h)" className="w-32"><Input type="number" min={1} max={720} value={step.sla_hours ?? ""}
                  onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((s, i) => i === index ? { ...s, sla_hours: Number(e.target.value) || null } : s) })} /></Field>
                <Button size="sm" variant="danger-ghost" aria-label="Remove step" disabled={draft.steps.length === 1}
                  onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {draft.steps.length < 5 && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { approver_type: "primary_manager" }] })}><Plus className="h-4 w-4" /> Add step</Button>}
          </div>
          <Field label="Status" className="w-40">
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>
          </Field>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Tags className="h-3.5 w-3.5" /> Approvers must hold “Approve attendance requests” for the employee.</p>
        </div>
      </Modal>
    </div>
  );
}
