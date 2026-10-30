"use client";

import { motion } from "framer-motion";
import { BookOpenText, Banknote, Info, Search, Timer, Undo2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, TabPanel, Tabs, type Column } from "@/components/ui/layout";
import { Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { LEDGER_REASON_LABEL, leaveApi, leaveErrorMessage, units } from "@/lib/leave/api";
import { emitLeaveChanged, useLeaveChanged } from "@/lib/leave/events";
import type { CompOffClaim, CompOffPreview, Encashment, LeaveBalance, LedgerRow } from "@/lib/leave/types";
import { useTabParam } from "@/lib/useTabParam";

import { BalanceCards } from "./BalanceCards";
import { LeaveStatusChip } from "./LeaveBits";
import { useLeaveAccess } from "./LeaveAccessContext";
import { useLeaveOverlays } from "./LeaveOverlays";

const TABS = ["overview", "comp-off", "encash"] as const;
type BalancesTab = (typeof TABS)[number];

function V2Notice({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState
        icon={<Info />}
        title={`${what} is not available yet`}
        description="Your company still uses the earlier leave rules. This opens when HR switches to the new leave plans."
      />
    </Card>
  );
}

/**
 * `/leaves/balances`: my balances, the ledger behind them (each row explained), comp-off claims and encashment
 * requests. Ledger, comp-off and encashment answer 404 before the tenant's leave v2 cut-over, so they explain that
 * instead of failing.
 */
export function LeaveBalancesPage() {
  const { access } = useLeaveAccess();
  const { openApply } = useLeaveOverlays();
  const [tab, setTab] = useTabParam<BalancesTab>(TABS, "overview");
  const { data: mine, error, loading, reload } = useApi(() => leaveApi.myBalances(), []);
  useLeaveChanged(() => void reload());
  const v2 = mine?.v2_enabled ?? access?.v2_enabled ?? false;
  const balances = mine?.balances ?? [];

  return (
    <div data-testid="leave-balances">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as BalancesTab)}
        tabs={[
          { value: "overview", label: "Balances" },
          { value: "comp-off", label: "Comp-off" },
          { value: "encash", label: "Encashment" },
        ]}
      >
        <TabPanel value="overview">
          <div className="space-y-6">
            {error ? (
              <Card><ErrorState message={error.message} onRetry={() => void reload()} /></Card>
            ) : (
              <BalanceCards balances={mine?.balances} loading={loading} onApply={(code) => openApply({ type: code })} />
            )}
            {mine && (v2 ? <Ledger balances={balances} /> : <V2Notice what="The balance history" />)}
          </div>
        </TabPanel>
        <TabPanel value="comp-off">{v2 ? <CompOff /> : <V2Notice what="Comp-off" />}</TabPanel>
        <TabPanel value="encash">{v2 ? <Encash balances={balances} /> : <V2Notice what="Encashment" />}</TabPanel>
      </Tabs>
    </div>
  );
}

/* ================================================================ ledger */
function Ledger({ balances }: { balances: LeaveBalance[] }) {
  const { openLeave } = useLeaveOverlays();
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [explaining, setExplaining] = useState<LedgerRow | null>(null);
  const { data, error, loading, reload } = useApi(
    () => leaveApi.ledger({ leave_type: type || undefined, start: start || undefined, end: end || undefined }),
    [type, start, end],
  );
  useLeaveChanged(() => void reload());
  const names = Object.fromEntries(balances.map((b) => [b.leave_type_code, b.name]));
  const explain = useApi(() => (explaining ? leaveApi.explain(explaining.id) : Promise.resolve(undefined)), [explaining?.id], { enabled: !!explaining });

  const columns: Column<LedgerRow>[] = [
    { key: "date", header: "Date", primary: true, cell: (r) => fmtDate(r.effective_date) },
    { key: "type", header: "Type", cell: (r) => names[r.leave_type] ?? titleCase(r.leave_type) },
    { key: "reason", header: "What", cell: (r) => LEDGER_REASON_LABEL[r.reason] ?? titleCase(r.reason.toLowerCase()) },
    {
      key: "delta",
      header: "Change",
      className: "text-end",
      cell: (r) => <span className={cn("font-medium tabular-nums", r.delta > 0 ? "text-success" : r.delta < 0 ? "text-danger" : "")}>{r.delta > 0 ? "+" : ""}{r.delta}</span>,
    },
    { key: "expires", header: "Expires", hideOnMobile: true, cell: (r) => (r.expires_on ? fmtDate(r.expires_on) : "—") },
    { key: "note", header: "Note", hideOnMobile: true, cell: (r) => <span className="line-clamp-1 text-muted-foreground">{r.note ?? ""}</span> },
  ];

  return (
    <Card>
      <CardHeader title="Balance history" description="Every credit and debit behind your balances. Select a row to see why it happened." />
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)} data-testid="ledger-type">
            <option value="">All types</option>
            {balances.map((b) => <option key={b.leave_type_code} value={b.leave_type_code}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Leave balance history"
          rows={data}
          loading={loading}
          busy={loading && !!data}
          rowKey={(r) => r.id}
          cardBelowMd
          onRowClick={(r) => setExplaining(r)}
          columns={columns}
          empty={<EmptyState icon={<BookOpenText />} title="No balance movements" />}
        />
      )}
      <Sheet open={!!explaining} onOpenChange={(o) => !o && setExplaining(null)} title="Why this changed" description={explaining ? fmtDate(explaining.effective_date) : undefined} width="max-w-md">
        {explain.error ? (
          <ErrorState message={explain.error.message} onRetry={() => void explain.reload()} />
        ) : !explain.data || explain.data.id !== explaining?.id ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4" data-testid="ledger-explain">
            <p className="text-2xl font-semibold tabular-nums">
              <span className={explain.data.delta > 0 ? "text-success" : "text-danger"}>{explain.data.delta > 0 ? "+" : ""}{explain.data.delta}</span>
              <span className="ms-2 text-sm font-normal text-muted-foreground">{LEDGER_REASON_LABEL[explain.data.reason] ?? explain.data.reason}</span>
            </p>
            <p className="text-sm">{explain.data.explanation}</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Effective</dt><dd>{fmtDate(explain.data.effective_date)}</dd></div>
              {explain.data.cycle && (
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Leave year</dt><dd>{fmtDate(explain.data.cycle.start)} – {fmtDate(explain.data.cycle.end)}</dd></div>
              )}
              {explain.data.source && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Source</dt><dd>{titleCase(explain.data.source.toLowerCase())}</dd></div>}
              {explain.data.note && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Note</dt><dd className="text-end">{explain.data.note}</dd></div>}
            </dl>
            {explain.data.ref_type === "leave" && explain.data.ref_id && (
              <Button variant="secondary" size="sm" onClick={() => { const id = explain.data!.ref_id!; setExplaining(null); openLeave(id); }}>
                Open request #{explain.data.ref_id}
              </Button>
            )}
          </motion.div>
        )}
      </Sheet>
    </Card>
  );
}

