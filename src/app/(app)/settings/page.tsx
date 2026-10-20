"use client";

import { Building2, Clock3, Palette, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { PolicySettings } from "@/components/attendance/PolicySettings";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { DataTable, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Department, Shift } from "@/lib/types";
import { useSession } from "@/store/session";

type Settings = Record<string, string | number | boolean>;

export default function SettingsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.SETTINGS_MANAGE)}>
      <CompanySettings />
    </RequireAccess>
  );
}

function CompanySettings() {
  const { me } = useCan();
  const [tab, setTab] = useState("company");
  const tabs = [
    { value: "company", label: "Company" },
    { value: "policies", label: "Policies" },
    { value: "attendance", label: "Attendance & location" },
    ...(can(me, P.DEPARTMENT_MANAGE) ? [{ value: "structure", label: "Departments & shifts" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Company settings" description="These settings apply only to your company's workspace." />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        <TabPanel value="company"><General /></TabPanel>
        <TabPanel value="policies"><Policies /></TabPanel>
        <TabPanel value="attendance"><PolicySettings /></TabPanel>
        {can(me, P.DEPARTMENT_MANAGE) && <TabPanel value="structure"><Structure /></TabPanel>}
      </Tabs>
    </div>
  );
}

function useSettings() {
  const { data, reload, setData } = useApi(() => api.get<Settings>("/settings"), []);
  const [saving, setSaving] = useState(false);
  const loadSession = useSession((s) => s.load);
  const save = async (patch: Settings) => {
    setSaving(true);
    try {
      setData(await api.put<Settings>("/settings", patch));
      toast.success("Settings saved");
      void loadSession({ silent: true });
    } catch (e) {
      toast.error(errorMessage(e));
      void reload();
    } finally {
      setSaving(false);
    }
  };
  return { data, setData, save, saving };
}

function General() {
  const { data, setData, save, saving } = useSettings();
  if (!data) return <Skeleton className="h-72 rounded-2xl" />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setData({ ...data, [k]: e.target.value });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Company profile" action={<Button size="sm" loading={saving} onClick={() => save({
          companyName: data.companyName, companyEmail: data.companyEmail, companyPhone: data.companyPhone,
          companyAddress: data.companyAddress, timezone: data.timezone, currency: data.currency,
        })}>Save</Button>} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Company name"><Input value={String(data.companyName)} onChange={set("companyName")} /></Field>
          <Field label="Contact email"><Input type="email" value={String(data.companyEmail)} onChange={set("companyEmail")} /></Field>
          <Field label="Phone"><Input value={String(data.companyPhone)} onChange={set("companyPhone")} /></Field>
          <Field label="Address"><Input value={String(data.companyAddress)} onChange={set("companyAddress")} /></Field>
          <Field label="Timezone" hint="Used for 'today' in attendance and leave"><Input value={String(data.timezone)} onChange={set("timezone")} /></Field>
          <Field label="Currency" hint="3-letter code, e.g. INR"><Input maxLength={3} value={String(data.currency)} onChange={set("currency")} /></Field>
        </div>
      </Card>
      <Card className="p-5">
        <p className="font-semibold">Branding</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Logos, colours, the sign-in page, emails, payslip branding and your company&apos;s web address.
        </p>
        <div className="mt-4 flex h-24 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/v1/settings/logo" alt="Company logo" className="max-h-full max-w-full object-contain"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <Link href="/settings/branding" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium shadow-sm hover:bg-surface-muted">
          <Palette className="h-4 w-4" /> Open Branding &amp; domains
        </Link>
      </Card>
    </div>
  );
}

function Policies() {
  const { me } = useCan();
  const { data, setData, save, saving } = useSettings();
  if (!data) return <Skeleton className="h-72 rounded-2xl" />;
  const toggle = (key: string, label: string, hint: string, adminOnly = false) => (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}{adminOnly && !me?.is_company_admin ? " · Company Administrators only" : ""}</span>
      </span>
      <Switch checked={!!data[key]} disabled={adminOnly && !me?.is_company_admin} onChange={(v) => setData({ ...data, [key]: v })} label={label} />
    </label>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> Attendance</span>}
          action={<Button size="sm" loading={saving} onClick={() => save({ graceTime: Number(data.graceTime), requireFaceForSelfCheckIn: data.requireFaceForSelfCheckIn, autoAttendance: data.autoAttendance })}>Save</Button>} />
        <div className="space-y-3 p-5">
          <Field label="Late grace period (minutes)" hint="Check-ins after shift start plus this grace are marked late.">
            <Input type="number" min={0} max={240} value={Number(data.graceTime)} onChange={(e) => setData({ ...data, graceTime: Number(e.target.value) })} />
          </Field>
          {toggle("requireFaceForSelfCheckIn", "Require face verification", "Self check-in must match the employee's enrolled face.", true)}
          {toggle("autoAttendance", "Kiosk auto-scan", "The face kiosk scans continuously while active.")}
        </div>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Payroll</span>}
          action={<Button size="sm" loading={saving} onClick={() => save({ payrollSeparationOfDuties: data.payrollSeparationOfDuties })}>Save</Button>} />
        <div className="space-y-3 p-5">
          {toggle("payrollSeparationOfDuties", "Separation of duties", "Payroll must be approved by someone other than its preparer.", true)}
          <p className="text-xs text-muted-foreground">Nobody can approve or process their own pay, regardless of this setting.</p>
        </div>
      </Card>
    </div>
  );
}

