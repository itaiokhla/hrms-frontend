"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, StatusBadge } from "@/components/ui/primitives";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { can, companyWide } from "@/lib/access";
import { fmtDate, fmtHours, fmtMoney, fmtTime, titleCase, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface Report<R, S> {
  period: string;
  total_records: number;
  records: R[];
  summary: S;
}

type AttendanceRow = {
  employee_id: number; employee_name: string; date: string; check_in_time: string | null; check_out_time: string | null; status: string;
  lunch_seconds: number; net_seconds: number | null; hours_complete: boolean; hours_provisional: boolean;
};
type LeaveRow = { employee_id: number; employee_name: string; leave_type: string; start_date: string; end_date: string; days: number; status: string };
type PayrollRow = { employee_id: number; employee_name: string; salary_month: string; gross_salary: number; total_deductions: number; net_salary: number; status: string };
type DeptRow = { department_id: number; department_name: string; total_employees: number; attendance: { present: number; absent: number; late: number }; payroll?: { total_salary: number } };

export default function ReportsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.REPORT_READ)}>
      <Reports />
    </RequireAccess>
  );
}

function ExportButtons({ base, params }: { base: string; params: Record<string, string | number | undefined> }) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const go = async (fmt: "excel" | "pdf") => {
    try {
      await downloadFile(`${base}/export/${fmt}?${query}`, `report.${fmt === "excel" ? "xlsx" : "pdf"}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => go("excel")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
      <Button size="sm" variant="secondary" onClick={() => go("pdf")}><FileText className="h-4 w-4" /> PDF</Button>
    </div>
  );
}

function Reports() {
  const { me } = useCan();
  const tabs = [
    { value: "attendance", label: "Attendance" },
    { value: "leave", label: "Leave" },
    { value: "departments", label: "Departments" },
    ...(companyWide(me, P.PAYROLL_READ) ? [{ value: "payroll", label: "Payroll" }] : []),
  ];
  const [tab, setTab] = useState("attendance");
  return (
    <div>
      <PageHeader title="Reports" description="Every figure is computed only from records within your access. Exports are audited." />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        <TabPanel value="attendance"><AttendanceReport /></TabPanel>
        <TabPanel value="leave"><LeaveReport /></TabPanel>
        <TabPanel value="departments"><DepartmentReport /></TabPanel>
        {companyWide(me, P.PAYROLL_READ) && <TabPanel value="payroll"><PayrollReport /></TabPanel>}
      </Tabs>
    </div>
  );
}

function AttendanceReport() {
  const { me } = useCan();
  const [start, setStart] = useState(`${todayISO().slice(0, 8)}01`); // first of this month, local time
  const [end, setEnd] = useState(todayISO());
  const { data, loading } = useApi(
    () => api.get<Report<AttendanceRow, Record<string, number>>>("/reports/attendance", { params: { start_date: start, end_date: end } }),
    [start, end],
  );
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="From" className="w-44"><Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To" className="w-44"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        <div className="flex-1" />
        {can(me, P.REPORT_EXPORT) && <ExportButtons base="/reports/attendance" params={{ start_date: start, end_date: end }} />}
      </Card>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Present" value={data.summary.total_present} tone="success" />
          <StatCard label="Late" value={data.summary.total_late} tone="warning" delay={0.05} />
          <StatCard label="Half day" value={data.summary.total_half_day} tone="info" delay={0.1} />
          <StatCard label="Absent" value={data.summary.total_absent} tone="danger" delay={0.15} />
          {/* Summed in seconds on the server, so it matches exports and the payroll snapshot exactly. */}
          <StatCard label="Net hours worked" value={Math.floor((data.summary.total_net_seconds ?? 0) / 3600)} tone="primary" delay={0.2}
            hint={`${fmtHours(data.summary.total_net_seconds ?? 0)} · ${data.summary.incomplete_sessions ?? 0} missing punch-out`} />
        </div>
      )}
      <Card>
        <CardHeader title={data?.period ?? "Attendance"} description={`${data?.total_records ?? 0} records`} />
        <DataTable rows={data?.records.slice(0, 300)} loading={loading} rowKey={(r) => `${r.employee_id}-${r.date}-${r.check_in_time}`}
          empty={<EmptyState title="No attendance in this period" />}
          columns={[
            { key: "e", header: "Employee", cell: (r) => <span className="font-medium">{r.employee_name}</span> },
            { key: "d", header: "Date", cell: (r) => fmtDate(r.date) },
            { key: "i", header: "In", cell: (r) => fmtTime(r.check_in_time), hideOnMobile: true },
            { key: "o", header: "Out", cell: (r) => fmtTime(r.check_out_time), hideOnMobile: true },
            { key: "l", header: "Lunch", cell: (r) => fmtHours(r.lunch_seconds), hideOnMobile: true },
            { key: "n", header: "Net", cell: (r) => (r.hours_complete ? `${fmtHours(r.net_seconds)}${r.hours_provisional ? " so far" : ""}` : "—") },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </Card>
    </div>
  );
}

function LeaveReport() {
  const { me } = useCan();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading } = useApi(
    () => api.get<Report<LeaveRow, Record<string, { applied: number; approved: number; rejected: number }>>>("/reports/leaves", { params: { year } }),
    [year],
  );
  const chart = Object.entries(data?.summary ?? {}).map(([type, s]) => ({ type: titleCase(type), ...s }));
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Year" className="w-28"><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        <div className="flex-1" />
        {can(me, P.REPORT_EXPORT) && <ExportButtons base="/reports/leaves" params={{ year }} />}
      </Card>
      {chart.length > 0 && (
        <Card>
          <CardHeader title="Requests by type" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="type" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--surface))" }} />
                <Legend />
                <Bar dataKey="approved" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="rejected" fill="hsl(var(--danger))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="applied" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card>
        <DataTable rows={data?.records} loading={loading} rowKey={(r) => `${r.employee_id}-${r.start_date}-${r.leave_type}`}
          empty={<EmptyState title="No leave this year" />}
          columns={[
            { key: "e", header: "Employee", cell: (r) => <span className="font-medium">{r.employee_name}</span> },
            { key: "t", header: "Type", cell: (r) => titleCase(r.leave_type) },
            { key: "d", header: "Dates", cell: (r) => `${fmtDate(r.start_date, "d MMM")} – ${fmtDate(r.end_date, "d MMM")}`, hideOnMobile: true },
            { key: "n", header: "Days", cell: (r) => r.days },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </Card>
    </div>
  );
}

function DepartmentReport() {
  const { me } = useCan();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | "">(new Date().getMonth() + 1);
  const { data, loading } = useApi(
    () => api.get<{ period: string; analytics: DeptRow[]; payroll_visible: boolean }>("/reports/department-analytics", { params: { year, month: month || undefined } }),
    [year, month],
  );
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Year" className="w-28"><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        <Field label="Month" className="w-40">
          <Select value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Whole year</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>)}
          </Select>
        </Field>
      </Card>
      <Card>
        <CardHeader title={data?.period ?? "Departments"} />
        <DataTable rows={data?.analytics} loading={loading} rowKey={(d) => d.department_id}
          empty={<EmptyState title="No department data in your scope" />}
          columns={[
            { key: "n", header: "Department", cell: (d) => <span className="font-medium">{d.department_name}</span> },
            { key: "h", header: "Headcount", cell: (d) => d.total_employees },
            { key: "p", header: "Present", cell: (d) => d.attendance.present },
            { key: "l", header: "Late", cell: (d) => d.attendance.late, hideOnMobile: true },
            ...(data?.payroll_visible ? [{ key: "pay", header: "Net payroll", cell: (d: DeptRow) => fmtMoney(d.payroll?.total_salary ?? 0, me?.company.currency) }] : []),
          ]} />
      </Card>
    </div>
  );
}

function PayrollReport() {
  const { me } = useCan();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | "">("");
  const currency = me?.company.currency ?? "INR";
  const { data, loading } = useApi(
    () => api.get<Report<PayrollRow, { total_gross: number; total_deductions: number; total_net: number; average_salary: number }>>("/reports/payroll", { params: { year, month: month || undefined } }),
    [year, month],
  );
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Year" className="w-28"><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        <Field label="Month" className="w-40">
          <Select value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Whole year</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>)}
          </Select>
        </Field>
        <div className="flex-1" />
        {can(me, P.PAYROLL_EXPORT) && can(me, P.REPORT_EXPORT) && <ExportButtons base="/reports/payroll" params={{ year, month: month || undefined }} />}
      </Card>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gross" value={data.summary.total_gross} format={(n) => fmtMoney(n, currency)} />
          <StatCard label="Deductions" value={data.summary.total_deductions} format={(n) => fmtMoney(n, currency)} tone="warning" delay={0.05} />
          <StatCard label="Net" value={data.summary.total_net} format={(n) => fmtMoney(n, currency)} tone="success" delay={0.1} />
          <StatCard label="Average net" value={data.summary.average_salary} format={(n) => fmtMoney(n, currency)} tone="info" delay={0.15} />
        </div>
      )}
      <Card>
        <DataTable rows={data?.records} loading={loading} rowKey={(r) => `${r.employee_id}-${r.salary_month}`}
          empty={<EmptyState icon={<Download />} title="No payroll in this period" />}
          columns={[
            { key: "e", header: "Employee", cell: (r) => <span className="font-medium">{r.employee_name}</span> },
            { key: "m", header: "Month", cell: (r) => fmtDate(r.salary_month, "MMM yyyy") },
            { key: "g", header: "Gross", cell: (r) => fmtMoney(r.gross_salary, currency), hideOnMobile: true },
            { key: "n", header: "Net", cell: (r) => fmtMoney(r.net_salary, currency) },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </Card>
    </div>
  );
}
