"use client";

import { Ban, Plus, RefreshCw, Tags, UsersRound } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, TabPanel, Tabs, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import {
  REASON_APPLIES_TO,
  type Blackout,
  type BlackoutWrite,
  type CoverageRule,
  type CoverageWrite,
  type ReasonAppliesTo,
  type ReasonCode,
  type RuleMode,
} from "@/lib/leave/adminTypes";
import { useTabParam } from "@/lib/useTabParam";

import { ApprovalRouteEditor } from "./ApprovalRouteEditor";
import { LeaveSettingsPanel } from "./LeaveSettingsPanel";
import { ChipToggleGroup, ErrorNotice, hasLeavePerm, optionName, useLeaveAccess, useLeaveTypes, useOrgOptions, type Option } from "./shared";

const TABS = ["blackouts", "coverage", "reasons", "approval", "settings"] as const;
type Tab = (typeof TABS)[number];

/* ------------------------------------------------------------------ blackouts */

function blankBlackout(): BlackoutWrite {
  return { name: "", from_date: "", to_date: "", legal_entity_id: null, branch_ids: null, department_ids: null, leave_type_codes: [], mode: "BLOCK", reason: null, status: "ACTIVE" };
}

export function BlackoutForm({ initial, id, onSaved, onCancel }: { initial: BlackoutWrite; id?: number; onSaved: () => void; onCancel: () => void }) {
  const org = useOrgOptions();
  const types = useLeaveTypes(false);
  const [form, setForm] = useState<BlackoutWrite>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BlackoutWrite>) => { setForm((f) => ({ ...f, ...patch })); setErrors({}); };
  const save = async () => {
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = "Enter a name.";
    if (!form.from_date) found.from_date = "Choose the first day.";
    if (!form.to_date) found.to_date = "Choose the last day.";
    if (form.from_date && form.to_date && form.to_date < form.from_date) found.to_date = "The end date is before the start date.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, name: form.name.trim(), reason: form.reason?.trim() || null, branch_ids: form.branch_ids?.length ? form.branch_ids : null, department_ids: form.department_ids?.length ? form.department_ids : null };
      if (id) await leaveAdminApi.updateBlackout(id, body);
      else await leaveAdminApi.createBlackout(body);
      toast.success("Blackout saved");
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="blackout-form">
      <Field label="Name" required error={errors.name}><Input value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} data-testid="blackout-name" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" required error={errors.from_date}><Input type="date" value={form.from_date} onChange={(e) => set({ from_date: e.target.value })} data-testid="blackout-from" /></Field>
        <Field label="To" required error={errors.to_date}><Input type="date" value={form.to_date} onChange={(e) => set({ to_date: e.target.value })} data-testid="blackout-to" /></Field>
      </div>
      <Segmented label="When someone asks for leave in this period" value={form.mode} options={[{ value: "BLOCK", label: "Refuse" }, { value: "WARN", label: "Warn the approver" }]}
        onChange={(mode: RuleMode) => set({ mode })} />
      <Field label="Legal entity" hint="Blank = the whole company (needs company-wide access).">
        <Select value={form.legal_entity_id ?? ""} onChange={(e) => set({ legal_entity_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Whole company</option>
          {org.entities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </Field>
      <ChipToggleGroup label="Only these branches (none = all)" options={org.branches.map((o) => ({ value: o.id, label: o.label }))} value={form.branch_ids ?? []} onChange={(ids) => set({ branch_ids: ids })} />
      <ChipToggleGroup label="Only these departments (none = all)" options={org.departments.map((o) => ({ value: o.id, label: o.label }))} value={form.department_ids ?? []} onChange={(ids) => set({ department_ids: ids })} />
      <ChipToggleGroup label="Only these leave types (none = every type)" options={(types.data ?? []).map((t) => ({ value: t.code, label: t.name }))} value={form.leave_type_codes} onChange={(codes) => set({ leave_type_codes: codes })} />
      <Field label="Reason shown to employees"><Textarea rows={2} maxLength={500} value={form.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} /></Field>
      <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
        <span className="text-sm font-medium">Active</span>
        <Switch checked={form.status === "ACTIVE"} onChange={(v) => set({ status: v ? "ACTIVE" : "ARCHIVED" })} label="Active" />
      </div>
      <ErrorNotice error={error} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => void save()} loading={busy} data-testid="blackout-save">Save blackout</Button>
      </div>
    </div>
  );
}

function BlackoutsTab({ canWrite }: { canWrite: boolean }) {
  const [archived, setArchived] = useState(false);
  const list = useApi(() => leaveAdminApi.blackouts(archived), [archived]);
  const org = useOrgOptions();
  const [editing, setEditing] = useState<{ id?: number; initial: BlackoutWrite } | null>(null);
  const columns: Column<Blackout>[] = [
    { key: "name", header: "Name", primary: true, cell: (b) => <span className="font-medium">{b.name}</span> },
    { key: "dates", header: "Period", cell: (b) => `${fmtDate(b.from_date)} – ${fmtDate(b.to_date)}` },
    { key: "scope", header: "Covers", hideOnMobile: true, cell: (b) => [b.legal_entity_id ? optionName(org.entities, b.legal_entity_id) : "Whole company", b.branch_ids?.length ? `${b.branch_ids.length} branch(es)` : null, b.department_ids?.length ? `${b.department_ids.length} department(s)` : null].filter(Boolean).join(" · ") },
    { key: "types", header: "Types", hideOnMobile: true, cell: (b) => (b.leave_type_codes.length ? b.leave_type_codes.join(", ") : "All") },
    { key: "mode", header: "Mode", cell: (b) => <Badge tone={b.mode === "BLOCK" ? "danger" : "warning"}>{b.mode === "BLOCK" ? "Refuse" : "Warn"}</Badge> },
    { key: "status", header: "Status", cell: (b) => <Badge tone={b.status === "ACTIVE" ? "success" : "neutral"} dot>{b.status === "ACTIVE" ? "Active" : "Archived"}</Badge> },
  ];
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">Periods when leave is refused or flagged (year-end close, peak season). A type rule can exempt its type.</p>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={archived} onChange={setArchived} label="Show archived" /> Show archived</label>
        {canWrite && <Button onClick={() => setEditing({ initial: blankBlackout() })} data-testid="new-blackout"><Plus className="h-4 w-4" /> New blackout</Button>}
      </div>
      {list.error && !list.data ? <ErrorState message={list.error.message} onRetry={() => void list.reload()} /> : (
        <DataTable caption="Blackout periods" columns={columns} rows={list.data} loading={list.loading && !list.data} rowKey={(b) => b.id} cardBelowMd
          onRowClick={canWrite ? (b) => setEditing({ id: b.id, initial: { name: b.name, from_date: b.from_date, to_date: b.to_date, legal_entity_id: b.legal_entity_id, branch_ids: b.branch_ids, department_ids: b.department_ids, leave_type_codes: b.leave_type_codes, mode: b.mode, reason: b.reason, status: b.status } }) : undefined}
          empty={<EmptyState icon={<Ban />} title="No blackout periods" description="Add one for times when the business cannot spare people." />} />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} size="lg" title={editing?.id ? "Edit blackout" : "New blackout"}>
        {editing && <BlackoutForm key={editing.id ?? "new"} id={editing.id} initial={editing.initial} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ coverage */

type Group = "department_id" | "branch_id" | "team_id";

function CoverageForm({ rule, onSaved, onCancel }: { rule?: CoverageRule; onSaved: () => void; onCancel: () => void }) {
  const org = useOrgOptions();
  const teams = useApi(() => api.get<unknown>("/teams").then((d) => (Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items ?? [])) as { id: number; name: string }[]).catch(() => []), []);
  const initialGroup: Group = rule?.branch_id ? "branch_id" : rule?.team_id ? "team_id" : "department_id";
  const [name, setName] = useState(rule?.name ?? "");
  const [group, setGroup] = useState<Group>(initialGroup);
  const [groupId, setGroupId] = useState(String(rule?.[initialGroup] ?? ""));
  const [limitKind, setLimitKind] = useState<"count" | "pct">(rule?.max_absent_pct != null ? "pct" : "count");
  const [limit, setLimit] = useState(String(rule?.max_absent_pct ?? rule?.max_absent_count ?? ""));
  const [countPending, setCountPending] = useState(rule?.count_pending ?? true);
  const [mode, setMode] = useState<RuleMode>(rule?.mode ?? "WARN");
  const [active, setActive] = useState((rule?.status ?? "ACTIVE") === "ACTIVE");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const options: Option[] = group === "department_id" ? org.departments : group === "branch_id" ? org.branches : (teams.data ?? []).map((t) => ({ id: t.id, label: t.name }));
  const save = async () => {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Enter a name.";
    if (!/^\d+$/.test(groupId)) found.group = "Choose the group.";
    if (limitKind === "count" ? !/^\d+$/.test(limit.trim()) : !/^\d+(\.\d{1,2})?$/.test(limit.trim()) || Number(limit) <= 0 || Number(limit) > 100)
      found.limit = limitKind === "count" ? "A whole number of people." : "A percentage above 0 and at most 100.";
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: CoverageWrite = {
      name: name.trim(), department_id: null, branch_id: null, team_id: null, [group]: Number(groupId),
      max_absent_count: limitKind === "count" ? Number(limit) : null, max_absent_pct: limitKind === "pct" ? limit.trim() : null,
      count_pending: countPending, mode, status: active ? "ACTIVE" : "ARCHIVED",
    } as CoverageWrite;
    setBusy(true);
    setError(null);
    try {
      if (rule) await leaveAdminApi.updateCoverage(rule.id, body);
      else await leaveAdminApi.createCoverage(body);
      toast.success("Coverage rule saved");
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="coverage-form">
      <Field label="Name" required error={errors.name}><Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Group kind">
          <Select value={group} onChange={(e) => { setGroup(e.target.value as Group); setGroupId(""); }}>
            <option value="department_id">Department</option>
            <option value="branch_id">Branch</option>
            <option value="team_id">Team</option>
          </Select>
        </Field>
        <Field label="Group" required error={errors.group}>
          {options.length ? (
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          ) : <Input inputMode="numeric" placeholder="Record id" value={groupId} onChange={(e) => setGroupId(e.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Segmented label="Limit by" value={limitKind} options={[{ value: "count", label: "Number of people" }, { value: "pct", label: "Percentage" }]} onChange={setLimitKind} />
        <Field label={limitKind === "count" ? "At most away at once" : "At most % away at once"} required error={errors.limit}>
          <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
      </div>
      <Segmented label="When the limit is reached" value={mode} options={[{ value: "WARN", label: "Warn the approver" }, { value: "BLOCK", label: "Refuse" }]} onChange={setMode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"><span className="text-sm font-medium">Count pending requests</span><Switch checked={countPending} onChange={setCountPending} label="Count pending requests" /></div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"><span className="text-sm font-medium">Active</span><Switch checked={active} onChange={setActive} label="Active" /></div>
      </div>
      <ErrorNotice error={error} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => void save()} loading={busy} data-testid="coverage-save">Save rule</Button>
      </div>
    </div>
  );
}

function CoverageTab({ canWrite }: { canWrite: boolean }) {
  const list = useApi(() => leaveAdminApi.coverage(), []);
  const org = useOrgOptions();
  const [editing, setEditing] = useState<{ rule?: CoverageRule } | null>(null);
  const columns: Column<CoverageRule>[] = [
    { key: "name", header: "Name", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "group", header: "Group", cell: (r) => (r.department_id ? `Department · ${optionName(org.departments, r.department_id)}` : r.branch_id ? `Branch · ${optionName(org.branches, r.branch_id)}` : `Team #${r.team_id}`) },
    { key: "limit", header: "At most away", cell: (r) => (r.max_absent_pct != null ? `${r.max_absent_pct}%` : `${r.max_absent_count} people`) },
    { key: "pending", header: "Pending counts", hideOnMobile: true, cell: (r) => (r.count_pending ? "Yes" : "No") },
    { key: "mode", header: "Mode", cell: (r) => <Badge tone={r.mode === "BLOCK" ? "danger" : "warning"}>{r.mode === "BLOCK" ? "Refuse" : "Warn"}</Badge> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"} dot>{r.status === "ACTIVE" ? "Active" : "Archived"}</Badge> },
  ];
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">Minimum staffing: how many people of a group may be away at the same time.</p>
        {canWrite && <Button onClick={() => setEditing({})} data-testid="new-coverage"><Plus className="h-4 w-4" /> New rule</Button>}
      </div>
      {list.error && !list.data ? <ErrorState message={list.error.message} onRetry={() => void list.reload()} /> : (
        <DataTable caption="Coverage rules" columns={columns} rows={list.data} loading={list.loading && !list.data} rowKey={(r) => r.id} cardBelowMd
          onRowClick={canWrite ? (rule) => setEditing({ rule }) : undefined}
          empty={<EmptyState icon={<UsersRound />} title="No coverage rules" description="Add one so a team is never left without enough people." />} />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.rule ? "Edit coverage rule" : "New coverage rule"}>
        {editing && <CoverageForm key={editing.rule?.id ?? "new"} rule={editing.rule} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ reason codes */

const APPLIES_LABEL: Record<ReasonAppliesTo, string> = {
  REJECT: "Rejecting", RETURN: "Sending back", CANCEL: "Cancelling", RECALL: "Recalling", ADJUST: "Balance adjustments", OVERRIDE: "Overrides",
};

function ReasonCodeForm({ initial, onSaved, onCancel }: { initial?: ReasonCode; onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [appliesTo, setAppliesTo] = useState<ReasonAppliesTo>(initial?.applies_to ?? "REJECT");
  const [refused, setRefused] = useState(initial?.counts_as_refused ?? false);
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const found: Record<string, string> = {};
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) found.code = "2–40 capitals, digits or _, starting with a letter.";
    if (!label.trim()) found.label = "Enter a label.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await leaveAdminApi.saveReasonCode({ code, label: label.trim(), applies_to: appliesTo, counts_as_refused: refused, is_active: active });
      toast.success(active ? "Reason code saved" : "Reason code deactivated");
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="reason-code-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code} hint={initial ? "Fixed: code and use identify the reason." : "e.g. TEAM_SHORT"}>
          <Input value={code} disabled={!!initial} className="font-mono" maxLength={40} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"))} data-testid="reason-code" />
        </Field>
        <Field label="Used when">
          <Select value={appliesTo} disabled={!!initial} onChange={(e) => setAppliesTo(e.target.value as ReasonAppliesTo)}>
            {REASON_APPLIES_TO.map((a) => <option key={a} value={a}>{APPLIES_LABEL[a]}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Label" required error={errors.label}><Input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} data-testid="reason-label" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"><span className="text-sm font-medium">Counts as refused leave</span><Switch checked={refused} onChange={setRefused} label="Counts as refused leave" /></div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"><span className="text-sm font-medium">Active</span><Switch checked={active} onChange={setActive} label="Active" /></div>
      </div>
      <ErrorNotice error={error} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => void save()} loading={busy} data-testid="reason-save">Save</Button>
      </div>
    </div>
  );
}

function ReasonCodesTab({ canWrite }: { canWrite: boolean }) {
  const list = useApi(() => leaveAdminApi.reasonCodes(), []);
  const [editing, setEditing] = useState<{ code?: ReasonCode } | null>(null);
  const columns: Column<ReasonCode>[] = [
    { key: "label", header: "Label", primary: true, cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "applies", header: "Used when", cell: (r) => APPLIES_LABEL[r.applies_to] ?? r.applies_to },
    { key: "refused", header: "Counts as refused", hideOnMobile: true, cell: (r) => (r.counts_as_refused ? <Badge tone="warning">Yes</Badge> : "No") },
  ];
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">Standard reasons approvers and HR pick when they reject, send back, cancel, recall or adjust.</p>
        {canWrite && <Button onClick={() => setEditing({})} data-testid="new-reason-code"><Plus className="h-4 w-4" /> New reason</Button>}
      </div>
      {list.error && !list.data ? <ErrorState message={list.error.message} onRetry={() => void list.reload()} /> : (
        <DataTable caption="Reason codes" columns={columns} rows={list.data} loading={list.loading && !list.data} rowKey={(r) => r.id} cardBelowMd
          onRowClick={canWrite ? (code) => setEditing({ code }) : undefined}
          empty={<EmptyState icon={<Tags />} title="No reason codes" description="Approvers can still write their own reason." />} />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.code ? "Edit reason" : "New reason"} size="md">
        {editing && <ReasonCodeForm key={editing.code?.id ?? "new"} initial={editing.code} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

/** Settings › Leave › Rules & settings (09-ui-ux/02 §21.4–§21.5): blackouts, coverage, reason codes, approval route, leave settings. */
export function RulesPage() {
  const [tab, setTab] = useTabParam<Tab>(TABS, "blackouts");
  const access = useLeaveAccess();
  const manage = hasLeavePerm(access.data, "leave:manage_policy");
  const company = !!access.data?.manage_company;
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title="Rules and settings"
        description="Company-wide leave rules that every plan can use, the approval route and the leave settings."
        actions={<Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => setRefreshKey((k) => k + 1)}><RefreshCw className="h-4 w-4" /></Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} tabs={[
        { value: "blackouts", label: "Blackouts" },
        { value: "coverage", label: "Coverage rules" },
        { value: "reasons", label: "Reason codes" },
        { value: "approval", label: "Approval route" },
        { value: "settings", label: "Leave settings" },
      ]}>
        <TabPanel value="blackouts"><BlackoutsTab key={refreshKey} canWrite={manage} /></TabPanel>
        <TabPanel value="coverage"><CoverageTab key={refreshKey} canWrite={manage} /></TabPanel>
        <TabPanel value="reasons"><ReasonCodesTab key={refreshKey} canWrite={company} /></TabPanel>
        <TabPanel value="approval"><ApprovalRouteEditor key={refreshKey} canWrite={company} /></TabPanel>
        <TabPanel value="settings"><LeaveSettingsPanel key={refreshKey} /></TabPanel>
      </Tabs>
    </div>
  );
}
