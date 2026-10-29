"use client";

import { motion } from "framer-motion";
import { Ban, BadgeCheck, Calculator, Download, FileText, Plus, Receipt, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { payrollApi } from "@/lib/payroll/api";
import { COST_GROUPS, teamPayrollApi, type ContractorInvoice, type CostInvoice } from "@/lib/teamPayroll";
import { useTabParam } from "@/lib/useTabParam";

const TABS = ["contractors", "cost"] as const;
type Tab = (typeof TABS)[number];
const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", ISSUED: "info", APPROVED: "success", PAID: "success", CREDITED: "warning", CANCELLED: "danger", VOID: "danger",
};

async function run(action: () => Promise<unknown>, done: string, after?: () => void) {
  try {
    await action();
    toast.success(done);
    after?.();
  } catch (e) {
    toast.error(toApiError(e).message);
  }
}

/** Payroll › Invoices: contractor invoices (managers or payroll draft; payroll issues, finance approves — never the
 * same person) and payroll-cost invoices of finalized runs per cost group (maker-checker issue, PDF, void). */
export function InvoicesWorkspace() {
  const [tab, setTab] = useTabParam<Tab>(TABS, "contractors");
  return (
    <div className="space-y-4" data-testid="invoices-workspace">
      <PageHeader eyebrow="Payroll" title="Invoices"
        description="Review, issue and approve contractor invoices, and bill payroll costs of finalized runs to cost centres or clients." />
      <Tabs tabs={[{ value: "contractors", label: "Contractor invoices" }, { value: "cost", label: "Payroll cost invoices" }]}
        value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabPanel value="contractors">{tab === "contractors" && <ContractorList />}</TabPanel>
        <TabPanel value="cost">{tab === "cost" && <CostInvoices />}</TabPanel>
      </Tabs>
    </div>
  );
}

