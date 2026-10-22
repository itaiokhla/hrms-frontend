"use client";

import { Landmark, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useCan } from "@/components/access/Can";
import { StatusChip } from "@/components/payroll/StatusChip";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Field, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { AccountNumber, BankAccountModal } from "./BankAccountPanel";
import { BankChangeModal } from "./BankChangeReview";
import { bankApi } from "./api";
import { CHANNEL_LABELS, FilterBar, HOLD_REASONS, LocalChip, WorkspaceHeader, flagLabel, humanize, useCountdown, useEmployeeDirectory, useTab } from "./shared";
import type { BankAccount, BankChangeRequest } from "./types";

const LIMIT = 50;
const TABS = ["verification", "changes", "flags"] as const;
type Tab = (typeof TABS)[number];

function Cooling({ until }: { until: string | null }) {
  const left = useCountdown(until);
  return left ? <span className="text-xs text-warning">Cooling-off · {left}</span> : null;
}

function openFlagCodes(a: BankAccount): string[] {
  return (a.risk_flags ?? []).filter((f) => f.open).map((f) => f.code);
}

/* ------------------------------------------------------------------ verification queue */

function VerificationQueue({ refresh, onOpen }: { refresh: number; onOpen: (id: number) => void }) {
  const employees = useEmployeeDirectory();
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(() => bankApi.accounts({ verification_status: "PENDING", skip, limit: LIMIT }), [skip, refresh]);
  const columns: Column<BankAccount>[] = [
    { key: "payee", header: "Payee", primary: true, cell: (a) => <span className="font-medium">{a.employee_id ? employees.name(a.employee_id) : `${humanize(a.payee_type)} #${a.payee_id}`}</span> },
    { key: "holder", header: "Account holder", cell: (a) => a.holder_name },
    { key: "account", header: "Account", cell: (a) => <AccountNumber account={a} /> },
    { key: "bank", header: "Bank", hideOnMobile: true, cell: (a) => a.bank_name ?? "—" },
    { key: "status", header: "Status", cell: (a) => <span className="flex flex-col items-start gap-1"><StatusChip vocabulary="bank_account" code={a.status} /><Cooling until={a.cooling_off ? a.usable_from : null} /></span> },
    { key: "added", header: "Added", hideOnMobile: true, cell: (a) => fmtDate(a.created_at) },
  ];
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <Card>
      <DataTable
        caption="Accounts waiting for verification"
        columns={columns}
        rows={data?.items}
        loading={loading}
        rowKey={(a) => a.id}
        onRowClick={(a) => onOpen(a.id)}
        cardBelowMd
        empty={<EmptyState icon={<ShieldCheck />} title="Nothing waiting for verification" description="New and changed accounts appear here with their documents for review." />}
      />
      <Pagination total={data?.total ?? 0} skip={skip} limit={LIMIT} onChange={setSkip} />
    </Card>
  );
}

/* ------------------------------------------------------------------ change requests */

