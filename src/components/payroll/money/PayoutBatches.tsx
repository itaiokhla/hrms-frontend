"use client";

import { Banknote, Clock, PackageOpen, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCan } from "@/components/access/Can";
import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { KpiCard } from "@/components/payroll/KpiCard";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { sumDecimalStrings, type Money } from "@/lib/money";
import { VOCABULARIES } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { CreateBatchModal } from "./CreateBatch";
import { paymentsApi } from "./api";
import { EvidenceNote, FilterBar, METHOD_LABELS, PaymentsNav, SandboxBadge, WorkspaceHeader, useFundingAccounts, useUserNames } from "./shared";
import type { PaymentBatch } from "./types";

const LIMIT = 50;

/** Per-currency totals of a list of money values (exact decimal-string sums; never across currencies). */
export function totalsByCurrency(values: (Money | null | undefined)[]): Money[] {
  const groups = new Map<string, string[]>();
  values.forEach((m) => {
    if (!m) return;
    groups.set(m.currency, [...(groups.get(m.currency) ?? []), m.amount]);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amounts]) => ({ currency, amount: sumDecimalStrings(amounts) }));
}

export function BatchStatus({ batch }: { batch: Pick<PaymentBatch, "status" | "submission_channel" | "sandbox"> }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusChip vocabulary="batch" code={batch.status} />
        {batch.sandbox && <SandboxBadge />}
      </span>
      {!batch.sandbox && <EvidenceNote channel={batch.submission_channel} evidence="UNVERIFIED" status={batch.status} />}
    </span>
  );
}

/**
 * Payroll › Payout Files (3.8 §5.12): batches with status, totals per currency, method, funding
 * account, preparer and releaser; "Create payment batch" (`?modal=new-batch&run=`).
 */
