"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { parseMoneyInput } from "@/lib/money";
import { P } from "@/lib/permissions.generated";

import { loansApi } from "./api";
import { ConflictBanner, DecisionModal, DetailGate, EmployeeField, ErrorSummary, FilterBar, LocalStatusChip, Notice, ReasonModal, WorkspaceHeader, fieldErrors, useEmployeeDirectory } from "./shared";
import { LOAN_KINDS, LOAN_STATUSES, type Loan, type LoanInstalment } from "./types";

const LIMIT = 50;
const KIND_LABEL: Record<string, string> = { LOAN: "Loan", ADVANCE: "Salary advance" };
const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function invalid(field: string, msg: string): ApiError {
  return new ApiError(422, msg, "VALIDATION", [{ field, msg }]);
}

/* ------------------------------------------------------------------ new loan */

export function NewLoanModal({ open, onOpenChange, onCreated, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void; onDirtyChange?: (d: boolean) => void }) {
  const { me } = useCan();
  const currency0 = me?.company.currency ?? "INR";
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [kind, setKind] = useState<string>("LOAN");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currency0);
  const [tenure, setTenure] = useState("");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(0);

  useEffect(() => {
    if (!open) return;
    key.current += 1;
    setEmployeeId(null);
    setKind("LOAN");
    setAmount("");
    setCurrency(currency0);
    setTenure("");
    setPurpose("");
    setErrors({});
    setError(null);
  }, [open, currency0]);
  const dirty = open && (!!employeeId || !!amount || !!tenure || !!purpose);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!employeeId) next.employee_id = "Choose the employee.";
    const parsed = parseMoneyInput(amount, currency);
    if (!parsed.ok) next.amount = parsed.message;
    const months = tenure.trim() ? Number.parseInt(tenure, 10) : undefined;
    if (tenure.trim() && (!months || months < 1 || months > 600)) next.tenure = "Enter a whole number between 1 and 600.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await loansApi.create({ employee_id: employeeId!, kind, amount: { amount: (parsed as { amount: string }).amount, currency }, tenure: months, purpose: purpose.trim() || undefined });
      toast.success(result.issues?.length ? "Application recorded with policy issues — see the loan page." : "Application sent for approval.");
      onOpenChange(false);
      onCreated?.(result.id);
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="New loan or advance"
      description="Checked against the employee's loan or advance policy: limits, eligibility and the protected net pay."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-loan-form" className="min-h-[44px]" loading={busy}>
            Send for approval
          </Button>
        </>
      }
    >
      <form id="new-loan-form" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={errors} />
        <EmployeeField value={employeeId} onChange={setEmployeeId} error={errors.employee_id} />
        <Field label="Type" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {LOAN_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Amount" required error={errors.amount}>
            <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Currency" required error={errors.currency} hint="The pay group's currency">
            <Input dir="ltr" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <Field label={kind === "LOAN" ? "Tenure in months (optional)" : "Recover over pay runs (optional)"} error={errors.tenure} hint="Empty uses the policy's default.">
          <Input inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Purpose" error={errors.purpose}>
          <Textarea rows={2} maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">The schedule is calculated from the policy when you send it. Money is paid out only through a payment batch.</p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ list */

/** Payroll › Loans & Advances (3.8 §5.10): status filters, `?modal=new-loan`, row → detail page. */
export function LoansList() {
  const { me } = useCan();
  const router = useRouter();
  const people = useEmployeeDirectory();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [skip, setSkip] = useState(0);
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute("new-loan", { keys: [], dirty });
  const canManage = can(me, P.PAYROLL_LOANS_MANAGE);
  useEffect(() => setSkip(0), [status, kind]);
  const { data, error, loading, reload } = useApi(() => loansApi.list({ status, kind, skip, limit: LIMIT }), [status, kind, skip]);

  const columns: Column<Loan>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (l) => <Link href={`/payroll/loans/${l.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{people.name(l.employee_id)}</Link> },
    { key: "kind", header: "Type", cell: (l) => KIND_LABEL[l.kind] ?? l.kind },
    { key: "principal", header: <span className="block text-end">Principal</span>, className: "text-end", cell: (l) => <MoneyText money={l.principal} /> },
    { key: "balance", header: <span className="block text-end">Balance</span>, className: "text-end", cell: (l) => <MoneyText money={l.balance} /> },
    { key: "tenure", header: "Tenure", hideOnMobile: true, cell: (l) => (l.tenure ? `${l.tenure} ${l.kind === "LOAN" ? "months" : "runs"}` : "—") },
    { key: "status", header: "Status", cell: (l) => <StatusChip vocabulary="loan" code={l.status} /> },
  ];

  return (
    <div>
      <WorkspaceHeader
        title="Loans & Advances"
        description="Applications, repayment schedules and balances. Recoveries are deducted by pay runs; disbursements are recorded from payment evidence."
        actions={
          canManage && (
            <Button className="min-h-[44px]" onClick={() => modal.openModal()}>
              <Plus className="h-4 w-4" aria-hidden /> New loan
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {LOAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" className="w-44">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Loans and advances</option>
              {LOAN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.items}
            loading={loading}
            rowKey={(l) => l.id}
            onRowClick={(l) => router.push(`/payroll/loans/${l.id}`)}
            cardBelowMd
            caption="Loans and advances"
            empty={
              <EmptyState
                title={status || kind ? "No loans match these filters" : "No loans or advances yet"}
                description="Employees apply from My Loans; payroll staff can apply on their behalf."
                action={canManage && <Button className="min-h-[44px]" onClick={() => modal.openModal()}>New loan</Button>}
              />
            }
          />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
      <NewLoanModal open={modal.open} onOpenChange={modal.onOpenChange} onDirtyChange={setDirty} onCreated={() => void reload()} />
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

type LoanActionKind = "approve" | "reject" | "cancel" | "pause" | "resume" | "restructure" | "prepay" | "waive";

function ScheduleTable({ rows, currency }: { rows: LoanInstalment[]; currency: string }) {
  const columns: Column<LoanInstalment>[] = [
    { key: "n", header: "Instalment", primary: true, cell: (i) => <span className="tabular-nums">#{i.number}</span> },
    { key: "principal", header: <span className="block text-end">Principal</span>, className: "text-end", cell: (i) => <MoneyText amount={i.principal} currency={currency} /> },
    { key: "interest", header: <span className="block text-end">Interest</span>, className: "text-end", cell: (i) => <MoneyText amount={i.interest} currency={currency} /> },
    { key: "total", header: <span className="block text-end">Deducted</span>, className: "text-end", cell: (i) => <MoneyText amount={i.total} currency={currency} emphasis /> },
    { key: "balance", header: <span className="block text-end">Balance after</span>, className: "text-end", cell: (i) => <MoneyText amount={i.balance_after} currency={currency} /> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(i) => i.number} cardBelowMd caption="Repayment schedule" empty={<EmptyState title="No schedule" description="A schedule is created when the application passes the policy checks." />} />;
}

/** `/payroll/loans/[id]`: schedule, ledger timeline and the actions the person's permissions allow. */
export function LoanDetail({ id }: { id: string }) {
  const { me } = useCan();
  const people = useEmployeeDirectory();
  const { data: loan, error, loading, reload } = useApi(() => loansApi.get(id), [id]);
  const [action, setAction] = useState<LoanActionKind | null>(null);
  const [tenure, setTenure] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const canManage = can(me, P.PAYROLL_LOANS_MANAGE);
  const canApprove = can(me, P.PAYROLL_LOANS_APPROVE);

  const open = (k: LoanActionKind) => {
    setTenure("");
    setAmount("");
    setReference("");
    setAction(k);
  };

  const ledger: TimelineItem[] = loan
    ? [
        ...(loan.transactions ?? []).map((t) => ({
          id: `tx-${t.id}`,
          at: t.created_at ?? t.effective_on,
          title: (
            <span className="inline-flex flex-wrap items-baseline gap-2">
              {human(t.kind)} <MoneyText money={t.amount} />
            </span>
          ),
          body: [t.note, t.reference && `Reference ${t.reference}`, t.scheduled && t.amount && t.scheduled.amount !== t.amount.amount ? "Less than scheduled (protected net pay)" : null].filter(Boolean).join(" · ") || undefined,
          tone: (t.kind === "DISBURSEMENT" ? "info" : t.kind === "WAIVER" ? "warning" : "success") as TimelineItem["tone"],
        })),
        ...(loan.actions ?? []).map((a) => ({
          id: `ac-${a.id}`,
          at: a.created_at ?? "",
          title: (
            <span className="inline-flex flex-wrap items-center gap-2">
              {human(a.action)} requested <LocalStatusChip vocabulary="loan_action" code={a.status} />
            </span>
          ),
          body: [a.reason, a.status_reason].filter(Boolean).join(" · ") || undefined,
          tone: "neutral" as const,
        })),
      ].sort((x, y) => String(y.at).localeCompare(String(x.at)))
    : [];

  const run = async (reason: string) => {
    if (!loan) return;
    const money = (field: string) => {
      const parsed = parseMoneyInput(amount, loan.currency);
      if (!parsed.ok) throw invalid(field, parsed.message);
      return { amount: parsed.amount, currency: loan.currency };
    };
    switch (action) {
      case "cancel":
        await loansApi.cancel(loan.id, reason);
        toast.success("Loan cancelled.");
        break;
      case "pause":
        await loansApi.pause(loan.id, reason);
        toast.success("Pause requested. It applies once approved.");
        break;
      case "resume":
        await loansApi.resume(loan.id, reason);
        toast.success("Resume requested. It applies once approved.");
        break;
      case "restructure": {
        const months = Number.parseInt(tenure, 10);
        if (!months || months < 1 || months > 600) throw invalid("tenure", "Enter the new tenure as a whole number between 1 and 600.");
        await loansApi.restructure(loan.id, months, reason);
        toast.success("Restructure requested. The new schedule applies once approved.");
        break;
      }
      case "prepay":
        await loansApi.prepay(loan.id, money("amount"), reference.trim() || undefined, reason);
        toast.success("Prepayment recorded for approval.");
        break;
      case "waive":
        await loansApi.waive(loan.id, money("amount"), reason);
        toast.success("Waiver requested. It applies once approved.");
        break;
    }
    void reload();
  };

  const isLoan = loan?.kind === "LOAN";
  return (
    <DetailGate loading={loading} error={error} hasData={!!loan} onRetry={reload} what="Loan" backHref="/payroll/loans" backLabel="Back to Loans & Advances">
      {loan && (
        <div className="space-y-6">
          <Link href="/payroll/loans" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Loans & Advances
          </Link>
          <WorkspaceHeader
            title={`${KIND_LABEL[loan.kind] ?? loan.kind} · ${people.name(loan.employee_id)}`}
            description={`#${loan.id} · applied ${fmtDate(loan.created_at)}${loan.purpose ? ` · ${loan.purpose}` : ""}`}
            actions={
              <>
                {canApprove && loan.status === "PENDING_APPROVAL" && (
                  <>
                    <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => open("reject")}>
                      Reject
                    </Button>
                    <Button className="min-h-[44px]" onClick={() => open("approve")}>
                      Approve
                    </Button>
                  </>
                )}
                {canManage && loan.status === "ACTIVE" && (
                  <>
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => open("pause")}>
                      Pause
                    </Button>
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => open("restructure")}>
                      Restructure
                    </Button>
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => open("prepay")}>
                      Record prepayment
                    </Button>
                    <Button variant="ghost" className="min-h-[44px]" onClick={() => open("waive")}>
                      Waive
                    </Button>
                  </>
                )}
                {canManage && loan.status === "PAUSED" && (
                  <Button className="min-h-[44px]" onClick={() => open("resume")}>
                    Resume recovery
                  </Button>
                )}
                {canManage && (loan.status === "PENDING_APPROVAL" || loan.status === "APPROVED") && (
                  <Button variant="ghost" className="min-h-[44px]" onClick={() => open("cancel")}>
                    Cancel
                  </Button>
                )}
              </>
            }
          />
          {loan.application_issues.length > 0 && (
            <Notice tone={loan.application_issues.some((i) => i.severity === "BLOCKING") ? "danger" : "warning"} title="Policy checks">
              <ul className="list-disc ps-5">
                {loan.application_issues.map((i, n) => (
                  <li key={n}>{i.message ?? i.code}</li>
                ))}
              </ul>
            </Notice>
          )}
          {loan.status === "APPROVED" && !loan.disbursed_on && (
            <Notice title="Approved — waiting for disbursement">The money is not paid yet. Disbursement is recorded when a payment batch with settlement evidence pays it.</Notice>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-6">
              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <StatusChip vocabulary="loan" code={loan.status} />
                  {loan.status_reason && <span className="text-sm text-muted-foreground">{loan.status_reason}</span>}
                </div>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Principal</dt>
                    <dd className="mt-1 text-lg">
                      <MoneyText money={loan.principal} emphasis />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Balance</dt>
                    <dd className="mt-1 text-lg">
                      <MoneyText money={loan.balance} emphasis />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tenure</dt>
                    <dd className="mt-1">{loan.tenure ? `${loan.tenure} ${isLoan ? "months" : "pay runs"}` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Disbursed</dt>
                    <dd className="mt-1">{loan.disbursed_on ? fmtDate(loan.disbursed_on) : "Not yet"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Schedule version</dt>
                    <dd className="mt-1 tabular-nums">v{loan.schedule_version}</dd>
                  </div>
                </dl>
              </Card>
              <Card>
                <CardHeader title="Repayment schedule" description="Each pay run deducts the instalment, never below the protected net pay." />
                {loan.schedule ? (
                  <>
                    <ScheduleTable rows={loan.schedule.instalments} currency={loan.schedule.currency} />
                    <div className="p-5">
                      <ExplainPanel
                        explanation={loan.schedule.explanation ?? "Instalments from the policy's repayment method."}
                        inputs={[
                          { label: "Principal", value: <MoneyText amount={loan.schedule.principal} currency={loan.schedule.currency} /> },
                          { label: "Method", value: human(loan.schedule.method) },
                          { label: "Annual interest", value: <bdi dir="ltr">{loan.schedule.annual_rate_percent}%</bdi> },
                          { label: "Total interest", value: <MoneyText amount={loan.schedule.total_interest} currency={loan.schedule.currency} /> },
                          { label: "Total payable", value: <MoneyText amount={loan.schedule.total_payable} currency={loan.schedule.currency} /> },
                        ]}
                      />
                    </div>
                  </>
                ) : (
                  <EmptyState title="No schedule" description="The application did not pass the policy checks, so no schedule was created." />
                )}
              </Card>
            </div>
            <Card>
              <CardHeader title="Ledger" description="Disbursement, recoveries, prepayments, waivers and requested changes." />
              <div className="px-5 pb-5">
                <Timeline items={ledger} label="Loan ledger" empty={<p className="text-sm text-muted-foreground">No transactions yet.</p>} />
              </div>
            </Card>
          </div>

          {(action === "approve" || action === "reject") && (
            <DecisionModal
              open
              onOpenChange={(o) => !o && setAction(null)}
              decision={action}
              subject={`${KIND_LABEL[loan.kind] ?? loan.kind} for ${people.name(loan.employee_id)}`}
              summary={
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <MoneyText money={loan.principal} emphasis /> {loan.tenure ? `over ${loan.tenure} ${isLoan ? "months" : "pay runs"}` : ""}
                </div>
              }
              acknowledge={loan.application_issues.map((i) => i.message ?? i.code)}
              onReload={reload}
              onSubmit={async (remarks) => {
                if (action === "approve") await loansApi.approve(loan.id, remarks);
                else await loansApi.reject(loan.id, remarks);
                toast.success(action === "approve" ? "Approved. It is paid out through a payment batch." : "Rejected. The employee sees your reason.");
                void reload();
              }}
            />
          )}
          {action && action !== "approve" && action !== "reject" && (
            <ReasonModal
              open
              onOpenChange={(o) => !o && setAction(null)}
              title={{ cancel: "Cancel this loan?", pause: "Pause recovery?", resume: "Resume recovery?", restructure: "Restructure the schedule", prepay: "Record a prepayment", waive: "Waive part of the balance?" }[action]}
              consequence={
                {
                  cancel: "The application is withdrawn and nothing is paid out.",
                  pause: "Pay runs stop deducting instalments until recovery is resumed. Needs approval.",
                  resume: "Pay runs start deducting instalments again from the next run. Needs approval.",
                  restructure: "The remaining balance is spread over a new tenure; a new schedule version replaces the current one once approved.",
                  prepay: "Money the employee paid back directly. It reduces the balance once approved.",
                  waive: "The waived amount is written off and never recovered. Needs approval; it may be taxable for the employee.",
                }[action]
              }
              confirmLabel={{ cancel: "Cancel loan", pause: "Request pause", resume: "Request resume", restructure: "Request restructure", prepay: "Record prepayment", waive: "Request waiver" }[action]}
              optional={action === "resume" || action === "prepay"}
              danger={action === "cancel" || action === "waive"}
              onReload={reload}
              onSubmit={run}
            >
              {action === "restructure" && (
                <Field label={isLoan ? "New tenure in months" : "Recover over pay runs"} required>
                  <Input inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value.replace(/\D/g, ""))} />
                </Field>
              )}
              {(action === "prepay" || action === "waive") && (
                <Field label={`Amount (${loan.currency})`} required>
                  <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
              )}
              {action === "prepay" && (
                <Field label="Payment reference (optional)">
                  <Input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
            </ReasonModal>
          )}
        </div>
      )}
    </DetailGate>
  );
}

export type { LoanInstalment };
