"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check, CornerUpLeft, Eye, EyeOff, FilePlus2, FileText, Inbox, Paperclip, Plus, Receipt, Send, Trash2, Undo2, Users, X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  BATCH_STATUS, teamPayrollApi, type Batch, type BatchLine, type ContractorInvoice, type InputComponent, type TeamMember,
} from "@/lib/teamPayroll";
import { useTabParam } from "@/lib/useTabParam";

const TABS = ["team", "batches", "approvals", "invoices"] as const;
type Tab = (typeof TABS)[number];

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}` };
}

async function run(action: () => Promise<unknown>, done: string, after?: () => void) {
  try {
    await action();
    toast.success(done);
    after?.();
  } catch (e) {
    toast.error(toApiError(e).message);
  }
}

/** Payroll › Team payroll: managers prepare and submit their team's one-time pay inputs (with files) and contractor
 * invoices; payroll approves, returns or rejects; approved lines become approved wage inputs. */
export function TeamPayroll() {
  const team = useApi(() => teamPayrollApi.team(), []);
  const [tab, setTab] = useTabParam<Tab>(TABS, "team");
  const search = useSearchParams();
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const [editing, setEditing] = useState<Batch | "new" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    const id = Number(search?.get("batch"));
    if (id) setOpenBatch(id);
  }, [search]);
  // Payroll approvers without a team land on their queue.
  const approverOnly = !!team.data && !team.data.can_submit && team.data.items.length === 0 && team.data.can_approve;
  useEffect(() => {
    if (approverOnly && tab === "team") setTab("approvals");
  }, [approverOnly, tab, setTab]);

  if (team.error) return <ErrorState message={team.error.message} onRetry={team.reload} />;
  if (!team.data) return <Skeleton className="h-96" />;
  const view = team.data;
  const tabs = [
    ...(approverOnly ? [] : [{ value: "team", label: "My team" }]),
    ...(view.can_submit ? [{ value: "batches", label: "Pay inputs" }] : []),
    ...(view.can_approve ? [{ value: "approvals", label: "Payroll approvals" }] : []),
    ...(view.can_submit || view.items.length ? [{ value: "invoices", label: "Contractor invoices" }] : []),
  ];
  return (
    <div className="space-y-4" data-testid="team-payroll">
      <PageHeader eyebrow="Payroll" title="Team payroll"
        description="Prepare one-time pay inputs and contractor invoices for your team. Payroll reviews, approves and commits them to the pay run."
        actions={view.can_submit ? (
          <Button data-testid="batch-new" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New pay inputs</Button>
        ) : undefined} />
      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabPanel value="team">{tab === "team" && <TeamList items={view.items} amounts={view.amounts} />}</TabPanel>
        <TabPanel value="batches">{tab === "batches" && <BatchList box="mine" key={`m${reloadKey}`} onOpen={setOpenBatch} />}</TabPanel>
        <TabPanel value="approvals">{tab === "approvals" && <BatchList box="approvals" key={`a${reloadKey}`} onOpen={setOpenBatch} />}</TabPanel>
        <TabPanel value="invoices">{tab === "invoices" && <ContractorInvoices team={view.items} canSubmit={view.can_submit} />}</TabPanel>
      </Tabs>
      {editing && (
        <BatchEditor batch={editing === "new" ? null : editing} team={view.items} onClose={() => setEditing(null)}
          onSaved={(b) => { setEditing(null); refresh(); setOpenBatch(b.id); if (tab !== "batches") setTab("batches"); }} />
      )}
      <BatchSheet id={openBatch} onClose={() => setOpenBatch(null)} onChanged={refresh}
        onEdit={(b) => { setOpenBatch(null); setEditing(b); }} />
    </div>
  );
}

function TeamList({ items, amounts }: { items: TeamMember[]; amounts: boolean }) {
  if (items.length === 0) {
    return <Card><EmptyState icon={<Users />} title="Nobody in your team yet" description="People who report to you, or teams you lead, appear here." /></Card>;
  }
  return (
    <Card className="p-0" data-testid="team-list">
      <p className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        {amounts ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        {amounts ? "You may see pay amounts of your team." : "Pay amounts are hidden at your security level; you see statuses only."}
      </p>
      <ul className="divide-y divide-border">
        {items.map((m, i) => (
          <motion.li key={m.employee_id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}
            className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`team-member-${m.employee_id}`}>
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{[m.employee_code, m.position].filter(Boolean).join(" · ")}</p>
            </div>
            {m.pending_lines > 0 && <Badge tone="info">{m.pending_lines} input{m.pending_lines === 1 ? "" : "s"} in progress</Badge>}
            {m.last_run ? (
              <span className="text-right text-xs">
                <StatusBadge status={m.last_run.finalized ? "completed" : "pending"} label={m.last_run.finalized ? "Last run finalized" : `Run ${m.last_run.run_status.toLowerCase()}`} />
                {m.amounts_visible && m.last_run.net != null && (
                  <span className="mt-1 block font-medium" data-testid="member-net">Net {fmtMoney(m.last_run.net, m.last_run.currency)}</span>
                )}
              </span>
            ) : <Badge>Not in a run yet</Badge>}
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function BatchList({ box, onOpen }: { box: "mine" | "approvals"; onOpen: (id: number) => void }) {
  const { data, error, reload } = useApi(() => teamPayrollApi.batches(box), [box]);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-40" />;
  if (data.items.length === 0) {
    return (
      <Card><EmptyState icon={<Inbox />} title={box === "mine" ? "No pay inputs yet" : "Nothing waiting"}
        description={box === "mine" ? "Choose New pay inputs to add bonuses, incentives or hours for your team." :
          "Team pay inputs submitted by managers appear here."} /></Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={`batches-${box}`}>
      <AnimatePresence initial={false}>
        {data.items.map((b, i) => {
          const status = BATCH_STATUS[b.status];
          return (
            <motion.button key={b.id} layout type="button" onClick={() => onOpen(b.id)} data-testid={`batch-${b.id}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}
              className="rounded-2xl border border-border/80 bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{b.title}</p>
                <Badge tone={status.tone} dot><span data-testid="batch-status">{status.label}</span></Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{fmtDate(b.period_start)} – {fmtDate(b.period_end)}</p>
              <p className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge>{b.line_count} line{b.line_count === 1 ? "" : "s"}</Badge>
                {b.file_count > 0 && <Badge><Paperclip className="h-3 w-3" /> {b.file_count}</Badge>}
                {b.decision_note && <span className="text-muted-foreground">“{b.decision_note}”</span>}
              </p>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

