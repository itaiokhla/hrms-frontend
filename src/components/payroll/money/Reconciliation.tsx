"use client";

import { ArrowLeft, FileSpreadsheet, FileUp, Scale, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { ImportStatementModal } from "./ImportStatement";
import { reconApi } from "./api";
import {
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  FilterBar,
  Hash,
  LocalChip,
  Meta,
  Notice,
  PaymentsNav,
  WorkspaceHeader,
  fieldErrors,
  useEmployeeDirectory,
  useFundingAccounts,
  useTab,
  useUserNames,
} from "./shared";
import type { MatchQueue, PaymentInstruction, ReconciliationMatch, StatementImport } from "./types";

const LIMIT = 100;
const REVIEW = ["MISMATCH", "UNMATCHED", "DUPLICATE"];

/* ------------------------------------------------------------------ decisions */

type Decision = "accept" | "link" | "escalate";

const DECISION_COPY: Record<Decision, { title: string; consequence: string; confirm: string }> = {
  accept: {
    title: "Accept the difference",
    consequence: "The payment settles with the amount on the bank line, and the difference is recorded as an accepted variance with your reason.",
    confirm: "Accept difference",
  },
  link: { title: "Link to a payment", consequence: "This bank line becomes the settlement evidence of the payment you choose.", confirm: "Link" },
  escalate: { title: "Escalate", consequence: "The line leaves the review queue and waits in Escalated for someone to investigate.", confirm: "Escalate" },
};

export function canAccept(m: ReconciliationMatch): boolean {
  return m.status === "MISMATCH" && m.reason === "AMOUNT_DIFFERS" && !!m.instruction;
}

function MatchDecision({ match, decision, onClose, onDone }: { match: ReconciliationMatch; decision: Decision; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [instruction, setInstruction] = useState(match.candidate_ids[0] ? String(match.candidate_ids[0]) : match.instruction ? String(match.instruction.id) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const copy = DECISION_COPY[decision];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (reason.trim().length < 3) next.reason = "Give a reason (at least 3 characters). It is kept in the audit trail.";
    if (decision === "link" && !instruction) next.instruction = "Choose the payment this line settles.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      if (decision === "accept") await reconApi.accept(match.id, reason.trim(), match.row_version);
      else if (decision === "link") await reconApi.link(match.id, Number(instruction), reason.trim(), match.row_version);
      else await reconApi.escalate(match.id, reason.trim(), match.row_version);
      toast.success(decision === "accept" ? "Difference accepted — the payment is settled" : decision === "link" ? "Line linked to the payment" : "Escalated");
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const formId = `match-${match.id}-${decision}`;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      size="md"
      title={copy.title}
      description={`Bank line of ${fmtDate(match.line.value_date)}${match.line.reference ? ` · ${match.line.reference}` : ""}`}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="min-h-[44px]" loading={busy}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm">{copy.consequence}</p>
        <ConflictBanner error={error} onReload={() => { onClose(); onDone(); }} />
        <ErrorSummary error={error} fields={{ ...fieldErrors(error), ...errors }} />
        <dl className="grid gap-3 sm:grid-cols-2">
          <Meta label="Bank line">
            <MoneyText money={match.line.amount} /> {match.line.direction ? `(${match.line.direction.toLowerCase()})` : ""}
          </Meta>
          {match.instruction && (
            <Meta label="Payment">
              <MoneyText money={match.instruction.amount} /> · <bdi dir="ltr">{match.instruction.reference}</bdi>
            </Meta>
          )}
          {match.variance && (
            <Meta label="Difference">
              <MoneyText money={match.variance} />
            </Meta>
          )}
        </dl>
        {decision === "link" && (
          <Field label="Payment" required error={errors.instruction} hint="Suggested matches first; or enter the payment number.">
            {match.candidate_ids.length ? (
              <Select value={instruction} onChange={(e) => setInstruction(e.target.value)} className="min-h-[44px]">
                {match.candidate_ids.map((id) => (
                  <option key={id} value={id}>
                    Payment #{id}
                  </option>
                ))}
              </Select>
            ) : (
              <Input inputMode="numeric" value={instruction} onChange={(e) => setInstruction(e.target.value.replace(/\D/g, ""))} className="min-h-[44px]" />
            )}
          </Field>
        )}
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ matches table */

export function MatchesTable({ matches, onChanged, canDecide = false }: { matches: ReconciliationMatch[]; onChanged?: () => void; canDecide?: boolean }) {
  const employees = useEmployeeDirectory();
  const [active, setActive] = useState<{ match: ReconciliationMatch; decision: Decision } | null>(null);
  const columns: Column<ReconciliationMatch>[] = [
    {
      key: "line",
      header: "Bank line",
      primary: true,
      cell: (m) => (
        <span className="flex flex-col">
          <span>{fmtDate(m.line.value_date)}</span>
          <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">{m.line.reference ?? m.line.end_to_end_id ?? "No reference"}</bdi>
        </span>
      ),
    },
    { key: "amount", header: "Line amount", className: "text-end", cell: (m) => <MoneyText money={m.line.amount} /> },
    { key: "status", header: "Result", cell: (m) => <span className="flex flex-col items-start gap-1"><LocalChip vocabulary="match" code={m.status} />{m.message && <span className="text-xs text-muted-foreground">{m.message}</span>}{m.line.return_message && <span className="text-xs text-danger">{m.line.return_message}</span>}</span> },
    {
      key: "payment",
      header: "Payment",
      cell: (m) =>
        m.instruction ? (
          <span className="flex flex-col">
            <Link href={`/payroll/payments/instructions/${m.instruction.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {employees.name(m.instruction.employee_id)}
            </Link>
            <span className="text-xs text-muted-foreground">
              <MoneyText money={m.instruction.amount} /> · <StatusChip vocabulary="instruction" code={m.instruction.status} />
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{m.line.counterparty ?? "—"}</span>
        ),
    },
    { key: "variance", header: "Difference", className: "text-end", hideOnMobile: true, cell: (m) => (m.variance ? <MoneyText money={m.variance} /> : "—") },
  ];
  if (canDecide) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (m) =>
        REVIEW.includes(m.status) ? (
          <span className="flex flex-wrap gap-1.5">
            {canAccept(m) && (
              <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={(e) => { e.stopPropagation(); setActive({ match: m, decision: "accept" }); }}>
                Accept…
              </Button>
            )}
            <Button size="sm" variant="secondary" className="min-h-[44px] sm:min-h-0" onClick={(e) => { e.stopPropagation(); setActive({ match: m, decision: "link" }); }}>
              Link…
            </Button>
            <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={(e) => { e.stopPropagation(); setActive({ match: m, decision: "escalate" }); }}>
              Escalate…
            </Button>
          </span>
        ) : m.decision_reason ? (
          <span className="text-xs text-muted-foreground" title={m.decided_at ? fmtDateTime(m.decided_at) : undefined}>
            {m.decision_reason}
          </span>
        ) : null,
    });
  }
  return (
    <>
      <DataTable caption="Reconciliation results" columns={columns} rows={matches} rowKey={(m) => m.id} cardBelowMd empty={<p className="p-4 text-sm text-muted-foreground">No lines.</p>} />
      {active && <MatchDecision match={active.match} decision={active.decision} onClose={() => setActive(null)} onDone={() => onChanged?.()} />}
    </>
  );
}

/* ------------------------------------------------------------------ tabs */

function QueueTab({ queue, refresh, empty, canDecide, onChanged }: { queue: MatchQueue; refresh: number; empty: { title: string; description: string }; canDecide: boolean; onChanged: () => void }) {
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(() => reconApi.matches({ queue, offset: skip, limit: LIMIT }), [queue, skip, refresh]);
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <Card>
      {loading && !data ? (
        <DataTable columns={[]} rows={undefined} loading rowKey={() => 0} />
      ) : data?.items.length ? (
        <MatchesTable matches={data.items} canDecide={canDecide} onChanged={() => { void reload(); onChanged(); }} />
      ) : (
        <EmptyState icon={<Scale />} title={empty.title} description={empty.description} />
      )}
      <Pagination total={data?.total ?? 0} skip={skip} limit={LIMIT} onChange={setSkip} />
    </Card>
  );
}

function OverdueTab({ refresh }: { refresh: number }) {
  const employees = useEmployeeDirectory();
  const router = useRouter();
  const [grace, setGrace] = useState("0");
  const { data, error, loading, reload } = useApi(() => reconApi.overdue({ grace: Number(grace) || 0 }), [grace, refresh]);
  const columns: Column<PaymentInstruction>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (r) => <span className="font-medium">{employees.name(r.employee_id)}</span> },
    { key: "amount", header: "Amount", className: "text-end", cell: (r) => <MoneyText money={r.amount} /> },
    { key: "status", header: "Status", cell: (r) => <StatusChip vocabulary="instruction" code={r.status} /> },
    { key: "expected", header: "Expected", cell: (r) => fmtDate(r.expected_settlement_date) },
    { key: "late", header: "Overdue", className: "text-end", cell: (r) => <span className="tabular-nums text-warning">{r.business_days_overdue ?? "—"} business day(s)</span> },
    { key: "reference", header: "Reference", hideOnMobile: true, cell: (r) => <bdi dir="ltr" className="font-mono text-xs">{r.reference}</bdi> },
  ];
  return (
    <Card>
      <FilterBar>
        <Field label="Grace (business days)">
          <Select value={grace} onChange={(e) => setGrace(e.target.value)}>
            {["0", "1", "2", "3", "5"].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        {data?.as_of && <p className="pb-2 text-sm text-muted-foreground">As of {fmtDate(data.as_of)}</p>}
      </FilterBar>
      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Overdue payments"
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/payroll/payments/instructions/${r.id}`)}
          cardBelowMd
          empty={<EmptyState icon={<Timer />} title="Nothing overdue" description="Sent payments past their expected settlement date without bank evidence appear here." />}
        />
      )}
    </Card>
  );
}

function StatementsTab({ refresh, fundingLabel }: { refresh: number; fundingLabel: (id: number) => string }) {
  const router = useRouter();
  const userName = useUserNames();
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(() => reconApi.statements({ offset: skip, limit: 50 }), [skip, refresh]);
  const columns: Column<StatementImport>[] = [
    { key: "file", header: "Statement", primary: true, cell: (s) => <span className="flex flex-col"><span className="font-medium">{s.file_name}</span><span className="text-xs text-muted-foreground">{s.format === "CAMT053" ? "CAMT.053" : s.format}{s.statement_ref ? ` · ${s.statement_ref}` : ""}</span></span> },
    { key: "funding", header: "Funding account", hideOnMobile: true, cell: (s) => fundingLabel(s.funding_account_id) },
    { key: "lines", header: "Lines", className: "text-end", cell: (s) => <span className="tabular-nums">{s.new_line_count} new / {s.line_count}</span> },
    { key: "counts", header: "Results", cell: (s) => Object.entries(s.counts).map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, " ")}`).join(" · ") || "—" },
    { key: "imported", header: "Imported", hideOnMobile: true, cell: (s) => `${fmtDateTime(s.created_at)} · ${userName(s.imported_by_user_id)}` },
  ];
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <Card>
      <DataTable
        caption="Imported statements"
        columns={columns}
        rows={data?.items}
        loading={loading}
        rowKey={(s) => s.id}
        onRowClick={(s) => router.push(`/payroll/payments/reconciliation/statements/${s.id}`)}
        cardBelowMd
        empty={<EmptyState icon={<FileSpreadsheet />} title="No statements imported yet" description="Import the bank statement of a funding account to settle submitted payments." />}
      />
      <Pagination total={data?.total ?? 0} skip={skip} limit={50} onChange={setSkip} />
    </Card>
  );
}

/* ------------------------------------------------------------------ workspace */

const TABS = ["review", "escalated", "resolved", "overdue", "statements"] as const;
type Tab = (typeof TABS)[number];

/**
 * Payroll › Payout Files › Reconciliation (3.8 §5.12): import a statement (`?modal=import-statement`)
 * → match results → the review queue (Accept with reason / Link / Escalate), escalations, resolved
 * lines, overdue payments and imported statements. Needs payroll:payment:reconcile.
 */
export function ReconciliationWorkspace() {
  const { me } = useCan();
  const [tab, setTab] = useTab<Tab>(TABS, "review");
  const [dirty, setDirty] = useState(false);
  const importModal = useModalRoute("import-statement", { keys: [], dirty });
  const funding = useFundingAccounts();
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);
  const review = useApi(() => reconApi.matches({ queue: "review", limit: 1 }), [refresh]);
  const escalated = useApi(() => reconApi.matches({ queue: "escalated", limit: 1 }), [refresh]);
  // Without the funding-accounts list, offer the accounts earlier statements were imported for.
  const statements = useApi(() => reconApi.statements({ limit: 200 }), [refresh], { enabled: !funding.allowed });
  const knownIds = useMemo(() => [...new Set((statements.data?.items ?? []).map((s) => s.funding_account_id))], [statements.data]);
  const canDecide = can(me, P.PAYROLL_PAYMENT_RECONCILE);
  useEffect(() => {
    if (!importModal.open) setDirty(false);
  }, [importModal.open]);

  return (
    <div>
      <WorkspaceHeader
        title="Reconciliation"
        description="Match bank statements to submitted payments. A payment counts as paid only when a statement line or the provider confirms it."
        actions={
          <Button className="min-h-[44px]" onClick={() => importModal.openModal()}>
            <FileUp className="h-4 w-4" aria-hidden /> Import bank statement
          </Button>
        }
      />
      <PaymentsNav />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "review", label: "Needs review", badge: review.data?.total || undefined },
          { value: "escalated", label: "Escalated", badge: escalated.data?.total || undefined },
          { value: "resolved", label: "Matched" },
          { value: "overdue", label: "Overdue" },
          { value: "statements", label: "Statements" },
        ]}
      >
        <TabPanel value="review">
          <QueueTab queue="review" refresh={refresh} canDecide={canDecide} onChanged={bump} empty={{ title: "Nothing to review", description: "Mismatched amounts, unmatched lines and possible duplicates from imported statements appear here." }} />
        </TabPanel>
        <TabPanel value="escalated">
          <QueueTab queue="escalated" refresh={refresh} canDecide={false} onChanged={bump} empty={{ title: "No escalations", description: "Lines someone escalated for investigation appear here." }} />
        </TabPanel>
        <TabPanel value="resolved">
          <QueueTab queue="resolved" refresh={refresh} canDecide={false} onChanged={bump} empty={{ title: "No matched lines yet", description: "Import a statement to match it to submitted payments." }} />
        </TabPanel>
        <TabPanel value="overdue">
          <OverdueTab refresh={refresh} />
        </TabPanel>
        <TabPanel value="statements">
          <StatementsTab refresh={refresh} fundingLabel={(id) => funding.label(id)} />
        </TabPanel>
      </Tabs>
      <ImportStatementModal
        open={importModal.open}
        onOpenChange={importModal.onOpenChange}
        fundingAccounts={funding.accounts}
        fundingAllowed={funding.allowed}
        knownFundingIds={knownIds}
        onImported={bump}
        onDirtyChange={setDirty}
      />
    </div>
  );
}

/** One imported statement and its match results (`/payroll/payments/reconciliation/statements/[id]`). */
export function StatementPage({ id }: { id: string }) {
  const { me } = useCan();
  const funding = useFundingAccounts();
  const userName = useUserNames();
  const statement = useApi(() => reconApi.statement(id), [id]);
  const matches = useApi(() => reconApi.statementMatches(id), [id]);
  const s = statement.data;
  return (
    <div>
      <Link href="/payroll/payments/reconciliation?tab=statements" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Reconciliation
      </Link>
      <DetailGate loading={statement.loading} error={statement.error} hasData={!!s} onRetry={() => void statement.reload()} what="Bank statement" backHref="/payroll/payments/reconciliation" backLabel="Back to reconciliation">
        {s && (
          <div className="space-y-5">
            <WorkspaceHeader title={s.file_name} description={`${s.format === "CAMT053" ? "CAMT.053" : s.format} statement · ${funding.label(s.funding_account_id)}`} />
            <PaymentsNav />
            <Card className="p-5">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Meta label="Lines">{s.new_line_count} new of {s.line_count}</Meta>
                <Meta label="Statement account">
                  <bdi dir="ltr" className="font-mono">{s.account_masked ?? "—"}</bdi>
                </Meta>
                <Meta label="SHA-256">
                  <Hash value={s.file_sha256} />
                </Meta>
                <Meta label="Imported">{fmtDateTime(s.created_at)} · {userName(s.imported_by_user_id)}</Meta>
              </dl>
              {s.rejected.length > 0 && (
                <Notice tone="warning" title={`${s.rejected.length} row(s) could not be read`} className="mt-4">
                  <ul className="list-disc ps-5">
                    {s.rejected.map((r, i) => (
                      <li key={i}>
                        {r.source_row ? `Row ${r.source_row}: ` : ""}
                        {r.message}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
            </Card>
            <Card>
              <CardHeader title="Match results" />
              {matches.error && !matches.data ? (
                <ErrorState message={matches.error.message} onRetry={() => void matches.reload()} />
              ) : (
                <MatchesTable matches={matches.data?.items ?? []} canDecide={can(me, P.PAYROLL_PAYMENT_RECONCILE)} onChanged={() => void matches.reload()} />
              )}
            </Card>
          </div>
        )}
      </DetailGate>
    </div>
  );
}
