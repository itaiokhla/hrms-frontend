"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, CalendarPlus, CalendarRange, Inbox, Plus, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canAny, canBeyondSelf } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fmtDate, fromNow, titleCase, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { ChainStep, LeaveBalance, LeaveRequest, LeaveType, Page, Role } from "@/lib/types";

export default function LeavesPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.LEAVE_APPLY, P.LEAVE_READ, P.LEAVE_APPROVE, P.LEAVE_MANAGE_POLICY])}>
      <Suspense>
        <Leaves />
      </Suspense>
    </RequireAccess>
  );
}

function Leaves() {
  const params = useSearchParams();
  const { me } = useCan();
  const { data: inbox, reload: reloadInbox } = useApi(() => api.get<LeaveRequest[]>("/leaves/approvals"), []);
  const mine = can(me, P.LEAVE_APPLY) && !!me?.employee;
  const tabs = [
    ...(mine ? [{ value: "mine", label: "My leave" }] : []),
    { value: "approvals", label: "Approvals", badge: inbox?.length },
    ...(canBeyondSelf(me, P.LEAVE_READ) ? [{ value: "team", label: "Requests" }] : []),
    ...(can(me, P.LEAVE_MANAGE_POLICY) ? [{ value: "policy", label: "Policy" }] : []),
  ];
  const [tab, setTab] = useState(params.get("tab") ?? tabs[0].value);

  return (
    <div>
      <PageHeader title="Leave" description="Requests follow your company's approval chain. Changes in reporting lines re-route pending approvals automatically." />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        {mine && <TabPanel value="mine"><MyLeave /></TabPanel>}
        <TabPanel value="approvals"><Approvals items={inbox} reload={reloadInbox} /></TabPanel>
        {canBeyondSelf(me, P.LEAVE_READ) && <TabPanel value="team"><TeamRequests /></TabPanel>}
        {can(me, P.LEAVE_MANAGE_POLICY) && <TabPanel value="policy"><Policy /></TabPanel>}
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- Mine */
function MyLeave() {
  const confirm = useConfirm();
  const [year] = useState(new Date().getFullYear());
  const { data: balance, reload: reloadBalance } = useApi(() => api.get<Record<string, LeaveBalance>>(`/leaves/my/balance?year=${year}`), [year]);
  const { data: leaves, reload } = useApi(() => api.get<LeaveRequest[]>("/leaves/my"), []);
  const { data: types } = useApi(() => api.get<LeaveType[]>("/leaves/types"), []);
  const [applyOpen, setApplyOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const cancel = async (leave: LeaveRequest) => {
    if (!(await confirm({ title: "Cancel this request?", message: `${titleCase(leave.leave_type)} leave, ${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}.`, confirmLabel: "Cancel request", tone: "danger" }))) return;
    try {
      await api.post(`/leaves/${leave.id}/cancel`);
      toast.success("Request cancelled");
      void reload();
      void reloadBalance();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Balances {year}</h2>
        <Button onClick={() => setApplyOpen(true)}><CalendarPlus className="h-4 w-4" /> Apply for leave</Button>
      </div>
      {!balance ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(balance).map(([code, b], i) => {
            const pct = b.is_unlimited || !b.total ? 0 : Math.min(100, ((b.used + b.pending) / b.total) * 100);
            return (
              <motion.div key={code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="p-5">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium">{b.name}</p>
                    {!b.is_paid && <Badge>Unpaid</Badge>}
                  </div>
                  <p className="mt-2 font-display text-3xl font-semibold">
                    {b.is_unlimited ? "∞" : b.available}
                    {!b.is_unlimited && <span className="text-sm font-normal text-muted-foreground"> of {b.total} days</span>}
                  </p>
                  {!b.is_unlimited && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{b.used} used{b.pending ? ` · ${b.pending} pending` : ""}</p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
      <Card>
        <CardHeader title="My requests" />
        {!leaves ? <div className="p-4"><Skeleton className="h-24" /></div> : leaves.length === 0 ? (
          <EmptyState icon={<CalendarRange />} title="No leave requests yet" />
        ) : (
          <ul className="divide-y divide-border/60">
            {leaves.map((l) => (
              <li key={l.id}>
                <button className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-muted" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{titleCase(l.leave_type)} · {l.number_of_days} day{l.number_of_days > 1 ? "s" : ""}</p>
                    <p className="text-sm text-muted-foreground">{fmtDate(l.start_date)} – {fmtDate(l.end_date)}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </button>
                <AnimatePresence>
                  {expanded === l.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="space-y-4 px-5 pb-5">
                        {l.reason && <p className="text-sm text-muted-foreground">“{l.reason}”</p>}
                        <StepTimeline steps={l.steps} />
                        {l.status === "pending" && <Button size="sm" variant="danger-ghost" onClick={() => cancel(l)}>Cancel request</Button>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ApplyModal open={applyOpen} onOpenChange={setApplyOpen} types={types ?? []} balance={balance}
        onApplied={() => { void reload(); void reloadBalance(); }} />
    </div>
  );
}

function ApplyModal({ open, onOpenChange, types, balance, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; types: LeaveType[];
  balance?: Record<string, LeaveBalance>; onApplied: () => void;
}) {
  const [type, setType] = useState("");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const days = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
  const chosen = type || types[0]?.code;
  const available = chosen ? balance?.[chosen]?.available : null;

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/leaves/apply", { leave_type: chosen, start_date: start, end_date: end, reason: reason || null });
      toast.success("Leave requested. Your approvers have been notified.");
      onOpenChange(false);
      setReason("");
      onApplied();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Apply for leave"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={!chosen || days < 1} onClick={submit}>Submit request</Button></>}>
      <div className="space-y-4">
        <Field label="Leave type">
          <Select value={chosen} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><Input type="date" value={start} min={todayISO()} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="To"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className={cn("rounded-xl px-4 py-3 text-sm", available !== null && available !== undefined && days > available ? "bg-danger-soft text-danger" : "bg-muted")}>
          {days} day{days !== 1 ? "s" : ""} requested{available !== null && available !== undefined ? ` · ${available} available` : ""}
        </div>
        <Field label="Reason" hint="Optional, visible to your approvers">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function StepTimeline({ steps }: { steps: LeaveRequest["steps"] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={s.step_order} className="flex items-center gap-2">
          <div className={cn("rounded-xl border px-3 py-2 text-xs",
            s.status === "approved" ? "border-success/30 bg-success-soft" : s.status === "rejected" ? "border-danger/30 bg-danger-soft"
              : s.status === "pending" ? "border-warning/30 bg-warning-soft" : "border-border bg-muted")}>
            <p className="font-semibold">{s.approver_label}{s.approver ? ` · ${s.approver}` : ""}</p>
            <p className="mt-0.5 text-muted-foreground">
              {titleCase(s.status)}{s.acted_by ? ` by ${s.acted_by}` : ""}{s.acted_as && s.acted_as !== "approver" ? ` (${s.acted_as})` : ""}
            </p>
            {s.remarks && <p className="mt-1 max-w-xs italic text-foreground/80">“{s.remarks}”</p>}
          </div>
          {i < steps.length - 1 && <span className="h-px w-4 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ Approvals */
function Approvals({ items, reload }: { items?: LeaveRequest[]; reload: () => Promise<unknown> }) {
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (leave: LeaveRequest, approve: boolean) => {
    setBusy(leave.id);
    try {
      await api.post(`/leaves/${leave.id}/${approve ? "approve" : "reject"}`, { remarks: remarks[leave.id] || null });
      toast.success(approve ? "Approved" : "Rejected");
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!items) return <Skeleton className="h-40 rounded-2xl" />;
  if (items.length === 0) return <Card><EmptyState icon={<Inbox />} title="Nothing waiting for you" description="Requests routed to you, or delegated to you, appear here." /></Card>;
  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {items.map((l) => (
          <motion.div key={l.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
            <Card className="p-5" role="article" aria-label={`Leave request from ${l.employee_name}, ${fmtDate(l.start_date)}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="flex min-w-0 flex-1 gap-3">
                  <Avatar name={l.employee_name} size={42} />
                  <div className="min-w-0">
                    <p className="font-semibold">{l.employee_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {titleCase(l.leave_type)} · {l.number_of_days} day{l.number_of_days > 1 ? "s" : ""} · {fmtDate(l.start_date)} – {fmtDate(l.end_date)}
                    </p>
                    {l.reason && <p className="mt-2 text-sm">“{l.reason}”</p>}
                    <div className="mt-3"><StepTimeline steps={l.steps} /></div>
                    {l.acting_as !== "approver" && (
                      <p className="mt-2 text-xs font-medium text-warning">
                        {l.acting_as === "delegate" ? "You're acting as a delegate for the assigned approver." : "Company-wide override — this will be recorded."}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 lg:w-72">
                  <Input placeholder="Remarks (optional)" value={remarks[l.id] ?? ""} onChange={(e) => setRemarks({ ...remarks, [l.id]: e.target.value })} />
                  <div className="flex gap-2">
                    <Button variant="success" className="flex-1" loading={busy === l.id} onClick={() => act(l, true)}><Check className="h-4 w-4" /> Approve</Button>
                    <Button variant="danger-ghost" className="flex-1" disabled={busy === l.id} onClick={() => act(l, false)}><X className="h-4 w-4" /> Reject</Button>
                  </div>
                  <p className="text-right text-xs text-muted-foreground">Requested {fromNow(l.created_at)}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------- Team */
function TeamRequests() {
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const { data, loading } = useApi(() => api.get<Page<LeaveRequest>>("/leaves", { params: { status: status || undefined, skip, limit: 50 } }), [status, skip]);
  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} className="w-48" aria-label="Status">
          <option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option>
          <option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
        </Select>
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} requests in your scope</p>
      </div>
      <DataTable rows={data?.items} loading={loading} rowKey={(l) => l.id}
        empty={<EmptyState icon={<CalendarRange />} title="No requests" />}
        columns={[
          { key: "emp", header: "Employee", cell: (l) => <div className="flex items-center gap-2.5"><Avatar name={l.employee_name} size={30} /><span className="font-medium">{l.employee_name}</span></div> },
          { key: "type", header: "Type", cell: (l) => titleCase(l.leave_type) },
          { key: "dates", header: "Dates", cell: (l) => `${fmtDate(l.start_date, "d MMM")} – ${fmtDate(l.end_date, "d MMM")}`, hideOnMobile: true },
          { key: "days", header: "Days", cell: (l) => l.number_of_days, hideOnMobile: true },
          { key: "step", header: "Waiting on", hideOnMobile: true, cell: (l) => {
            const s = l.steps.find((x) => x.status === "pending");
            return s ? `${s.approver_label}${s.approver ? ` · ${s.approver}` : ""}` : "—";
          } },
          { key: "status", header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
        ]} />
    </Card>
  );
}

/* ------------------------------------------------------------- Policy */
function Policy() {
  const { data: types, reload: reloadTypes } = useApi(() => api.get<LeaveType[]>("/leaves/types?include_inactive=true"), []);
  const { data: chain, reload: reloadChain, setData: setChain } = useApi(() => api.get<ChainStep[]>("/leaves/approval-chain"), []);
  const { data: roles } = useApi(() => api.get<Role[]>("/roles"), []);
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);
  const [savingChain, setSavingChain] = useState(false);

  const saveType = async () => {
    if (!editing) return;
    try {
      const body = { code: editing.code, name: editing.name, annual_quota: Number(editing.annual_quota ?? 0), is_paid: editing.is_paid ?? true,
        is_unlimited: editing.is_unlimited ?? false, is_active: editing.is_active ?? true };
      if (editing.id) await api.put(`/leaves/types/${editing.id}`, body);
      else await api.post("/leaves/types", body);
      toast.success("Leave type saved");
      setEditing(null);
      void reloadTypes();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const updateStep = (index: number, patch: Partial<ChainStep>) =>
    setChain(chain?.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, dir: -1 | 1) => {
    if (!chain) return;
    const next = [...chain];
    [next[index], next[index + dir]] = [next[index + dir], next[index]];
    setChain(next);
  };
  const saveChain = async () => {
    setSavingChain(true);
    try {
      await api.put("/leaves/approval-chain", {
        steps: (chain ?? []).map((s) => ({ approver_type: s.approver_type, role_id: s.approver_type === "role" ? s.role_id : null, min_days: s.min_days || null })),
      });
      toast.success("Approval chain saved. New requests will use it.");
      void reloadChain();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingChain(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Approval chain" description="Steps run in order. Steps without an eligible approver are skipped; an administrator decides if all are skipped."
          action={<Button size="sm" loading={savingChain} onClick={saveChain}>Save chain</Button>} />
        <div className="space-y-3 p-5">
          {chain?.map((step, i) => (
            <motion.div key={`${i}-${step.approver_type}`} layout className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{i + 1}</span>
              <Select value={step.approver_type} onChange={(e) => updateStep(i, { approver_type: e.target.value as ChainStep["approver_type"] })} className="sm:w-48">
                <option value="primary_manager">Reporting manager</option>
                <option value="skip_level_manager">Manager's manager</option>
                <option value="department_head">Department head</option>
                <option value="role">Anyone with a role</option>
              </Select>
              {step.approver_type === "role" && (
                <Select value={step.role_id ?? ""} onChange={(e) => updateStep(i, { role_id: Number(e.target.value) })} className="sm:w-48">
                  <option value="">Choose role</option>
                  {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              )}
              <Input type="number" min={1} placeholder="Min days" value={step.min_days ?? ""} className="sm:w-28"
                onChange={(e) => updateStep(i, { min_days: e.target.value ? Number(e.target.value) : null })} aria-label="Only for requests of at least N days" />
              <div className="flex gap-1 sm:ml-auto">
                <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" disabled={i === (chain?.length ?? 0) - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setChain(chain?.filter((_, j) => j !== i))} aria-label="Remove step"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </motion.div>
          ))}
          <Button variant="subtle" size="sm" disabled={(chain?.length ?? 0) >= 10}
            onClick={() => setChain([...(chain ?? []), { step_order: (chain?.length ?? 0) + 1, approver_type: "primary_manager", approver_label: "", role_id: null, role_name: null, min_days: null }])}>
            <Plus className="h-4 w-4" /> Add step
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Leave types" action={<Button size="sm" onClick={() => setEditing({ is_paid: true, is_active: true, annual_quota: 0 })}><Plus className="h-4 w-4" /> Add type</Button>} />
        <DataTable rows={types} loading={!types} rowKey={(t) => t.id} onRowClick={(t) => setEditing(t)}
          columns={[
            { key: "name", header: "Type", cell: (t) => <div><p className="font-medium">{t.name}</p><p className="font-mono text-xs text-muted-foreground">{t.code}</p></div> },
            { key: "quota", header: "Per year", cell: (t) => (t.is_unlimited ? "Unlimited" : `${t.annual_quota} days`) },
            { key: "paid", header: "Paid", cell: (t) => (t.is_paid ? "Yes" : "No"), hideOnMobile: true },
            { key: "active", header: "Status", cell: (t) => <StatusBadge status={t.is_active ? "active" : "deactivated"} label={t.is_active ? "Active" : "Inactive"} /> },
          ]} />
      </Card>
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit leave type" : "New leave type"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveType}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Code" hint="Lowercase, e.g. study_leave">
                <Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
              </Field>
            </div>
            <Field label="Days per year"><Input type="number" min={0} disabled={editing.is_unlimited} value={editing.annual_quota ?? 0}
              onChange={(e) => setEditing({ ...editing, annual_quota: Number(e.target.value) })} /></Field>
            {([["is_unlimited", "Unlimited"], ["is_paid", "Paid leave"], ["is_active", "Active"]] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                {label}
                <Switch checked={!!editing[key]} onChange={(v) => setEditing({ ...editing, [key]: v })} label={label} />
              </label>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
