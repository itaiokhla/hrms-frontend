"use client";

import { ArrowLeft, ExternalLink, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { MoneyText } from "@/components/payroll/MoneyText";
import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { paymentsApi } from "./api";
import { ConflictBanner, ErrorSummary, METHOD_LABELS, Notice, PaymentsNav, SandboxBadge, ValueDateNotice, WorkspaceHeader, fieldErrors, useEmployeeDirectory, useFundingAccounts } from "./shared";
import type { BankChangeWarning, BatchProposal, ExclusionItem, ProposedBatch, RunOption } from "./types";

/** Run states payments are prepared from (BATCHABLE_RUN_STATES in payment_batches.py). */
export const BATCHABLE_RUN_STATES = ["FINALIZED", "PAYMENT_READY", "SUBMITTED", "PARTIALLY_PAID", "PAID", "RECONCILED"];

export function runLabel(run: RunOption): string {
  const period = run.period ? `${fmtDate(run.period.start, "d MMM")} – ${fmtDate(run.period.end)}` : "";
  return [run.label || `Run #${run.id}`, run.pay_group?.name, period].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ result tables */

export function ExclusionsTable({ items, caption = "Excluded payments" }: { items: ExclusionItem[]; caption?: string }) {
  const employees = useEmployeeDirectory();
  const columns: Column<ExclusionItem>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (x) => employees.name(x.employee_id) },
    { key: "why", header: "Why it is excluded", cell: (x) => x.message },
    { key: "account", header: "Account", hideOnMobile: true, cell: (x) => <bdi dir="ltr" className="font-mono">{x.account ?? "—"}</bdi> },
    { key: "status", header: "Status", cell: (x) => <StatusChip vocabulary="instruction" code={x.status} /> },
    { key: "amount", header: "Amount", className: "text-end", cell: (x) => <MoneyText money={x.amount} /> },
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={items}
      rowKey={(x) => x.instruction_id}
      cardBelowMd
      empty={<p className="p-4 text-sm text-muted-foreground">Nothing excluded: every payment of the run is in a batch.</p>}
    />
  );
}

export function BankChangeWarnings({ items }: { items: BankChangeWarning[] }) {
  const employees = useEmployeeDirectory();
  if (!items.length) return null;
  return (
    <Notice tone="warning" title={`Bank details changed after approval for ${items.length} payment(s)`}>
      <ul className="mt-1 list-disc ps-5">
        {items.map((w) => (
          <li key={w.instruction_id}>
            {employees.name(w.employee_id)}: payment goes to <bdi dir="ltr">{w.snapshot_account ?? "the approved account"}</bdi> (the account approved at the time), not to the new details.
          </li>
        ))}
      </ul>
      <p className="mt-1">After the batch is created, an approver can proceed with the approved account or recreate those payments.</p>
    </Notice>
  );
}

function ProposedTable({ batches, fundingLabel }: { batches: ProposedBatch[]; fundingLabel: (id: number) => string }) {
  const multi = new Set(batches.map((b) => b.currency)).size > 1;
  const columns: Column<ProposedBatch>[] = [
    { key: "funding", header: "Funding account", primary: true, cell: (b) => fundingLabel(b.funding_account_id) },
    {
      key: "method",
      header: "Method",
      cell: (b) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {METHOD_LABELS[b.method] ?? b.method}
          {b.file_format && <span className="text-xs text-muted-foreground">{b.file_format}</span>}
          {b.sandbox && <SandboxBadge />}
        </span>
      ),
    },
    { key: "currency", header: "Currency", cell: (b) => (multi ? <CurrencyBadge code={b.currency} /> : b.currency) },
    { key: "count", header: "Payments", className: "text-end", cell: (b) => <span className="tabular-nums">{b.item_count}</span> },
    { key: "total", header: "Total", className: "text-end", cell: (b) => <MoneyText money={b.total} emphasis /> },
  ];
  return <DataTable caption="Proposed batches" columns={columns} rows={batches} rowKey={(b) => `${b.funding_account_id}-${b.currency}-${b.instruction_ids[0] ?? 0}`} cardBelowMd />;
}

/* ------------------------------------------------------------------ form */

/**
 * Create payment batch (3.8 §6, `?modal=new-batch&run=`): choose a finalized run, preview the
 * batches it would form by funding account, method and currency with every exclusion explained,
 * then create them (they go to approval). The same idempotency key is reused if "Create" is retried.
 */
