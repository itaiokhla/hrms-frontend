"use client";

import { BadgeIndianRupee, CheckCircle2, FileText, Play, Plus, Sparkles, Users, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { PayslipView } from "@/components/shared/PayslipView";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, Pagination, PageHeader, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Avatar, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, companyWide } from "@/lib/access";
import { fmtDate, fmtMoney, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Page, PayrollRecord, PayrollSummary, Payslip, SalaryStructure } from "@/lib/types";

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString("en", { month: "long" }));

export default function PayrollPage() {
  return (
    <RequireAccess check={(me) => companyWide(me, P.PAYROLL_READ) || can(me, P.PAYROLL_PREPARE) || companyWide(me, P.COMPENSATION_MANAGE)}>
      <Suspense>
        <Payroll />
      </Suspense>
    </RequireAccess>
  );
}

function Payroll() {
  const params = useSearchParams();
  const { me } = useCan();
  const tabs = [
    ...(companyWide(me, P.PAYROLL_READ) ? [{ value: "runs", label: "Payroll runs" }] : []),
    ...(companyWide(me, P.COMPENSATION_READ) ? [{ value: "structures", label: "Salary structures" }] : []),
  ];
  const [tab, setTab] = useState(params.get("tab") ?? tabs[0]?.value ?? "runs");
  return (
    <div>
      <PageHeader title="Payroll" description="Preparation, approval and payment are separate steps; the preparer of a run can't approve it." />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        <TabPanel value="runs"><Runs /></TabPanel>
        <TabPanel value="structures"><Structures /></TabPanel>
      </Tabs>
    </div>
  );
}