/* ================================================================ comp-off */
function CompOff() {
  const { access } = useLeaveAccess();
  const confirm = useConfirm();
  const today = access?.local_today ?? new Date().toISOString().slice(0, 10);
  const [worked, setWorked] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<CompOffPreview | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { data: claims, error, loading, reload } = useApi(() => leaveApi.compOffClaims("mine"), []);

  const check = async (date: string) => {
    setPreview(null);
    setCheckError(null);
    if (!date) return;
    setChecking(true);
    try {
      setPreview(await leaveApi.compOffPreview(date));
    } catch (e) {
      setCheckError(leaveErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };
  const claim = async () => {
    if (!preview) return;
    setClaiming(true);
    try {
      await leaveApi.claimCompOff({ worked_date: preview.worked_date, reason: reason.trim() || null });
      toast.success("Comp-off claimed. Your manager will review it.");
      setWorked("");
      setReason("");
      setPreview(null);
      void reload();
      emitLeaveChanged();
    } catch (e) {
      setCheckError(leaveErrorMessage(e));
    } finally {
      setClaiming(false);
    }
  };
  const withdraw = async (c: CompOffClaim) => {
    if (!(await confirm({ title: "Withdraw this claim?", message: `Comp-off for ${fmtDate(c.worked_date)}.`, confirmLabel: "Withdraw", cancelLabel: "Keep it", tone: "danger" }))) return;
    try {
      await leaveApi.actOnClaim(c.id, "withdraw");
      toast.success("Claim withdrawn");
      void reload();
    } catch (e) {
      toast.error(leaveErrorMessage(e));
    }
  };

  const columns: Column<CompOffClaim>[] = [
    { key: "date", header: "Worked on", primary: true, cell: (c) => fmtDate(c.worked_date, "EEE, d MMM yyyy") },
    { key: "source", header: "Day", cell: (c) => (c.source === "HOLIDAY_WORK" ? "Holiday" : "Weekly off") },
    { key: "credit", header: "Credit", cell: (c) => units(c.credit_units) },
    { key: "status", header: "Status", cell: (c) => <LeaveStatusChip status={c.status} /> },
    { key: "expires", header: "Expires", hideOnMobile: true, cell: (c) => (c.expires_on ? fmtDate(c.expires_on) : "—") },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (c) => c.status === "PENDING" ? (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void withdraw(c); }} data-testid={`claim-withdraw-${c.id}`}>
          <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="h-fit" data-testid="comp-off-form">
        <CardHeader title="Claim comp-off" description="For work on a holiday or a weekly off, from your recorded attendance." />
        <div className="space-y-4 p-5">
          <Field label="Day you worked" required>
            <Input type="date" value={worked} max={today} onChange={(e) => { setWorked(e.target.value); void check(e.target.value); }} data-testid="comp-off-date" />
          </Field>
          {checking && <Skeleton className="h-16 rounded-xl" />}
          {checkError && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="comp-off-error">{checkError}</p>}
          {preview && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm" data-testid="comp-off-preview">
              <p className="font-medium">{units(preview.credit_units)} of comp-off</p>
              <p className="text-muted-foreground">
                {preview.source === "HOLIDAY_WORK" ? `Holiday${preview.holiday ? ` (${preview.holiday})` : ""}` : "Weekly off"} · {Math.floor(preview.worked_minutes / 60)} h {preview.worked_minutes % 60} min recorded · use by {fmtDate(preview.expires_on)}
              </p>
            </motion.div>
          )}
          <Field label="Reason" hint="Optional: what you worked on.">
            <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="comp-off-reason" />
          </Field>
          <Button className="w-full" loading={claiming} disabled={!preview} onClick={() => void claim()} data-testid="comp-off-claim">
            <Timer className="h-4 w-4" aria-hidden /> Claim comp-off
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="My claims" />
        {error ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable caption="My comp-off claims" rows={claims} loading={loading} rowKey={(c) => c.id} cardBelowMd columns={columns}
            empty={<EmptyState icon={<Search />} title="No comp-off claims yet" />} />
        )}
      </Card>
    </div>
  );
}