function Structure() {
  const { data: departments, reload } = useApi(() => api.get<Department[]>("/departments"), []);
  const { data: shifts, reload: reloadShifts } = useApi(() => api.get<Shift[]>("/shifts"), []);
  const [dept, setDept] = useState<Partial<Department> | null>(null);
  const [head, setHead] = useState<PickedEmployee | null>(null);
  const [shift, setShift] = useState<Partial<Shift> | null>(null);

  useEffect(() => {
    setHead(dept?.head_employee_id ? { id: dept.head_employee_id, full_name: dept.head_name ?? "" } : null);
  }, [dept]);

  const saveDept = async () => {
    if (!dept) return;
    try {
      const body = { name: dept.name, description: dept.description || null, head_employee_id: head?.id ?? null,
        parent_department_id: dept.parent_department_id ?? null, is_active: dept.is_active ?? true };
      if (dept.id) await api.put(`/departments/${dept.id}`, body);
      else await api.post("/departments", body);
      toast.success("Department saved");
      setDept(null);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const saveShift = async () => {
    if (!shift) return;
    try {
      const body = { name: shift.name, start_time: shift.start_time, end_time: shift.end_time, duration_hours: shift.duration_hours || null,
        is_flexible: !!shift.is_flexible, is_active: shift.is_active ?? true };
      if (shift.id) await api.put(`/shifts/${shift.id}`, body);
      else await api.post("/shifts", body);
      toast.success("Shift saved");
      setShift(null);
      void reloadShifts();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Departments" description="Department heads can be approvers and get department-scoped access."
          action={<Button size="sm" onClick={() => setDept({ is_active: true })}><Plus className="h-4 w-4" /> Add</Button>} />
        <DataTable rows={departments} loading={!departments} rowKey={(d) => d.id} onRowClick={(d) => setDept(d)}
          columns={[
            { key: "n", header: "Department", cell: (d) => <span className="font-medium">{d.name}</span> },
            { key: "h", header: "Head", cell: (d) => d.head_name ?? "—" },
            { key: "p", header: "Part of", hideOnMobile: true, cell: (d) => departments?.find((x) => x.id === d.parent_department_id)?.name ?? "—" },
            { key: "c", header: "People", cell: (d) => d.employee_count },
            { key: "s", header: "Status", cell: (d) => <StatusBadge status={d.is_active ? "active" : "deactivated"} label={d.is_active ? "Active" : "Inactive"} /> },
          ]} />
      </Card>
      <Card>
        <CardHeader title="Shifts" description="Used for late detection and payroll."
          action={<Button size="sm" onClick={() => setShift({ start_time: "09:00", end_time: "18:00", is_active: true })}><Plus className="h-4 w-4" /> Add</Button>} />
        <DataTable rows={shifts} loading={!shifts} rowKey={(s) => s.id} onRowClick={(s) => setShift(s)}
          columns={[
            { key: "n", header: "Shift", cell: (s) => <span className="font-medium">{s.name}</span> },
            { key: "t", header: "Hours", cell: (s) => `${s.start_time} – ${s.end_time}` },
            { key: "f", header: "Flexible", cell: (s) => (s.is_flexible ? "Yes" : "No") },
          ]} />
      </Card>
      <Modal open={!!dept} onOpenChange={(o) => !o && setDept(null)} title={dept?.id ? "Edit department" : "New department"}
        footer={<><Button variant="secondary" onClick={() => setDept(null)}>Cancel</Button><Button onClick={saveDept}>Save</Button></>}>
        {dept && (
          <div className="space-y-4">
            <Field label="Name" required><Input value={dept.name ?? ""} onChange={(e) => setDept({ ...dept, name: e.target.value })} /></Field>
            <Field label="Description"><Input value={dept.description ?? ""} onChange={(e) => setDept({ ...dept, description: e.target.value })} /></Field>
            <Field label="Department head"><EmployeePicker value={head} onChange={setHead} /></Field>
            <Field label="Part of (makes this a team)" hint="A department cannot sit under itself or one of its own teams.">
              <Select value={dept.parent_department_id ?? ""} onChange={(e) => setDept({ ...dept, parent_department_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Top level</option>
                {(departments ?? []).filter((d) => d.id !== dept.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">Active
              <Switch checked={dept.is_active ?? true} onChange={(v) => setDept({ ...dept, is_active: v })} label="Active" /></label>
          </div>
        )}
      </Modal>
      <Modal open={!!shift} onOpenChange={(o) => !o && setShift(null)} title={shift?.id ? "Edit shift" : "New shift"}
        footer={<><Button variant="secondary" onClick={() => setShift(null)}>Cancel</Button><Button onClick={saveShift}>Save</Button></>}>
        {shift && (
          <div className="space-y-4">
            <Field label="Name" required><Input value={shift.name ?? ""} onChange={(e) => setShift({ ...shift, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts"><Input type="time" value={shift.start_time ?? ""} onChange={(e) => setShift({ ...shift, start_time: e.target.value })} /></Field>
              <Field label="Ends"><Input type="time" value={shift.end_time ?? ""} onChange={(e) => setShift({ ...shift, end_time: e.target.value })} /></Field>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">Flexible hours (never marked late)
              <Switch checked={!!shift.is_flexible} onChange={(v) => setShift({ ...shift, is_flexible: v })} label="Flexible" /></label>
          </div>
        )}
      </Modal>
    </div>
  );
}