export function PayoutBatchesWorkspace() {
  const { me } = useCan();
  const router = useRouter();
  const userName = useUserNames();
  const funding = useFundingAccounts();
  const newBatch = useModalRoute("new-batch", { keys: ["run"] });
  const [status, setStatus] = useState("");
  const [run, setRun] = useState("");
  const runQ = useDebounced(run, 300);
  const [skip, setSkip] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading, reload } = useApi(() => paymentsApi.batches({ status, run_id: runQ || undefined, offset: skip, limit: LIMIT }), [status, runQ, skip, refresh]);
  // KPIs use the same endpoint with a status filter, so counts and drill-downs agree (EC-UX-03).
  const awaiting = useApi(() => paymentsApi.batches({ status: "APPROVAL_PENDING", limit: 200 }), [refresh]);
  const toRelease = useApi(() => paymentsApi.batches({ status: "FILE_GENERATED", limit: 200 }), [refresh]);
  const submitted = useApi(() => paymentsApi.batches({ status: "SUBMITTED", limit: 200 }), [refresh]);

  const prepare = can(me, P.PAYROLL_PAYMENT_PREPARE);
  const items = data?.items;
  const multiCurrency = useMemo(() => new Set((items ?? []).map((b) => b.currency)).size > 1, [items]);

  const columns: Column<PaymentBatch>[] = [
    {
      key: "reference",
      header: "Batch",
      primary: true,
      cell: (b) => (
        <span className="flex flex-col">
          <bdi dir="ltr" className="font-mono text-sm font-medium">{b.reference}</bdi>
          {b.run_id && <span className="text-xs text-muted-foreground">Run #{b.run_id}</span>}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (b) => <BatchStatus batch={b} /> },
    {
      key: "total",
      header: "Total",
      className: "text-end",
      cell: (b) => (
        <span className="inline-flex items-center gap-2">
          {multiCurrency && <CurrencyBadge code={b.currency} />}
          <MoneyText money={b.total} emphasis />
          <span className="text-xs text-muted-foreground">· {b.item_count}</span>
        </span>
      ),
    },
    { key: "method", header: "Method", hideOnMobile: true, cell: (b) => `${METHOD_LABELS[b.method] ?? b.method}${b.file_format ? ` · ${b.file_format}` : ""}` },
    { key: "funding", header: "Funding account", hideOnMobile: true, cell: (b) => funding.label(b.funding_account_id) },
    { key: "prepared", header: "Prepared by", hideOnMobile: true, cell: (b) => userName(b.prepared_by_user_id) },
    { key: "released", header: "Released by", hideOnMobile: true, cell: (b) => (b.released_by_user_id ? userName(b.released_by_user_id) : "—") },
    { key: "date", header: "Value date", hideOnMobile: true, cell: (b) => (b.value_date ? fmtDate(b.value_date) : "—") },
  ];

  return (
    <div>
      <WorkspaceHeader
        title="Payout Files"
        description="Payment batches from finalized runs: approve, generate the bank file, release, then reconcile against the bank statement."
        actions={
          prepare && (
            <Button className="min-h-[44px]" onClick={() => newBatch.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> Create payment batch
            </Button>
          )
        }
      />
      <PaymentsNav />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Awaiting approval"
          icon={<Clock className="h-5 w-5" />}
          tone="warning"
          count={awaiting.data?.total ?? null}
          amounts={awaiting.data ? totalsByCurrency(awaiting.data.items.map((b) => b.total)) : null}
          loading={awaiting.loading && !awaiting.data}
          definition="Batches a second person must approve before any file is generated."
          onClick={() => { setStatus("APPROVAL_PENDING"); setSkip(0); }}
        />
        <KpiCard
          label="File ready to release"
          icon={<Send className="h-5 w-5" />}
          tone="info"
          count={toRelease.data?.total ?? null}
          amounts={toRelease.data ? totalsByCurrency(toRelease.data.items.map((b) => b.total)) : null}
          loading={toRelease.loading && !toRelease.data}
          definition="Bank files generated and waiting for a signatory to upload and mark them as submitted."
          onClick={() => { setStatus("FILE_GENERATED"); setSkip(0); }}
        />
        <KpiCard
          label="Submitted, not settled"
          icon={<Banknote className="h-5 w-5" />}
          tone="primary"
          count={submitted.data?.total ?? null}
          amounts={submitted.data ? totalsByCurrency(submitted.data.items.map((b) => b.figures.outstanding)) : null}
          loading={submitted.loading && !submitted.data}
          definition="Sent to the bank but without settlement evidence yet: not paid until the statement shows it."
          onClick={() => { setStatus("SUBMITTED"); setSkip(0); }}
        />
      </div>
      <Card>
        <FilterBar>
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
              <option value="">All statuses</option>
              {Object.entries(VOCABULARIES.batch.states).map(([code, s]) => (
                <option key={code} value={code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Run number">
            <Input inputMode="numeric" value={run} onChange={(e) => { setRun(e.target.value.replace(/\D/g, "")); setSkip(0); }} className="w-32" />
          </Field>
        </FilterBar>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption="Payment batches"
            columns={columns}
            rows={items}
            loading={loading}
            rowKey={(b) => b.id}
            onRowClick={(b) => router.push(`/payroll/payments/batches/${b.id}`)}
            cardBelowMd
            empty={
              <EmptyState
                icon={<PackageOpen />}
                title={status || runQ ? "No batch matches these filters" : "No payment batches yet"}
                description={status || runQ ? "Clear the filters to see every batch." : "Once a pay run is finalized, create a payment batch from it."}
                action={
                  prepare && !status && !runQ ? (
                    <Button className="min-h-[44px]" onClick={() => newBatch.openModal()}>
                      Create payment batch
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
        <Pagination total={data?.total ?? 0} skip={skip} limit={LIMIT} onChange={setSkip} />
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Statuses never say &quot;Paid&quot; before the bank statement or provider confirms settlement.{" "}
        {can(me, P.PAYROLL_PAYMENT_RECONCILE) && (
          <Link className="underline" href="/payroll/payments/reconciliation">
            Import a statement in Reconciliation
          </Link>
        )}
      </p>
      <CreateBatchModal
        open={newBatch.open}
        onOpenChange={newBatch.onOpenChange}
        runId={newBatch.param("run")}
        onCreated={(ids) => {
          setRefresh((n) => n + 1);
          if (ids.length === 1) router.push(`/payroll/payments/batches/${ids[0]}`);
          else void newBatch.close();
        }}
      />
    </div>
  );
}