const emptyLine = (): BatchLine => ({ employee_id: 0, component_code: "", amount: "", units: "", rate: "", reason: "" });

function BatchEditor({ batch, team, onClose, onSaved }: {
  batch: Batch | null; team: TeamMember[]; onClose: () => void; onSaved: (b: Batch) => void;
}) {
  const range = monthRange();
  const components = useApi(() => teamPayrollApi.components(), []);
  const [title, setTitle] = useState(batch?.title ?? "");
  const [start, setStart] = useState(batch?.period_start ?? range.start);
  const [end, setEnd] = useState(batch?.period_end ?? range.end);
  const [notes, setNotes] = useState(batch?.notes ?? "");
  const [lines, setLines] = useState<BatchLine[]>(batch?.lines?.length ? batch.lines.map((l) => ({ ...l })) : [emptyLine()]);
  const [saving, setSaving] = useState(false);
  const byCode = useMemo(() => new Map((components.data?.items ?? []).map((c) => [c.code, c])), [components.data]);
  const setLine = (i: number, patch: Partial<BatchLine>) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const valid = title.trim().length >= 3 && lines.length > 0 && lines.every((l) => {
    const c = byCode.get(l.component_code);
    return l.employee_id > 0 && c && l.reason.trim().length >= 3 && (c.units_based ? !!l.units : !!l.amount);
  });
  const save = async () => {
    setSaving(true);
    const body = {
      title: title.trim(), period_start: start, period_end: end, notes: notes.trim() || null,
      lines: lines.map((l) => {
        const c = byCode.get(l.component_code) as InputComponent;
        return { employee_id: l.employee_id, component_code: l.component_code, reason: l.reason.trim(),
          amount: c.units_based ? null : l.amount || null, units: c.units_based ? l.units || null : null,
          rate: c.units_based ? l.rate || null : null };
      }),
    };
    try {
      const saved = batch ? await teamPayrollApi.update(batch.id, body) : await teamPayrollApi.create(body);
      toast.success(batch ? "Pay inputs updated" : "Pay inputs saved as a draft");
      onSaved(saved);
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="xl" title={batch ? `Edit “${batch.title}”` : "New pay inputs"}
      description="One-time amounts (bonus, incentive, arrears) or hours for your team. Payroll checks and approves them."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="batch-save" loading={saving} disabled={!valid} onClick={() => void save()}>Save draft</Button></>}>
      <div className="space-y-4" data-testid="batch-editor">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title" required className="sm:col-span-3"><Input data-testid="batch-title" value={title} maxLength={120}
            onChange={(e) => setTitle(e.target.value)} placeholder="March incentives" /></Field>
          <Field label="Pay period from"><Input type="date" data-testid="batch-start" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="to"><Input type="date" data-testid="batch-end" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => {
              const c = byCode.get(l.component_code);
              return (
                <motion.div key={i} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="grid items-end gap-2 rounded-2xl border border-border p-3 md:grid-cols-[1.4fr_1.2fr_0.8fr_0.8fr_1.6fr_auto]" data-testid={`batch-line-${i}`}>
                  <Field label="Employee"><Select data-testid={`line-employee-${i}`} value={l.employee_id || ""} onChange={(e) => setLine(i, { employee_id: Number(e.target.value) })}>
                    <option value="">Choose</option>{team.map((m) => <option key={m.employee_id} value={m.employee_id}>{m.name}</option>)}</Select></Field>
                  <Field label="Pay item"><Select data-testid={`line-component-${i}`} value={l.component_code} onChange={(e) => setLine(i, { component_code: e.target.value })}>
                    <option value="">Choose</option>{(components.data?.items ?? []).map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}</Select></Field>
                  {c?.units_based ? (
                    <>
                      <Field label="Units"><Input data-testid={`line-units-${i}`} inputMode="decimal" value={l.units ?? ""} onChange={(e) => setLine(i, { units: e.target.value })} /></Field>
                      <Field label="Rate (optional)"><Input data-testid={`line-rate-${i}`} inputMode="decimal" value={l.rate ?? ""} onChange={(e) => setLine(i, { rate: e.target.value })} /></Field>
                    </>
                  ) : (
                    <Field label="Amount" className="md:col-span-2"><Input data-testid={`line-amount-${i}`} inputMode="decimal" value={l.amount ?? ""}
                      onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="2500.00" /></Field>
                  )}
                  <Field label="Reason"><Input data-testid={`line-reason-${i}`} value={l.reason} maxLength={500} onChange={(e) => setLine(i, { reason: e.target.value })} /></Field>
                  <Button variant="danger-ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1}
                    onClick={() => setLines(lines.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></Button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <Button variant="subtle" size="sm" data-testid="batch-add-line" disabled={lines.length >= 200} onClick={() => setLines([...lines, emptyLine()])}>
            <Plus className="h-4 w-4" /> Add line</Button>
        </div>
        <Field label="Notes for payroll"><Textarea data-testid="batch-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function BatchSheet({ id, onClose, onChanged, onEdit }: {
  id: number | null; onClose: () => void; onChanged: () => void; onEdit: (b: Batch) => void;
}) {
  const { data, error, reload } = useApi(() => (id ? teamPayrollApi.batch(id) : Promise.resolve(null)), [id]);
  const [deciding, setDeciding] = useState<"reject" | "return" | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const after = () => { void reload(); onChanged(); };
  const b = data ?? null;
  const upload = async (file: File | undefined) => {
    if (!file || !b) return;
    setUploading(true);
    await run(() => teamPayrollApi.addFile(b.id, file), "File attached", after);
    setUploading(false);
  };
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()} width="max-w-2xl" title={b ? b.title : "Pay inputs"}
      description={b ? `${fmtDate(b.period_start)} – ${fmtDate(b.period_end)}` : undefined}>
      {error ? <ErrorState message={error.message} onRetry={reload} /> : !b ? <Skeleton className="h-64" /> : (
        <div className="space-y-4" data-testid="batch-sheet">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={BATCH_STATUS[b.status].tone} dot><span data-testid="batch-sheet-status">{BATCH_STATUS[b.status].label}</span></Badge>
            {b.submitted_at && <span className="text-xs text-muted-foreground">Submitted {fmtDateTime(b.submitted_at)}</span>}
            {b.decision_note && <span className="text-xs">Payroll note: “{b.decision_note}”</span>}
          </div>
          <Card className="p-0">
            <table className="w-full text-sm" data-testid="batch-lines">
              <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">
                <th className="px-3 py-2">Employee</th><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Amount / units</th><th className="px-3 py-2">Reason</th></tr></thead>
              <tbody>{(b.lines ?? []).map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{l.employee_name}</td><td className="px-3 py-2">{l.component_code}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.amount ?? `${l.units} u${l.rate ? ` × ${l.rate}` : ""}`}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.reason}{l.wage_input_id ? <Badge tone="success" className="ml-2">Wage input #{l.wage_input_id}</Badge> : null}</td>
                </tr>))}</tbody>
            </table>
          </Card>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><Paperclip className="h-4 w-4" /> Supporting files</p>
            {(b.files ?? []).length === 0 && <p className="text-xs text-muted-foreground">No files attached.</p>}
            <ul className="space-y-1" data-testid="batch-files">{(b.files ?? []).map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <a className="text-primary underline-offset-2 hover:underline" href={teamPayrollApi.fileUrl(b.id, f.id)} target="_blank" rel="noreferrer">{f.file_name}</a>
                <span className="text-xs text-muted-foreground">{Math.ceil(f.size_bytes / 1024)} KB</span>
                {b.can?.edit && <Button size="icon" variant="danger-ghost" aria-label={`Remove ${f.file_name}`}
                  onClick={() => void run(() => teamPayrollApi.removeFile(b.id, f.id), "File removed", after)}><X className="h-4 w-4" /></Button>}
              </li>))}</ul>
            {b.can?.edit && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm hover:bg-muted">
                <FilePlus2 className="h-4 w-4" /> {uploading ? "Uploading…" : "Attach PDF, image, CSV or Excel (≤ 5 MB)"}
                <input type="file" className="sr-only" data-testid="batch-file-input" accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx"
                  onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {b.can?.edit && <Button variant="secondary" data-testid="batch-edit" onClick={() => onEdit(b)}>Edit</Button>}
            {b.can?.submit && <Button data-testid="batch-submit" onClick={() => void run(() => teamPayrollApi.submit(b.id), "Sent to payroll", after)}>
              <Send className="h-4 w-4" /> Submit to payroll</Button>}
            {b.can?.withdraw && <Button variant="ghost" data-testid="batch-withdraw" onClick={() => void run(() => teamPayrollApi.withdraw(b.id), "Withdrawn", after)}>
              <Undo2 className="h-4 w-4" /> Withdraw</Button>}
            {b.can?.decide && (
              <>
                <Button variant="success" data-testid="batch-approve" onClick={() => void run(() => teamPayrollApi.decide(b.id, "approve"), "Committed to payroll", after)}>
                  <Check className="h-4 w-4" /> Approve & commit</Button>
                <Button variant="secondary" data-testid="batch-return" onClick={() => setDeciding("return")}><CornerUpLeft className="h-4 w-4" /> Return</Button>
                <Button variant="danger-ghost" data-testid="batch-reject" onClick={() => setDeciding("reject")}><X className="h-4 w-4" /> Reject</Button>
              </>
            )}
          </div>
          <Modal open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}
            title={deciding === "return" ? "Return to the manager" : "Reject pay inputs"}
            footer={<><Button variant="secondary" onClick={() => setDeciding(null)}>Cancel</Button>
              <Button data-testid="batch-decide-confirm" disabled={note.trim().length < 3}
                onClick={() => deciding && void run(() => teamPayrollApi.decide(b.id, deciding, note.trim()),
                  deciding === "return" ? "Returned for changes" : "Rejected", () => { setDeciding(null); setNote(""); after(); })}>
                {deciding === "return" ? "Return" : "Reject"}</Button></>}>
            <Field label="Note for the manager"><Textarea data-testid="batch-decide-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </Modal>
        </div>
      )}
    </Sheet>
  );
}

