"use client";

import { ArrowLeft, FileText, HeartHandshake, Landmark, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { Button } from "@/components/ui/button";
import { Column, DataTable, EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { AccountNumber } from "./BankAccountPanel";
import { BankChangeModal } from "./BankChangeReview";
import {
  KIND_LABELS,
  accountState,
  formatShare,
  nomineesApi,
  type CaseNominees,
  type Nominee,
  type NomineeStatement,
  type SettlementCaseRow,
} from "./NomineesApi";
import { NomineeAccountModal, NomineeFormModal } from "./NomineesModals";
import { DetailGate, ErrorSummary, Hash, LocalChip, Notice, PaymentsNav, ReasonModal, WorkspaceHeader, flagLabel, humanize, useEmployeeDirectory } from "./shared";

const TONE_CLASS: Record<string, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-muted text-muted-foreground",
};

function Pill({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>{children}</span>;
}

/* ------------------------------------------------------------------ shares meter */

/** How much of the settlement is given out: the run can be created only at exactly 100 percent. */
export function SharesMeter({ total, complete }: { total: string; complete: boolean }) {
  const value = Math.min(100, Math.max(0, Number(total) || 0));
  return (
    <div className="min-w-[14rem] flex-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Shares given</span>
        <span className={complete ? "text-success" : "text-warning"}>{formatShare(total)}% of 100%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Shares given out of the settlement"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(value.toFixed(6))}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${complete ? "bg-success" : "bg-warning"}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ statements */

function StatementsModal({ nominee, open, onOpenChange }: { nominee: Nominee | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [items, setItems] = useState<NomineeStatement[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { data, error: loadError, loading } = useApi(() => nomineesApi.statements(nominee?.id ?? 0), [nominee?.id, open], { enabled: open && !!nominee });
  const list = items ?? data?.items ?? [];
  const issue = async () => {
    if (!nominee) return;
    setError(null);
    try {
      const result = await nomineesApi.issueStatement(nominee.id);
      setItems(result.items);
      toast.success("Statement ready");
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setItems(null);
        onOpenChange(o);
      }}
      title={nominee ? `Settlement statement for ${nominee.name}` : "Settlement statement"}
      description="One statement per payee, kept with the other payroll documents. It is never published to the employee's own portal."
      footer={
        <Button variant="secondary" className="min-h-[44px]" onClick={() => void issue()}>
          Issue statement now
        </Button>
      }
    >
      <ErrorSummary error={error ?? loadError} />
      {loading && !list.length ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length ? (
        <ul className="space-y-2" aria-label="Statements">
          {list.map((s) => (
            <li key={s.document_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{s.number ?? s.title}</span>
              <span className="text-muted-foreground">Issued {fmtDate(s.issue_date)}</span>
              <Hash value={s.sha256} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No statement yet. It is issued when the settlement run is finalized.</p>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ one case */

function nomineeAccount(n: Nominee) {
  const rows = n.bank_accounts ?? [];
  return rows.find((a) => a.status === "ACTIVE") ?? rows.find((a) => a.status === "PENDING_APPROVAL" || a.status === "DRAFT") ?? rows[0];
}

export function CaseNomineesView({ caseId }: { caseId: number }) {
  const { me } = useCan();
  const employees = useEmployeeDirectory();
  const { data, error, loading, reload } = useApi(() => nomineesApi.forCase(caseId), [caseId]);
  const payments = useApi(() => nomineesApi.payments(caseId), [caseId, data?.case.run_id], { enabled: !!data?.case.run_id });
  const changes = useApi(() => nomineesApi.changes({ status: "PENDING_APPROVAL", limit: 100 }), [caseId]);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [form, setForm] = useState<{ nominee: Nominee | null } | null>(null);
  const [account, setAccount] = useState<Nominee | null>(null);
  const [ending, setEnding] = useState<Nominee | null>(null);
  const [statement, setStatement] = useState<Nominee | null>(null);
  const bump = () => {
    void reload();
    void changes.reload();
  };

  const canEdit = can(me, P.PAYROLL_BANK_DETAILS_EDIT);
  const view: CaseNominees | null = data ?? null;
  const active = (view?.items ?? []).filter((n) => n.status === "ACTIVE");
  const editable = !!view?.summary?.editable && canEdit;
  const waiting = (changes.data?.items ?? []).filter((c) => c.nominee?.final_settlement_case_id === caseId);

  const columns: Column<Nominee>[] = [
    {
      key: "name",
      header: "Payee",
      primary: true,
      cell: (n) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="font-medium">{n.name}</span>
          <span className="text-xs text-muted-foreground">
            {KIND_LABELS[n.kind] ?? humanize(n.kind)} · {n.relationship} · {n.country}
          </span>
        </span>
      ),
    },
    { key: "share", header: "Share", cell: (n) => <span className="font-medium tabular-nums">{formatShare(n.share_percent)}%</span> },
    { key: "proof", header: "Proof document", hideOnMobile: true, cell: (n) => n.proof_ref },
    {
      key: "account",
      header: "Bank account",
      cell: (n) => {
        const a = nomineeAccount(n);
        if (!a) return <span className="text-sm text-muted-foreground">{n.status === "ACTIVE" ? "None yet" : "—"}</span>;
        const state = accountState(a);
        const flags = (a.risk_flags ?? []).filter((f) => f.open).map((f) => flagLabel(f.code));
        return (
          <span className="flex flex-col items-start gap-1">
            <AccountNumber account={a} />
            <Pill tone={state.tone}>{state.label}</Pill>
            {flags.length > 0 && <span className="text-xs text-danger">{flags.join(" · ")}</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (n) => (n.status === "ACTIVE" ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Ended</Pill>),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (n) => (
        <span className="flex flex-wrap gap-1.5">
          {editable && n.status === "ACTIVE" && (
            <Button variant="secondary" size="sm" className="min-h-[44px]" aria-label={`Change ${n.name}`} onClick={() => setForm({ nominee: n })}>
              Change
            </Button>
          )}
          {canEdit && n.status === "ACTIVE" && view?.case.status !== "CANCELLED" && (
            <Button variant="secondary" size="sm" className="min-h-[44px]" aria-label={`${nomineeAccount(n) ? "Replace" : "Add"} bank account of ${n.name}`} onClick={() => setAccount(n)}>
              {nomineeAccount(n) ? "Replace account" : "Add account"}
            </Button>
          )}
          {editable && n.status === "ACTIVE" && (
            <Button variant="ghost" size="sm" className="min-h-[44px] text-danger" aria-label={`End ${n.name}`} onClick={() => setEnding(n)}>
              End
            </Button>
          )}
          {view?.case.status === "SETTLED" && n.status === "ACTIVE" && (
            <Button variant="ghost" size="sm" className="min-h-[44px]" aria-label={`Statement of ${n.name}`} onClick={() => setStatement(n)}>
              Statement
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <DetailGate loading={loading} error={error} hasData={!!view} onRetry={() => void reload()} what="Final settlement" backHref="/payroll/payments/nominees" backLabel="Back to nominees">
      {view && (
        <div className="space-y-5">
          <Link href="/payroll/payments/nominees" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> All settlements
          </Link>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Final settlement #{view.case.id} after a death</p>
                <p className="font-display text-lg font-semibold">{employees.name(view.case.employee_id)}</p>
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <Pill tone={view.case.status === "SETTLED" ? "success" : view.case.status === "CANCELLED" ? "neutral" : "warning"}>{humanize(view.case.status)}</Pill>
                  <span className="text-muted-foreground">Paid in {view.case.currency}</span>
                </p>
              </div>
              {view.summary && <SharesMeter total={view.summary.share_total} complete={view.summary.complete} />}
              {editable && (
                <Button className="min-h-[44px]" onClick={() => setForm({ nominee: null })}>
                  <Plus className="h-4 w-4" aria-hidden /> Add nominee
                </Button>
              )}
            </div>
            {view.summary && !view.summary.complete && view.case.status !== "CANCELLED" && (
              <Notice tone="warning" title="The settlement run cannot be created yet" className="mt-4">
                {view.summary.issues[0]?.message ?? "Record the people who receive the settlement."} Money is paid only to the accounts of the people listed here, never to the deceased employee&apos;s own account.
              </Notice>
            )}
            {view.summary && !view.summary.editable && view.case.status !== "CANCELLED" && (
              <Notice title="The nominees are frozen" className="mt-4">
                The settlement run exists, so the people and their shares can no longer change. Bank accounts can still be replaced; each change needs a second person&apos;s approval.
              </Notice>
            )}
          </Card>

          <Card>
            <CardHeader title="Payees" description="Each person receives their share of the settlement net, rounded down to the smallest currency unit; the largest share takes the rounding difference." />
            <DataTable
              caption="Nominees and legal heirs"
              columns={columns}
              rows={view.items}
              rowKey={(n) => n.id}
              cardBelowMd
              empty={
                <EmptyState
                  icon={<HeartHandshake />}
                  title="No nominee recorded yet"
                  description="Add the nominee or legal heir with the document that names them. Their bank account is approved by a second person before any money moves."
                  action={editable ? <Button className="min-h-[44px]" onClick={() => setForm({ nominee: null })}>Add nominee</Button> : undefined}
                />
              }
            />
          </Card>

          {waiting.length > 0 && (
            <Card>
              <CardHeader title="Bank accounts waiting for approval" description="Approved by someone other than the people who recorded the nominee and entered the account." />
              <DataTable
                caption="Bank changes waiting for approval"
                columns={[
                  { key: "who", header: "Payee", primary: true, cell: (c) => <span className="font-medium">{c.nominee?.name ?? "—"}</span> },
                  { key: "account", header: "Account", cell: (c) => c.after.account_masked },
                  {
                    key: "flags",
                    header: "Risk flags",
                    cell: (c) => ((c.risk_flags ?? []).length ? (c.risk_flags ?? []).map((f) => flagLabel(f.code)).join(" · ") : "None"),
                  },
                  { key: "status", header: "Status", cell: (c) => <LocalChip vocabulary="change" code={c.status} /> },
                  { key: "created", header: "Requested", hideOnMobile: true, cell: (c) => fmtDateTime(c.created_at) },
                  {
                    key: "open",
                    header: <span className="sr-only">Review</span>,
                    cell: (c) => (
                      <Button variant="secondary" size="sm" className="min-h-[44px]" aria-label={`Review the account of ${c.nominee?.name ?? "the payee"}`} onClick={() => setReviewing(c.id)}>
                        Review…
                      </Button>
                    ),
                  },
                ]}
                rows={waiting}
                rowKey={(c) => c.id}
                cardBelowMd
              />
            </Card>
          )}

          {view.case.run_id && (
            <Card>
              <CardHeader title="Payments" description="One payment per payee, from the finalized settlement run. Account numbers stay masked." />
              {payments.error && !payments.data ? (
                <ErrorState message={payments.error.message} onRetry={() => void payments.reload()} />
              ) : (payments.data?.obligations ?? []).length ? (
                (payments.data?.obligations ?? []).map((o) => (
                  <DataTable
                    key={o.obligation_id}
                    caption={`Settlement payments, total ${o.amount.amount} ${o.amount.currency}`}
                    columns={[
                      {
                        key: "payee",
                        header: "Payee",
                        primary: true,
                        cell: (l) => <span className="font-medium">{active.find((n) => n.id === l.nominee_id)?.name ?? l.holder_name_masked ?? "Not assigned"}</span>,
                      },
                      { key: "share", header: "Share", cell: (l) => (l.share_percent ? `${formatShare(l.share_percent)}%` : "—") },
                      { key: "amount", header: "Amount", cell: (l) => <MoneyText money={l.amount} emphasis /> },
                      { key: "account", header: "Account", cell: (l) => l.account_masked ?? "No account yet" },
                      { key: "status", header: "Status", cell: (l) => <span className="flex flex-col"><span>{humanize(l.status)}</span>{l.reason && <span className="text-xs text-muted-foreground">{humanize(l.reason)}</span>}</span> },
                    ]}
                    rows={o.instructions}
                    rowKey={(l) => l.id}
                    cardBelowMd
                  />
                ))
              ) : (
                <EmptyState icon={<Landmark />} title="No payment yet" description="Payments appear once the settlement run is finalized and has a net amount." />
              )}
            </Card>
          )}

          <NomineeFormModal
            open={!!form}
            onOpenChange={(o) => !o && setForm(null)}
            caseId={caseId}
            nominee={form?.nominee ?? null}
            otherShares={active.filter((n) => n.id !== form?.nominee?.id).reduce((sum, n) => sum + Number(n.share_percent), 0)}
            onSaved={bump}
          />
          <NomineeAccountModal open={!!account} onOpenChange={(o) => !o && setAccount(null)} nominee={account} currency={view.case.currency} onSubmitted={bump} />
          <ReasonModal
            open={!!ending}
            onOpenChange={(o) => !o && setEnding(null)}
            title={`End ${ending?.name ?? "nominee"}`}
            consequence="This person stops receiving a share and their active bank accounts are deactivated. The shares of the others then no longer add up to 100%, so add or change a nominee afterwards."
            confirmLabel="End nominee"
            danger
            onSubmit={async (reason) => {
              if (!ending) return;
              await nomineesApi.end(ending.id, reason, ending.row_version);
              toast.success("Nominee ended");
              setEnding(null);
              bump();
            }}
            onReload={bump}
          />
          <StatementsModal nominee={statement} open={!!statement} onOpenChange={(o) => !o && setStatement(null)} />
          <BankChangeModal open={reviewing !== null} onOpenChange={(o) => !o && setReviewing(null)} id={reviewing === null ? null : String(reviewing)} onChanged={bump} />
        </div>
      )}
    </DetailGate>
  );
}

/* ------------------------------------------------------------------ case picker */

function CasePicker() {
  const router = useRouter();
  const employees = useEmployeeDirectory();
  const { data, error, loading, reload } = useApi(() => nomineesApi.cases(), []);
  const rows = (data?.items ?? []).filter((c) => c.termination_type === "DEATH");
  const columns: Column<SettlementCaseRow>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (c) => <span className="font-medium">{c.employee?.name ?? employees.name(c.employee?.id)}</span> },
    { key: "last", header: "Last working day", cell: (c) => fmtDate(c.last_working_day) },
    { key: "status", header: "Settlement", cell: (c) => <Pill tone={c.status === "SETTLED" ? "success" : c.status === "CANCELLED" ? "neutral" : "warning"}>{humanize(c.status)}</Pill> },
    { key: "due", header: "Due", hideOnMobile: true, cell: (c) => (c.due_date ? <span className={c.overdue ? "text-danger" : undefined}>{fmtDate(c.due_date)}{c.overdue ? " · overdue" : ""}</span> : "—") },
    {
      key: "open",
      header: <span className="sr-only">Open</span>,
      cell: (c) => (
        <Link href={`/payroll/payments/nominees?case=${c.id}`} className="inline-flex min-h-[44px] items-center font-medium text-primary hover:underline" aria-label={`Open the nominees of ${c.employee?.name ?? `settlement ${c.id}`}`}>
          Nominees
        </Link>
      ),
    },
  ];
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <Card>
      <CardHeader title="Settlements after a death" description="The nominees and legal heirs of a deceased employee are recorded under the final settlement. Open one to add the people, their shares and their bank accounts." />
      <DataTable
        caption="Final settlements after a death"
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/payroll/payments/nominees?case=${c.id}`)}
        cardBelowMd
        empty={<EmptyState icon={<Users />} title="No settlement after a death" description="Open a final settlement with the termination type Death; its nominees then appear here." />}
      />
    </Card>
  );
}

/**
 * Payroll › Payout Files › Nominees (3.5 §15, 3.7 §2.1, EC-BNK-15): the nominees and legal heirs who receive a
 * deceased employee's final settlement, their shares (exactly 100%), their bank accounts (second-person
 * approval, verification, no cooling-off waiver) and the payment and statement per payee. Deep link:
 * `?case=<final settlement id>`.
 */
export function NomineesWorkspace() {
  const search = useSearchParams();
  const raw = search?.get("case") ?? "";
  const caseId = /^[0-9]+$/.test(raw) ? Number(raw) : null;
  return (
    <div>
      <WorkspaceHeader
        title="Nominees and legal heirs"
        description="Who receives the final settlement of a deceased employee. Account numbers stay masked; every bank account needs a second person's approval and verification before money moves."
      />
      <PaymentsNav />
      {caseId ? <CaseNomineesView caseId={caseId} /> : <CasePicker />}
    </div>
  );
}