const CHANGE_FILTERS = [
  { value: "PENDING_APPROVAL", label: "Awaiting approval" },
  { value: "SECURITY_REVIEW", label: "Security review" },
  { value: "APPLIED", label: "Applied" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Withdrawn" },
  { value: "", label: "All" },
];

function ChangeQueue({ refresh, onOpen }: { refresh: number; onOpen: (id: number) => void }) {
  const employees = useEmployeeDirectory();
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(() => bankApi.changes({ status, skip, limit: LIMIT }), [status, skip, refresh]);
  const columns: Column<BankChangeRequest>[] = [
    { key: "employee", header: "Employee", primary: true, cell: (c) => <span className="font-medium">{employees.name(c.employee_id)}</span> },
    { key: "kind", header: "Change", cell: (c) => (c.kind === "REPLACE" ? `Replace → ${c.after.account_masked}` : `New ${c.after.account_masked}`) },
    {
      key: "flags",
      header: "Risk flags",
      cell: (c) =>
        (c.risk_flags ?? []).length ? (
          <span className="inline-flex flex-wrap gap-1">
            {(c.risk_flags ?? []).map((f, i) => (
              <span key={`${f.code}-${i}`} className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
                {flagLabel(f.code)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    { key: "channel", header: "Entered by", hideOnMobile: true, cell: (c) => CHANNEL_LABELS[c.channel] ?? c.channel },
    { key: "status", header: "Status", cell: (c) => <span className="flex flex-col items-start gap-1"><LocalChip vocabulary="change" code={c.status} /><Cooling until={c.after.cooling_off ? c.after.usable_from : null} /></span> },
    { key: "created", header: "Requested", hideOnMobile: true, cell: (c) => fmtDateTime(c.created_at) },
  ];
  return (
    <Card>
      <FilterBar>
        <Field label="Status">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
            {CHANGE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Bank change requests"
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(c) => c.id}
          onRowClick={(c) => onOpen(c.id)}
          cardBelowMd
          empty={<EmptyState icon={<Landmark />} title={status === "PENDING_APPROVAL" ? "No changes waiting for approval" : "No change requests"} description="When an employee or HR adds or replaces a bank account, it waits here for a second person." />}
        />
      )}
      <Pagination total={data?.total ?? 0} skip={skip} limit={LIMIT} onChange={setSkip} />
    </Card>
  );
}

/* ------------------------------------------------------------------ flags */

const FLAG_QUEUES = [
  { value: "review", label: "Needs review", params: { verification_status: "REQUIRES_REVIEW" }, empty: "No account needs a risk review." },
  { value: "hold", label: "Payments held", params: { payment_hold: true }, empty: "No account has its payments held." },
  { value: "failed", label: "Failed", params: { verification_status: "FAILED" }, empty: "No failed verifications or returned payments." },
  { value: "expired", label: "Expired", params: { verification_status: "EXPIRED" }, empty: "No expired verifications." },
] as const;

function FlagQueue({ refresh, onOpen }: { refresh: number; onOpen: (id: number) => void }) {
  const employees = useEmployeeDirectory();
  const [queue, setQueue] = useState<(typeof FLAG_QUEUES)[number]["value"]>("review");
  const [skip, setSkip] = useState(0);
  const current = FLAG_QUEUES.find((q) => q.value === queue) ?? FLAG_QUEUES[0];
  const { data, error, loading, reload } = useApi(() => bankApi.accounts({ ...current.params, skip, limit: LIMIT }), [queue, skip, refresh]);
  const columns: Column<BankAccount>[] = [
    { key: "payee", header: "Payee", primary: true, cell: (a) => <span className="font-medium">{a.employee_id ? employees.name(a.employee_id) : `${humanize(a.payee_type)} #${a.payee_id}`}</span> },
    { key: "account", header: "Account", cell: (a) => <AccountNumber account={a} /> },
    {
      key: "why",
      header: "Why",
      cell: (a) => {
        const reasons = [...openFlagCodes(a).map(flagLabel), a.payment_hold ? HOLD_REASONS[a.hold_reason ?? ""] ?? humanize(a.hold_reason) : null, a.failure_reason].filter(Boolean);
        return reasons.length ? reasons.join(" · ") : <span className="text-muted-foreground">{humanize(a.status_reason) || "—"}</span>;
      },
    },
    { key: "verification", header: "Verification", cell: (a) => <StatusChip vocabulary="verification" code={a.verification_status} /> },
    { key: "failed", header: "Last failure", hideOnMobile: true, cell: (a) => (a.last_failed_at ? fmtDate(a.last_failed_at) : "—") },
  ];
  return (
    <Card>
      <FilterBar>
        <div role="group" aria-label="Flag type" className="flex flex-wrap gap-2">
          {FLAG_QUEUES.map((q) => (
            <button
              key={q.value}
              type="button"
              aria-pressed={q.value === queue}
              onClick={() => { setQueue(q.value); setSkip(0); }}
              className={`min-h-[44px] rounded-xl border px-4 text-sm font-medium transition-colors ${q.value === queue ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {q.label}
            </button>
          ))}
        </div>
      </FilterBar>
      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption={`Flagged accounts: ${current.label}`}
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(a) => a.id}
          onRowClick={(a) => onOpen(a.id)}
          cardBelowMd
          empty={<EmptyState icon={<ShieldAlert />} title="All clear" description={current.empty} />}
        />
      )}
      <Pagination total={data?.total ?? 0} skip={skip} limit={LIMIT} onChange={setSkip} />
    </Card>
  );
}

/* ------------------------------------------------------------------ workspace */

/**
 * Payroll › Bank Details (3.8 §5.11): Verification · Change requests · Flags. Accounts are masked
 * everywhere; Reveal needs payroll:bank_details:read_full, a reason and a step-up (audited, hides
 * after 30 s). Deep links: `?modal=account&id=`, `?modal=bank-change&id=`.
 */
export function BankDetailsWorkspace() {
  const { me } = useCan();
  const [tab, setTab] = useTab<Tab>(TABS, "verification");
  const accountModal = useModalRoute("account");
  const changeModal = useModalRoute("bank-change");
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);

  // Tab badges come from the same queries as the lists (EC-UX-03).
  const pending = useApi(() => bankApi.accounts({ verification_status: "PENDING", limit: 1 }), [refresh]);
  const changes = useApi(() => bankApi.changes({ status: "PENDING_APPROVAL", limit: 1 }), [refresh]);
  const review = useApi(() => bankApi.accounts({ verification_status: "REQUIRES_REVIEW", limit: 1 }), [refresh]);

  const approver = can(me, P.PAYROLL_BANK_DETAILS_APPROVE);
  return (
    <div>
      <WorkspaceHeader
        title="Bank Details"
        description={
          approver
            ? "Verify new accounts, approve bank changes and clear risk flags. Account numbers stay masked unless you reveal them with a reason."
            : "Bank accounts of the people you can see. Account numbers stay masked."
        }
       
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "verification", label: "Verification", badge: pending.data?.total || undefined },
          { value: "changes", label: "Change requests", badge: changes.data?.total || undefined },
          { value: "flags", label: "Flags", badge: review.data?.total || undefined },
        ]}
      >
        <TabPanel value="verification">
          <VerificationQueue refresh={refresh} onOpen={(id) => accountModal.openModal({ id })} />
        </TabPanel>
        <TabPanel value="changes">
          <ChangeQueue refresh={refresh} onOpen={(id) => changeModal.openModal({ id })} />
        </TabPanel>
        <TabPanel value="flags">
          <FlagQueue refresh={refresh} onOpen={(id) => accountModal.openModal({ id })} />
        </TabPanel>
      </Tabs>
      <BankAccountModal open={accountModal.open} onOpenChange={accountModal.onOpenChange} id={accountModal.id} onChanged={bump} />
      <BankChangeModal open={changeModal.open} onOpenChange={changeModal.onOpenChange} id={changeModal.id} onChanged={bump} />
    </div>
  );
}