const INVOICE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", ISSUED: "info", APPROVED: "success", PAID: "success", CREDITED: "warning", CANCELLED: "danger",
};

function ContractorInvoices({ team, canSubmit }: { team: TeamMember[]; canSubmit: boolean }) {
  const list = useApi(() => teamPayrollApi.teamInvoices(), []);
  const [drafting, setDrafting] = useState(false);
  return (
    <div className="space-y-3" data-testid="team-invoices">
      {canSubmit && <div className="flex justify-end"><Button data-testid="invoice-new" onClick={() => setDrafting(true)}><Receipt className="h-4 w-4" /> Draft invoice from timesheets</Button></div>}
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <Skeleton className="h-32" /> :
        list.data.items.length === 0 ? <Card><EmptyState icon={<Receipt />} title="No contractor invoices" description="Invoices you draft for contractors in your team appear here while payroll issues and approves them." /></Card> : (
          <Card className="p-0"><ul className="divide-y divide-border">{list.data.items.map((inv: ContractorInvoice) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`team-invoice-${inv.id}`}>
              <Receipt className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm"><span className="font-medium">{inv.payee_name}</span> · {inv.number ?? inv.external_number ?? `Draft #${inv.id}`}</span>
              <span className="tabular-nums text-sm">{fmtMoney(inv.total.amount, inv.total.currency)}</span>
              <Badge tone={INVOICE_TONE[inv.status] ?? "neutral"} dot>{inv.status.toLowerCase()}</Badge>
            </li>))}</ul></Card>
        )}
      {drafting && <InvoiceDraft team={team} onClose={() => setDrafting(false)} onDone={() => { setDrafting(false); void list.reload(); }} />}
    </div>
  );
}

