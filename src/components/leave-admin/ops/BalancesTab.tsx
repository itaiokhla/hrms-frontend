"use client";

import { motion } from "framer-motion";
import { ChevronRight, Info, Scale, SlidersHorizontal, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, SearchInput, type Column } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Badge, Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { BalanceView, HrBalances, LeaveAccess, LedgerExplain, LedgerRow } from "@/lib/leave/adminTypes";
import { useModalRoute } from "@/lib/useModalRoute";

import { ErrorNotice, LeaveSwatch, fmtUnits, hasLeavePerm, humanize, useLeaveTypes } from "../shared";

export const BALANCE_MODAL = "leave-balance";

type Row = HrBalances["employees"][number];

/* ------------------------------------------------------------------ adjust */

/** Adjust balance (`POST /leaves/adjustments`): a signed delta with a reason; large ones need a fresh step-up. */
export function AdjustBalanceModal({ open, onOpenChange, employee, balances, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: { id: number; name: string };
  balances: BalanceView[];
  onDone: () => void;
}) {
  const types = useLeaveTypes(false);
  const reasons = useApi(() => leaveAdminApi.reasonCodes("ADJUST").catch(() => []), [], { enabled: open });
  const [type, setType] = useState("");
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [units, setUnits] = useState("");
  const [effective, setEffective] = useState(todayISO());
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setType(balances.find((b) => !b.unlimited)?.leave_type_code ?? "");
      setUnits("");
      setReason("");
      setReasonCode("");
      setExpires("");
      setErrors({});
      setError(null);
    }
  }, [open, balances]);
  const limited = (types.data ?? []).filter((t) => !t.is_unlimited);
  const current = balances.find((b) => b.leave_type_code === type);
  const submit = async () => {
    const found: Record<string, string> = {};
    if (!type) found.type = "Choose a leave type.";
    if (!/^\d+(\.\d{1,2})?$/.test(units.trim()) || Number(units) <= 0 || Number(units) > 366) found.units = "A number above 0 and at most 366, with up to 2 decimals.";
    if (!effective) found.effective = "Choose the date.";
    if (reason.trim().length < 3) found.reason = "Give a reason of at least 3 characters.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const delta = `${direction === "deduct" ? "-" : ""}${units.trim()}`;
      await leaveAdminApi.adjust({
        employee_id: employee.id, leave_type: type, delta, effective_date: effective, reason: reason.trim(),
        reason_code: reasonCode || null, expires_on: direction === "add" && expires ? expires : null,
      });
      toast.success(`Balance adjusted by ${delta}`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Adjust ${employee.name}'s balance`}
      description="Adds a ledger row with your reason. You cannot adjust your own balance."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} loading={busy} data-testid="adjust-submit">Adjust balance</Button></>}>
      <div className="space-y-4" data-testid="adjust-modal">
        <Field label="Leave type" required error={errors.type}>
          <Select value={type} onChange={(e) => setType(e.target.value)} data-testid="adjust-type">
            <option value="">Choose…</option>
            {limited.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        {current && <p className="text-xs text-muted-foreground">Balance now {fmtUnits(current.balance)} · available {fmtUnits(current.available)}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Change">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as "add" | "deduct")} data-testid="adjust-direction">
              <option value="add">Add units</option>
              <option value="deduct">Deduct units</option>
            </Select>
          </Field>
          <Field label="Units" required error={errors.units}><Input inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} data-testid="adjust-units" /></Field>
          <Field label="Effective date" required error={errors.effective}><Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
          {direction === "add" && <Field label="Expires on (optional)"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>}
        </div>
        {(reasons.data?.length ?? 0) > 0 && (
          <Field label="Reason code (optional)">
            <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">None</option>
              {(reasons.data ?? []).map((r) => <option key={r.id} value={r.code}>{r.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Reason" required error={errors.reason} hint="Kept in the ledger and the audit trail.">
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" />
        </Field>
        <Notice tone="info" title="Large adjustments ask you to confirm it's you">Above the company's threshold a fresh identity check is required.</Notice>
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ employee drawer */

function BalanceCard({ b, index }: { b: BalanceView; index: number }) {
  const parts: [string, number][] = [
    ["Opening", b.opening], ["Credited", b.credited], ["Used", b.used], ["Adjusted", b.adjusted],
    ["Encashed", b.encashed], ["Lapsed", b.lapsed], ["Expired", b.expired], ["Pending", b.pending],
  ];
  return (
    <MotionSafe>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}
        className="rounded-2xl border border-border p-4" data-testid={`balance-card-${b.leave_type_code}`}>
        <div className="flex items-center gap-2">
          <LeaveSwatch token={b.color_token} />
          <p className="flex-1 font-semibold">{b.name}</p>
          {b.frozen && <Badge>Retired</Badge>}
          {b.eligibility && b.eligibility !== "ELIGIBLE" && <Badge tone="warning">{humanize(b.eligibility)}</Badge>}
        </div>
        <div className="mt-3 flex items-end gap-6">
          <div><p className="text-xs text-muted-foreground">Available</p><p className="font-display text-2xl font-semibold tabular-nums">{b.unlimited ? "∞" : fmtUnits(b.available)}</p></div>
          <div><p className="text-xs text-muted-foreground">Balance</p><p className="text-lg font-medium tabular-nums">{b.unlimited ? "—" : fmtUnits(b.balance)}</p></div>
          <p className="ms-auto text-xs text-muted-foreground">{b.unit === "HOUR" ? "hours" : "days"}{b.cycle_start ? ` · ${fmtDate(b.cycle_start)} – ${fmtDate(b.cycle_end)}` : ""}</p>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
          {parts.map(([label, value]) => (
            <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{fmtUnits(value)}</dd></div>
          ))}
        </dl>
        {b.expiring.length > 0 && <p className="mt-2 text-xs text-warning">Expiring: {b.expiring.map((x) => `${fmtUnits(x.units)} on ${fmtDate(x.expires_on)}`).join(", ")}</p>}
      </motion.div>
    </MotionSafe>
  );
}

function LedgerList({ employeeId }: { employeeId: number }) {
  const [type, setType] = useState("");
  const ledger = useApi(() => leaveAdminApi.ledger(employeeId, { leave_type: type || undefined }), [employeeId, type]);
  const [open, setOpen] = useState<number | null>(null);
  const [explain, setExplain] = useState<Record<number, LedgerExplain>>({});
  const toggle = async (row: LedgerRow) => {
    setOpen((o) => (o === row.id ? null : row.id));
    if (!explain[row.id]) {
      try {
        const found = await leaveAdminApi.explainLedger(row.id);
        setExplain((all) => ({ ...all, [row.id]: found }));
      } catch {
        /* the row itself is enough */
      }
    }
  };
  const codes = useMemo(() => Array.from(new Set((ledger.data ?? []).map((r) => r.leave_type))), [ledger.data]);
  return (
    <section className="space-y-2" data-testid="ledger">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold">Ledger</h3>
        <Select aria-label="Ledger leave type" className="w-44" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      {ledger.error ? <ErrorNotice error={ledger.error} /> : !ledger.data ? <Skeleton className="h-32" /> : ledger.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No ledger rows yet.</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border">
          {ledger.data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => void toggle(r)} aria-expanded={open === r.id}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted/60">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmtDate(r.effective_date)}</span>
                <span className="font-mono text-xs">{r.leave_type}</span>
                <span className="flex-1 truncate text-muted-foreground">{humanize(r.reason)}{r.note ? ` · ${r.note}` : ""}</span>
                <span className={cn("tabular-nums font-semibold", r.delta < 0 ? "text-danger" : "text-success")}>{r.delta > 0 ? "+" : ""}{fmtUnits(r.delta)}</span>
                <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open === r.id && "rotate-90")} aria-hidden />
              </button>
              {open === r.id && (
                <div className="bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <p className="flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden />{explain[r.id]?.explanation ?? "Loading…"}</p>
                  <p className="mt-1">Source {humanize(r.source)}{r.expires_on ? ` · expires ${fmtDate(r.expires_on)}` : ""}{r.ref_type ? ` · ${r.ref_type} #${r.ref_id}` : ""}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EmployeeBalanceSheet({ employeeId, access, open, onOpenChange }: {
  employeeId: number | null;
  access: LeaveAccess | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useApi(() => leaveAdminApi.employeeBalances(employeeId!), [employeeId], { enabled: !!employeeId && open });
  const [adjust, setAdjust] = useState(false);
  const canAdjust = hasLeavePerm(access, "leave:balance_adjust") && !!access?.v2_enabled && employeeId !== access?.employee_id;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} width="max-w-2xl" title={data.data?.name ?? "Balances"}
      description={data.data ? `As of ${fmtDate(data.data.date)}` : undefined}
      footer={canAdjust && data.data ? <Button onClick={() => setAdjust(true)} data-testid="open-adjust"><SlidersHorizontal className="h-4 w-4" /> Adjust balance</Button> : undefined}>
      {data.error ? <ErrorState message={data.error.message} onRetry={() => void data.reload()} /> : !data.data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      ) : (
        <div className="space-y-5" data-testid="balance-sheet">
          {data.data.balances.length === 0 ? <EmptyState icon={<Wallet />} title="No leave types" description="This person's plan gives no leave types today." /> : (
            <div className="grid gap-3">{data.data.balances.map((b, i) => <BalanceCard key={b.leave_type_code} b={b} index={i} />)}</div>
          )}
          {access?.v2_enabled ? <LedgerList employeeId={data.data.employee_id} /> : (
            <Notice tone="info" title="Legacy balances">Balances are the yearly quota plus adjustments minus use; the ledger opens after go-live.</Notice>
          )}
          {data.data && (
            <AdjustBalanceModal open={adjust} onOpenChange={setAdjust} employee={{ id: data.data.employee_id, name: data.data.name }} balances={data.data.balances}
              onDone={() => void data.reload()} />
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ tab */

/** Balances (HR) (09-ui-ux/02 §9.2): search, type filter, per-employee drawer with ledger and Adjust balance. */
export function BalancesTab({ access }: { access: LeaveAccess | undefined }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [on, setOn] = useState("");
  const search = useDebounced(q, 300);
  const types = useLeaveTypes(false);
  const data = useApi(() => leaveAdminApi.balances({ search: search || undefined, leave_type: type || undefined, date: on || undefined }), [search, type, on]);
  const modal = useModalRoute(BALANCE_MODAL, { keys: ["employee"] });
  const employeeId = modal.id && /^\d+$/.test(modal.id) ? Number(modal.id) : null;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Employee",
      primary: true,
      cell: (r) => <span className="min-w-0"><span className="block font-medium">{r.name}</span><span className="block font-mono text-[11px] text-muted-foreground">{r.employee_code}</span></span>,
    },
    {
      key: "balances",
      header: type ? "Balance · pending · available" : "Available by type",
      cell: (r) =>
        type ? (
          r.balances[0] ? (
            <span className="tabular-nums">{fmtUnits(r.balances[0].balance)} · {fmtUnits(r.balances[0].pending)} · <strong className={cn((r.balances[0].available ?? 0) < 0 && "text-danger")}>{r.balances[0].unlimited ? "∞" : fmtUnits(r.balances[0].available)}</strong></span>
          ) : <span className="text-muted-foreground">Not in plan</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {r.balances.map((b) => (
              <span key={b.leave_type_code} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                <LeaveSwatch token={b.color_token} />{b.name}: <strong className={cn("tabular-nums", (b.available ?? 0) < 0 && "text-danger")}>{b.unlimited ? "∞" : fmtUnits(b.available)}</strong>
              </span>
            ))}
            {r.balances.length === 0 && <span className="text-muted-foreground">—</span>}
          </span>
        ),
    },
    { key: "open", header: "", hideInCard: true, cell: () => <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden /> },
  ];

  return (
    <Card className="p-4 sm:p-5" data-testid="balances-tab">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search name or employee code" /></div>
        <Select aria-label="Leave type" className="w-48" value={type} onChange={(e) => setType(e.target.value)} data-testid="balances-type">
          <option value="">All types</option>
          {(types.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </Select>
        <Input aria-label="As of" type="date" className="w-44" value={on} onChange={(e) => setOn(e.target.value)} />
      </div>
      {data.data && !data.data.v2_enabled && (
        <Notice tone="info" title="Legacy balances" className="mb-4">Shown with today's formula (yearly quota, adjustments and use). Adjustments and the ledger open after go-live.</Notice>
      )}
      {data.error && !data.data ? <ErrorState message={data.error.message} onRetry={() => void data.reload()} /> : (
        <DataTable caption="Leave balances" columns={columns} rows={data.data?.employees} loading={data.loading && !data.data} busy={data.loading && !!data.data}
          rowKey={(r) => r.employee_id} onRowClick={(r) => modal.openModal({ employee: r.employee_id })} cardBelowMd
          empty={<EmptyState icon={<Scale />} title="No employees found" description="Try another name or code, or clear the filters." />} />
      )}
      {data.data && data.data.employees.length >= 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 employees; search to narrow down.</p>}
      <EmployeeBalanceSheet employeeId={employeeId} access={access} open={modal.open} onOpenChange={modal.onOpenChange} />
    </Card>
  );
}