/* ================================================================ encashment */
function Encash({ balances }: { balances: LeaveBalance[] }) {
  const confirm = useConfirm();
  const candidates = balances.filter((b) => !b.unlimited && !b.frozen && (b.available ?? 0) > 0);
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data: rows, error, loading, reload } = useApi(() => leaveApi.encashments("mine"), []);
  const chosen = candidates.find((b) => b.leave_type_code === (type || candidates[0]?.leave_type_code));
  const value = Number(amount);

  const send = async () => {
    if (!chosen || !(value > 0)) {
      setFormError("Enter how many days to encash.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await leaveApi.requestEncashment({ leave_type: chosen.leave_type_code, units: value, reason: reason.trim() || null });
      toast.success("Encashment requested. Your manager will review it.");
      setAmount("");
      setReason("");
      void reload();
      emitLeaveChanged();
    } catch (e) {
      setFormError(leaveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (r: Encashment) => {
    if (!(await confirm({ title: "Withdraw this encashment?", message: `${units(r.units)} of ${titleCase(r.leave_type)}.`, confirmLabel: "Withdraw", cancelLabel: "Keep it", tone: "danger" }))) return;
    try {
      await leaveApi.actOnEncashment(r.id, "withdraw");
      toast.success("Encashment withdrawn");
      void reload();
      emitLeaveChanged();
    } catch (e) {
      toast.error(leaveErrorMessage(e));
    }
  };

  const names = Object.fromEntries(balances.map((b) => [b.leave_type_code, b.name]));
  const columns: Column<Encashment>[] = [
    { key: "type", header: "Type", primary: true, cell: (r) => names[r.leave_type] ?? titleCase(r.leave_type) },
    { key: "units", header: "Days", cell: (r) => units(r.units) },
    { key: "status", header: "Status", cell: (r) => <LeaveStatusChip status={r.status} /> },
    { key: "when", header: "Requested", hideOnMobile: true, cell: (r) => fmtDate(r.created_at) },
    { key: "pay", header: "Payroll", hideOnMobile: true, cell: (r) => r.paid_at ? <Badge tone="success">Paid {fmtDate(r.paid_at)}</Badge> : r.payroll_reference ? <Badge tone="info">In payroll</Badge> : "—" },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => r.status === "PENDING" ? (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void withdraw(r); }} data-testid={`encashment-withdraw-${r.id}`}>
          <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="h-fit" data-testid="encash-form">
        <CardHeader title="Encash leave" description="Paid through payroll at your plan's rate; your plan decides which leave can be encashed." />
        <div className="space-y-4 p-5">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no balance that can be encashed right now.</p>
          ) : (
            <>
              <Field label="Leave type" required>
                <Select value={chosen?.leave_type_code ?? ""} onChange={(e) => setType(e.target.value)} data-testid="encash-type">
                  {candidates.map((b) => <option key={b.leave_type_code} value={b.leave_type_code}>{b.name} · {units(b.available)} available</option>)}
                </Select>
              </Field>
              <Field label="Days to encash" required hint={chosen ? `Up to ${chosen.available} available; the plan may keep a minimum balance.` : undefined}>
                <Input type="number" inputMode="decimal" min={0.5} step={0.5} max={chosen?.available ?? undefined} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="encash-units" />
              </Field>
              <Field label="Reason" hint="Optional.">
                <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="encash-reason" />
              </Field>
              {formError && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>}
              <Button className="w-full" loading={busy} onClick={() => void send()} data-testid="encash-submit">
                <Banknote className="h-4 w-4" aria-hidden /> Request encashment
              </Button>
            </>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="My encashments" />
        {error ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable caption="My encashment requests" rows={rows} loading={loading} rowKey={(r) => r.id} cardBelowMd columns={columns}
            empty={<EmptyState icon={<Banknote />} title="No encashment requests yet" />} />
        )}
      </Card>
    </div>
  );
}