function InvoiceDraft({ team, onClose, onDone }: { team: TeamMember[]; onClose: () => void; onDone: () => void }) {
  const [payee, setPayee] = useState(0);
  const sheets = useApi(() => (payee ? teamPayrollApi.timesheets(payee) : Promise.resolve({ items: [] })), [payee]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [external, setExternal] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setChosen([]), [payee]);
  const save = async () => {
    setSaving(true);
    await run(() => teamPayrollApi.createInvoice({ mode: "INVOICE", payee_employee_id: payee, timesheet_ids: chosen,
      hourly_rate: rate, currency, external_number: external.trim() || null }), "Invoice drafted; payroll issues it", onDone);
    setSaving(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title="Draft a contractor invoice"
      description="Approved timesheet weeks × the agreed hourly rate. Payroll issues and approves the invoice."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="invoice-save" loading={saving} disabled={!payee || chosen.length === 0 || !(Number(rate) > 0) || !external.trim()}
          onClick={() => void save()}>Draft invoice</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="invoice-form">
        <Field label="Contractor" className="sm:col-span-2"><Select data-testid="invoice-payee" value={payee || ""} onChange={(e) => setPayee(Number(e.target.value))}>
          <option value="">Choose</option>{team.map((m) => <option key={m.employee_id} value={m.employee_id}>{m.name}</option>)}</Select></Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">Approved weeks</p>
          {sheets.error ? <p className="text-sm text-danger">{sheets.error.message}</p> : !payee ? <p className="text-xs text-muted-foreground">Choose a contractor first.</p> :
            (sheets.data?.items ?? []).length === 0 ? <p className="text-xs text-muted-foreground" data-testid="invoice-no-weeks">No approved weeks waiting to be invoiced.</p> : (
              <ul className="space-y-1" data-testid="invoice-weeks">{(sheets.data?.items ?? []).map((s) => (
                <li key={s.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`invoice-week-${s.id}`}
                  checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />
                  {fmtDate(s.period_start)} – {fmtDate(s.period_end)}</label></li>))}</ul>
            )}
        </div>
        <Field label="Hourly rate"><Input data-testid="invoice-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="500" /></Field>
        <Field label="Currency"><Input data-testid="invoice-currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
        <Field label="Contractor's invoice number" className="sm:col-span-2"><Input data-testid="invoice-external" value={external} maxLength={60} onChange={(e) => setExternal(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