function Runs() {
  const { me } = useCan();
  const confirm = useConfirm();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const currency = me?.company.currency ?? "INR";

  const { data: summary, reload: reloadSummary } = useApi(() => api.get<PayrollSummary>(`/payroll/summary/${year}/${month}`), [year, month]);
  const { data, loading, reload } = useApi(
    () => api.get<Page<PayrollRecord>>("/payroll", { params: { year, month, status: status || undefined, skip, limit: 50 } }),
    [year, month, status, skip],
  );
  const refresh = () => { void reload(); void reloadSummary(); };

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const generateMonth = async () => {
    if (!(await confirm({ title: `Generate payroll for ${MONTHS[month - 1]} ${year}?`, message: "Drafts are created for every active employee with a salary structure. Existing drafts are kept.", confirmLabel: "Generate" }))) return;
    setBusy("generate");
    try {
      const r = await api.post<{ summary: { generated: number; failed: number; already_exists: number } }>(`/payroll/generate-month?year=${year}&month=${month}`);
      toast.success(`${r.summary.generated} generated · ${r.summary.already_exists} existing · ${r.summary.failed} need a salary structure`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openSlip = async (id: number) => {
    try {
      setSlip(await api.get<Payslip>(`/payroll/${id}/slip`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Month" className="sm:w-44">
          <Select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSkip(0); }}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Year" className="sm:w-28">
          <Input type="number" value={year} min={2000} max={2100} onChange={(e) => { setYear(Number(e.target.value)); setSkip(0); }} />
        </Field>
        <Field label="Status" className="sm:w-40">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
            <option value="">All</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="processed">Processed</option>
          </Select>
        </Field>
        <div className="flex-1" />
        {can(me, P.PAYROLL_PREPARE) && <Button loading={busy === "generate"} onClick={generateMonth}><Sparkles className="h-4 w-4" /> Generate month</Button>}
        {can(me, P.PAYROLL_PROCESS) && (
          <Button variant="secondary" loading={busy === "bulk"}
            onClick={() => run("bulk", () => api.post(`/payroll/process-bulk?year=${year}&month=${month}`), "Approved payroll marked as paid")}>
            <Play className="h-4 w-4" /> Pay approved
          </Button>
        )}
      </Card>

      {!summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Employees paid" value={summary.total_employees} icon={<Users />} />
          <StatCard label="Gross" value={summary.total_gross_salary} format={(n) => fmtMoney(n, currency)} icon={<BadgeIndianRupee />} tone="info" delay={0.05} />
          <StatCard label="Deductions" value={summary.total_deductions} format={(n) => fmtMoney(n, currency)} icon={<FileText />} tone="warning" delay={0.1} />
          <StatCard label="Net payout" value={summary.total_net_salary} format={(n) => fmtMoney(n, currency)} icon={<Wallet />} tone="success" delay={0.15} />
        </div>
      )}

      <Card>
        <DataTable rows={data?.items} loading={loading} rowKey={(p) => p.id}
          empty={<EmptyState icon={<BadgeIndianRupee />} title="No payroll for this month" description="Generate drafts once salary structures are in place." />}
          columns={[
            { key: "emp", header: "Employee", cell: (p) => <div className="flex items-center gap-2.5"><Avatar name={p.employee_name} size={30} /><div><p className="font-medium">{p.employee_name}</p><p className="font-mono text-xs text-muted-foreground">{p.employee_code}</p></div></div> },
            { key: "gross", header: "Gross", cell: (p) => fmtMoney(p.gross_salary, currency), hideOnMobile: true },
            { key: "ded", header: "Deductions", cell: (p) => fmtMoney(p.total_deductions, currency), hideOnMobile: true },
            { key: "net", header: "Net", cell: (p) => <span className="font-semibold">{fmtMoney(p.net_salary, currency)}</span> },
            { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { key: "actions", header: "", className: "text-right", cell: (p) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => openSlip(p.id)}>Slip</Button>
                {p.status === "draft" && can(me, P.PAYROLL_APPROVE) && (
                  <Button size="sm" variant="subtle" loading={busy === `a${p.id}`} disabled={p.created_by_user_id === me?.user.id}
                    title={p.created_by_user_id === me?.user.id ? "You prepared this run, so someone else must approve it" : undefined}
                    onClick={() => run(`a${p.id}`, () => api.post(`/payroll/${p.id}/approve`), "Payroll approved")}>
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                )}
                {p.status === "approved" && can(me, P.PAYROLL_PROCESS) && (
                  <Button size="sm" variant="success" loading={busy === `p${p.id}`}
                    onClick={() => run(`p${p.id}`, () => api.post(`/payroll/${p.id}/process`), "Marked as paid")}>Pay</Button>
                )}
              </div>
            ) },
          ]} />
        {data && <Pagination total={data.total} skip={skip} limit={50} onChange={setSkip} />}
      </Card>

      <Modal open={!!slip} onOpenChange={(o) => !o && setSlip(null)} title="Payslip" size="lg">
        {slip && <PayslipView slip={slip} currency={currency} companyName={me?.company.name} />}
      </Modal>
    </div>
  );
}

function Structures() {
  const { me } = useCan();
  const currency = me?.company.currency ?? "INR";
  const { data, loading, reload } = useApi(() => api.get<SalaryStructure[]>("/salary-structures"), []);
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [form, setForm] = useState({ basic_salary: "", house_rent_allowance: "0", dearness_allowance: "0", conveyance_allowance: "0", other_allowances: "0", effective_from: todayISO() });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      await api.post("/salary-structures", { employee_id: employee.id, ...form });
      toast.success("Salary structure saved. The previous one now ends the day before.");
      setOpen(false);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm text-muted-foreground">Revisions never overwrite history: a new structure closes the previous one.</p>
        {can(me, P.COMPENSATION_MANAGE) && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New revision</Button>}
      </div>
      <DataTable rows={data} loading={loading} rowKey={(s) => s.id}
        empty={<EmptyState title="No salary structures yet" description="Add one per employee before generating payroll." />}
        columns={[
          { key: "emp", header: "Employee", cell: (s) => <span className="font-medium">{s.employee_name}</span> },
          { key: "basic", header: "Basic", cell: (s) => fmtMoney(s.basic_salary, currency), hideOnMobile: true },
          { key: "gross", header: "Gross", cell: (s) => <span className="font-semibold">{fmtMoney(s.gross, currency)}</span> },
          { key: "from", header: "Effective", cell: (s) => `${fmtDate(s.effective_from)} → ${s.effective_to ? fmtDate(s.effective_to) : "current"}` },
        ]} />
      <Modal open={open} onOpenChange={setOpen} title="New salary revision" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} disabled={!employee || !form.basic_salary} onClick={save}>Save revision</Button></>}>
        <div className="space-y-4">
          <Field label="Employee" required><EmployeePicker value={employee} onChange={setEmployee} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ["basic_salary", "Basic salary"], ["house_rent_allowance", "House rent allowance"], ["dearness_allowance", "Dearness allowance"],
              ["conveyance_allowance", "Conveyance"], ["other_allowances", "Other allowances"],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input type="number" min={0} step="0.01" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
            <Field label="Effective from"><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