export function CreateBatchForm({ initialRunId, onCreated, onCancel }: { initialRunId?: string | null; onCreated: (batchIds: number[]) => void; onCancel?: () => void }) {
  const funding = useFundingAccounts();
  const runs = useApi(() => paymentsApi.runs(), []);
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [method, setMethod] = useState("");
  const [fundingId, setFundingId] = useState("");
  const [valueDate, setValueDate] = useState("");
  const [proposal, setProposal] = useState<BatchProposal | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const createKey = useRef<string>(newIdempotencyKey());

  const options = useMemo(() => (runs.data?.items ?? []).filter((r) => BATCHABLE_RUN_STATES.includes(r.status)), [runs.data]);
  const selected = options.find((r) => String(r.id) === runId);
  const entityAccounts = funding.accounts.filter((a) => a.status === "ACTIVE" && (!selected || a.legal_entity_id === selected.legal_entity_id));

  // A new choice invalidates the preview and the create key.
  useEffect(() => {
    setProposal(null);
    createKey.current = newIdempotencyKey();
  }, [runId, method, fundingId]);

  const body = () => ({ run_id: Number(runId), method: method || null, funding_account_id: fundingId ? Number(fundingId) : null });

  const preview = async () => {
    if (!runId) {
      setError(null);
      return;
    }
    setBusy("preview");
    setError(null);
    try {
      setProposal(await paymentsApi.propose(body()));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const result = await paymentsApi.create({ ...body(), value_date: valueDate || null }, createKey.current);
      const n = result.batches.length;
      toast.success(`${n} payment batch${n === 1 ? "" : "es"} created and sent for approval`);
      onCreated(result.batches.map((b) => b.id));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const fundingLabel = (id: number) => funding.label(id);
  const count = proposal?.batches.length ?? 0;

  return (
    <div className="space-y-5">
      <ConflictBanner error={error} onReload={() => { setError(null); void preview(); }} />
      <ErrorSummary error={error} fields={fieldErrors(error)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Finalized pay run" required hint={runs.error ? "Pay runs couldn't be loaded; enter the run number." : undefined}>
          {runs.error || (!runs.loading && !options.length && runId) ? (
            <Input inputMode="numeric" value={runId} onChange={(e) => setRunId(e.target.value.replace(/\D/g, ""))} className="min-h-[44px]" />
          ) : (
            <Select value={runId} onChange={(e) => setRunId(e.target.value)} className="min-h-[44px]">
              <option value="">{runs.loading ? "Loading runs…" : options.length ? "Choose a run…" : "No finalized run yet"}</option>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Method" hint="Leave on the company default unless you need the other one.">
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="min-h-[44px]">
            <option value="">Company default</option>
            <option value="BANK_FILE">Bank file</option>
            <option value="API">Payout API (sandbox)</option>
          </Select>
        </Field>
        <Field label="Funding account" hint={funding.allowed ? "Leave on automatic to use the entity's account for each currency." : "Your role can't list funding accounts; batches use the entity's configured account."}>
          <Select value={fundingId} onChange={(e) => setFundingId(e.target.value)} disabled={!funding.allowed} className="min-h-[44px]">
            <option value="">Automatic</option>
            {entityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency} · {a.account_masked}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value date (optional)" hint="Defaults to the period's pay date.">
          <Input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} className="min-h-[44px]" />
        </Field>
      </div>

      {!proposal && (
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button className="min-h-[44px]" disabled={!runId} loading={busy === "preview"} onClick={preview}>
            Preview batches
          </Button>
        </div>
      )}

      {proposal && (
        <div className="space-y-4">
          <section aria-label="Proposed batches" className="space-y-2">
            <h3 className="text-sm font-semibold">{count ? `${count} batch${count === 1 ? "" : "es"} will be created` : "No batch can be created"}</h3>
            {count ? (
              <div className="rounded-2xl border border-border">
                <ProposedTable batches={proposal.batches} fundingLabel={fundingLabel} />
              </div>
            ) : (
              <EmptyState icon={<PackageCheck />} title="Nothing is ready to pay" description="Every payment of this run is excluded below. Fix the reasons (for example, missing bank accounts), then preview again." />
            )}
          </section>
          {!valueDate && proposal.value_date && (
            <ValueDateNotice warnings={proposal.value_date.warnings} valueDate={proposal.value_date.value_date} requested={proposal.value_date.requested} />
          )}
          {!valueDate && proposal.value_date && !proposal.value_date.warnings.length && (
            <p className="text-sm text-muted-foreground">Value date: {fmtDate(proposal.value_date.value_date)} (a business day of the bank).</p>
          )}
          {valueDate && <p className="text-sm text-muted-foreground">The server moves {fmtDate(valueDate)} to the next business day if the bank is closed, and the batch shows a warning if it falls after the pay date.</p>}
          <BankChangeWarnings items={proposal.bank_changes} />
          <section aria-label="Exclusions" className="space-y-2">
            <h3 className="text-sm font-semibold">Exclusions ({proposal.exclusions.length})</h3>
            <div className="rounded-2xl border border-border">
              <ExclusionsTable items={proposal.exclusions} />
            </div>
          </section>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-[44px]" onClick={() => setProposal(null)}>
              Change choices
            </Button>
            <Button className="min-h-[44px]" disabled={!count} loading={busy === "create"} onClick={create}>
              Create {count} batch{count === 1 ? "" : "es"} for approval
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateBatchModal({ open, onOpenChange, runId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; runId: string | null; onCreated: (ids: number[]) => void }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Create payment batch"
      description={
        <Link href={`/payroll/payments/new${runId ? `?run=${runId}` : ""}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
    >
      {open && <CreateBatchForm initialRunId={runId} onCreated={onCreated} onCancel={() => onOpenChange(false)} />}
    </Modal>
  );
}

/** Full page (`/payroll/payments/new?run=`). */
export function CreateBatchPage({ runId }: { runId: string | null }) {
  const router = useRouter();
  return (
    <div>
      <Link href="/payroll/payments" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Payout files
      </Link>
      <WorkspaceHeader title="Create payment batch" description="Batches are formed from a finalized run by funding account, method and currency. A second person approves them before release." />
      <PaymentsNav />
      <Card className="p-5">
        <CreateBatchForm initialRunId={runId} onCreated={(ids) => router.push(ids.length === 1 ? `/payroll/payments/batches/${ids[0]}` : "/payroll/payments")} />
      </Card>
    </div>
  );
}