function ContractorList() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi(() => teamPayrollApi.invoices(status || undefined), [status]);
  const [crediting, setCrediting] = useState<ContractorInvoice | null>(null);
  const [reason, setReason] = useState("");
  const download = async (inv: ContractorInvoice) => {
    try {
      const { url } = await teamPayrollApi.invoiceLink(inv.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Select data-testid="invoice-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
        <option value="">All statuses</option>{["DRAFT", "ISSUED", "APPROVED", "PAID", "CREDITED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select></div>
      {error ? <ErrorState message={error.message} onRetry={reload} /> : !data ? <Skeleton className="h-40" /> :
        data.items.length === 0 ? <Card><EmptyState icon={<Receipt />} title="No contractor invoices" description="Drafts from managers (Team payroll) and payroll appear here." /></Card> : (
          <Card className="p-0"><ul className="divide-y divide-border" data-testid="contractor-invoices">{data.items.map((inv, i) => (
            <motion.li key={inv.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}
              className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`contractor-invoice-${inv.id}`}>
              <FileText className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{(inv as ContractorInvoice & { payee?: { name?: string } | null }).payee?.name ?? `Payee #${inv.payee_employee_id}`} · {inv.number ?? `Draft #${inv.id}`}</p>
                <p className="text-xs text-muted-foreground">{inv.lines.length} line(s){inv.external_number ? ` · their no. ${inv.external_number}` : ""}{inv.issue_date ? ` · issued ${fmtDate(inv.issue_date)}` : ""}</p>
              </div>
              <span className="tabular-nums text-sm font-medium">{fmtMoney(inv.total.amount, inv.total.currency)}</span>
              <Badge tone={TONE[inv.status] ?? "neutral"} dot><span data-testid="contractor-invoice-status">{inv.status.toLowerCase()}</span></Badge>
              <div className="flex gap-1">
                {inv.status === "DRAFT" && <Button size="sm" data-testid={`invoice-issue-${inv.id}`} onClick={() => void run(() => teamPayrollApi.issueInvoice(inv.id, inv.row_version), "Invoice issued", reload)}><Send className="h-4 w-4" /> Issue</Button>}
                {inv.status === "ISSUED" && <Button size="sm" variant="success" data-testid={`invoice-approve-${inv.id}`} onClick={() => void run(() => teamPayrollApi.approveInvoice(inv.id, inv.row_version), "Invoice approved for payment", reload)}><BadgeCheck className="h-4 w-4" /> Approve</Button>}
                {inv.document_id && <Button size="sm" variant="secondary" aria-label="Download PDF" onClick={() => void download(inv)}><Download className="h-4 w-4" /></Button>}
                {(inv.status === "ISSUED" || inv.status === "APPROVED") && <Button size="sm" variant="danger-ghost" data-testid={`invoice-credit-${inv.id}`} onClick={() => setCrediting(inv)}><Ban className="h-4 w-4" /> Credit note</Button>}
              </div>
            </motion.li>))}</ul></Card>
        )}
      <Modal open={crediting !== null} onOpenChange={(o) => !o && setCrediting(null)} title="Cancel with a credit note"
        description="The invoice stays on record; a credit note cancels it and its number is never reused."
        footer={<><Button variant="secondary" onClick={() => setCrediting(null)}>Close</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} data-testid="invoice-credit-confirm"
            onClick={() => crediting && void run(() => teamPayrollApi.creditInvoice(crediting.id, reason.trim()), "Credit note issued",
              () => { setCrediting(null); setReason(""); void reload(); })}>Issue credit note</Button></>}>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

interface RunRow { id: number; number: string; label: string | null; status: string; period: { start: string; end: string } | null }

function CostInvoices() {
  const runs = useApi(() => payrollApi.get<{ items: RunRow[] }>("/payroll/runs", { params: { limit: 100 } }), []);
  const list = useApi(() => teamPayrollApi.costInvoices(), []);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<CostInvoice | null>(null);
  const [reason, setReason] = useState("");
  const finalized = (runs.data?.items ?? []).filter((r) => ["FINALIZED", "PAID", "PARTIALLY_PAID", "CLOSED", "PAYMENTS_IN_PROGRESS"].includes(r.status));
  return (
    <div className="space-y-3" data-testid="cost-invoices">
      <div className="flex justify-end"><Button data-testid="cost-new" disabled={!finalized.length} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New cost invoice</Button></div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <Skeleton className="h-40" /> :
        list.data.items.length === 0 ? <Card><EmptyState icon={<Calculator />} title="No payroll cost invoices"
          description={finalized.length ? "Bill a finalized run's cost (gross + employer contributions + fee) to a cost group." : "Cost invoices are made from finalized runs."} /></Card> : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="cost-list">{list.data.items.map((c) => (
            <Card key={c.id} className="space-y-2 p-4" data-testid={`cost-invoice-${c.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-medium">{c.number ?? `Draft #${c.id}`} · {c.group_label}</p>
                  <p className="text-xs text-muted-foreground">Run {c.run_id} · {c.employee_count} people · fee {c.fee_percent}%</p></div>
                <Badge tone={TONE[c.status]} dot><span data-testid="cost-status">{c.status.toLowerCase()}</span></Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Gross</dt><dd className="text-right tabular-nums">{fmtMoney(c.gross_total, c.currency)}</dd>
                <dt className="text-muted-foreground">Employer</dt><dd className="text-right tabular-nums">{fmtMoney(c.employer_total, c.currency)}</dd>
                <dt className="text-muted-foreground">Fee</dt><dd className="text-right tabular-nums">{fmtMoney(c.fee_total, c.currency)}</dd>
                <dt className="text-muted-foreground">Tax</dt><dd className="text-right tabular-nums">{fmtMoney(c.tax_total, c.currency)}</dd>
                <dt className="font-medium">Total</dt><dd className="text-right font-semibold tabular-nums" data-testid="cost-total">{fmtMoney(c.total, c.currency)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                {c.status === "DRAFT" && <Button size="sm" data-testid={`cost-issue-${c.id}`} onClick={() => void run(() => teamPayrollApi.issueCost(c.id, c.row_version), "Cost invoice issued", list.reload)}><Send className="h-4 w-4" /> Issue</Button>}
                <a href={teamPayrollApi.costPdfUrl(c.id)} target="_blank" rel="noreferrer" data-testid={`cost-pdf-${c.id}`}
                  className="inline-flex h-8 items-center gap-2 rounded-xl border border-border px-3 text-xs font-medium hover:bg-surface-muted"><Download className="h-4 w-4" /> PDF</a>
                {c.status !== "VOID" && <Button size="sm" variant="danger-ghost" data-testid={`cost-void-${c.id}`} onClick={() => setVoiding(c)}><Trash2 className="h-4 w-4" /> Void</Button>}
              </div>
            </Card>))}</div>
        )}
      {creating && <CostDraft runs={finalized} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void list.reload(); }} />}
      <Modal open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)} title="Void cost invoice"
        footer={<><Button variant="secondary" onClick={() => setVoiding(null)}>Close</Button>
          <Button variant="danger" data-testid="cost-void-confirm" disabled={reason.trim().length < 3}
            onClick={() => voiding && void run(() => teamPayrollApi.voidCost(voiding.id, reason.trim()), "Invoice void",
              () => { setVoiding(null); setReason(""); void list.reload(); })}>Void</Button></>}>
        <Field label="Reason"><Textarea data-testid="cost-void-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function CostDraft({ runs, onClose, onDone }: { runs: RunRow[]; onClose: () => void; onDone: () => void }) {
  const [runId, setRunId] = useState(runs[0]?.id ?? 0);
  const [groupBy, setGroupBy] = useState<string>("COMPANY");
  const preview = useApi(() => (runId ? teamPayrollApi.costPreview(runId, groupBy) : Promise.resolve(null)), [runId, groupBy]);
  const [groupKey, setGroupKey] = useState<string>("");
  const [fee, setFee] = useState("0");
  const [taxLabel, setTaxLabel] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [billTo, setBillTo] = useState({ name: "", address: "", tax_registration: "", reference: "" });
  const [saving, setSaving] = useState(false);
  const groups = preview.data?.groups ?? [];
  const selected = groups.find((g) => String(g.group_id ?? "") === groupKey) ?? (groups.length === 1 ? groups[0] : undefined);
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    await run(() => teamPayrollApi.createCost({
      run_id: runId, group_by: groupBy, group_id: selected.group_id, fee_percent: fee || "0",
      taxes: taxLabel.trim() && taxRate ? [{ label: taxLabel.trim(), rate_percent: taxRate }] : [],
      bill_to: Object.fromEntries(Object.entries(billTo).map(([k, v]) => [k, v.trim() || null])),
    }), "Cost invoice drafted — another payroll approver issues it", onDone);
    setSaving(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title="New payroll cost invoice"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="cost-save" loading={saving} disabled={!selected} onClick={() => void save()}>Draft invoice</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="cost-form">
        <Field label="Finalized run"><Select data-testid="cost-run" value={runId} onChange={(e) => setRunId(Number(e.target.value))}>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.label ?? r.number}{r.period ? ` (${fmtDate(r.period.start)})` : ""}</option>)}</Select></Field>
        <Field label="Cost group"><Select data-testid="cost-group-by" value={groupBy} onChange={(e) => { setGroupBy(e.target.value); setGroupKey(""); }}>
          {COST_GROUPS.map((g) => <option key={g} value={g}>{g.replace("_", " ").toLowerCase()}</option>)}</Select></Field>
        <div className="sm:col-span-2">
          {preview.error ? <p className="text-sm text-danger">{preview.error.message}</p> : !preview.data ? <Skeleton className="h-16" /> : (
            <ul className="space-y-1" data-testid="cost-groups">{groups.map((g) => (
              <li key={String(g.group_id)}><label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <input type="radio" name="cost-group" checked={selected === g} onChange={() => setGroupKey(String(g.group_id ?? ""))} />
                <span className="flex-1">{g.label} · {g.employees} people</span>
                <span className="tabular-nums">{fmtMoney(g.cost, preview.data?.currency)}</span></label></li>))}</ul>
          )}
        </div>
        <Field label="Service fee (%)"><Input data-testid="cost-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tax label"><Input data-testid="cost-tax-label" value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="GST" /></Field>
          <Field label="Tax %"><Input data-testid="cost-tax-rate" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="18" /></Field>
        </div>
        <Field label="Bill to (name)"><Input data-testid="cost-bill-name" value={billTo.name} onChange={(e) => setBillTo({ ...billTo, name: e.target.value })} /></Field>
        <Field label="Reference / PO"><Input value={billTo.reference} onChange={(e) => setBillTo({ ...billTo, reference: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={billTo.address} onChange={(e) => setBillTo({ ...billTo, address: e.target.value })} /></Field>
        <Field label="Tax registration"><Input value={billTo.tax_registration} onChange={(e) => setBillTo({ ...billTo, tax_registration: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
