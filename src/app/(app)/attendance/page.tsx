"use client";

import { Clock3, Coffee, PenLine, Timer, UserCheck, Users, UserX } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { LocationReviewPanel } from "@/components/attendance/LocationReviewPanel";
import { MyAttendanceCard } from "@/components/attendance/MyAttendanceCard";
import { SessionDrawer } from "@/components/attendance/SessionDrawer";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canAny, canBeyondSelf } from "@/lib/access";
import { fmtDate, fmtHours, fmtTime, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { AttendanceRecord, MyAttendance, Page, TodaySummary } from "@/lib/types";

export default function AttendancePage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_MARK, P.ATTENDANCE_READ])}>
      <Attendance />
    </RequireAccess>
  );
}

function Attendance() {
  const { me } = useCan();
  const mine = can(me, P.ATTENDANCE_MARK) && !!me?.employee;
  const team = canBeyondSelf(me, P.ATTENDANCE_READ);
  const [tab, setTab] = useState(mine ? "me" : "team");
  const tabs = [...(mine ? [{ value: "me", label: "My attendance" }] : []), ...(team ? [{ value: "team", label: "Team" }] : [])];
  return (
    <div>
      <PageHeader title="Attendance" description="Punch in and out, take lunch, and follow your team's day in real time." />
      {tabs.length > 1 ? (
        <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
          <TabPanel value="me"><MyAttendance /></TabPanel>
          <TabPanel value="team"><TeamAttendance /></TabPanel>
        </Tabs>
      ) : mine ? <MyAttendance /> : <TeamAttendance />}
    </div>
  );
}

/** Shift state shown in tables: working, on lunch, done, or closed without a punch-out. */
function StateBadge({ record }: { record: AttendanceRecord }) {
  if (record.attendance_state === "WORKING") return <StatusBadge status="working" />;
  if (record.attendance_state === "ON_LUNCH") return <StatusBadge status="on_lunch" label="On lunch" />;
  if (record.closed_reason) return <StatusBadge status="incomplete" label="No punch-out" />;
  return <span className="tabular-nums">{fmtTime(record.check_out_time)}</span>;
}

function NetHours({ record }: { record: AttendanceRecord }) {
  const h = record.hours;
  if (!h.complete) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{fmtHours(h.net_seconds)}{h.provisional && <span className="ml-1 text-[10px] text-muted-foreground">so far</span>}</span>;
}

/* ------------------------------------------------------------- Self service */
function MyAttendance() {
  const { me } = useCan();
  const { data: today, setData, reload } = useApi(() => api.get<MyAttendance>("/attendance/me/today"), []);
  const { data: history, reload: reloadHistory } = useApi(() => api.get<Page<AttendanceRecord>>("/attendance/me/history"), []);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <MyAttendanceCard data={today} onChange={(next) => { setData(next); void reloadHistory(); }} onReload={() => { void reload(); void reloadHistory(); }} />
      <Card>
        <CardHeader title="Last 30 days" description="Net time excludes unpaid lunch." />
        <DataTable
          rows={history?.items}
          loading={!history}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState icon={<Clock3 />} title="No attendance yet" />}
          columns={[
            { key: "date", header: "Date", cell: (r) => fmtDate(r.date, "EEE, d MMM") },
            { key: "in", header: "In", cell: (r) => fmtTime(r.check_in_time) },
            { key: "out", header: "Out", cell: (r) => <StateBadge record={r} /> },
            { key: "lunch", header: "Lunch", cell: (r) => fmtHours(r.hours.lunch_seconds), hideOnMobile: true },
            { key: "net", header: "Worked", cell: (r) => <NetHours record={r} /> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <SessionDrawer attendanceId={open} canLocate={can(me, P.LOCATION_READ)} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------- Team */
function TeamAttendance() {
  const { me } = useCan();
  const { data: summary, reload } = useApi(() => api.get<TodaySummary>("/attendance/summary/today"), []);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const { data: records, loading, reload: reloadRecords } = useApi(
    () => api.get<Page<AttendanceRecord>>("/attendance", { params: { start_date: start, end_date: end, limit: 200 } }),
    [start, end],
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      {!summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="In scope" value={summary.total_employees} icon={<Users />} />
          <StatCard label="Present" value={summary.present_today} icon={<UserCheck />} tone="success" hint={`${summary.attendance_percentage}%`} delay={0.05} />
          <StatCard label="Working now" value={summary.working_now} icon={<Timer />} tone="info" delay={0.1} />
          <StatCard label="On lunch" value={summary.on_lunch_now} icon={<Coffee />} tone="accent" delay={0.15} />
          <StatCard label="Not checked in" value={summary.absent_today} icon={<UserX />} tone="warning" hint={`${summary.on_leave} on leave`} delay={0.2} />
        </div>
      )}
      {can(me, P.LOCATION_REVIEW) && <LocationReviewPanel onOpenSession={setOpen} />}
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end">
          <Field label="From" className="sm:w-44"><Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="To" className="sm:w-44"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          <div className="flex-1" />
          {can(me, P.ATTENDANCE_REGULARIZE) && (
            <Button variant="secondary" onClick={() => setManualOpen(true)}><PenLine className="h-4 w-4" /> Record manually</Button>
          )}
        </div>
        <DataTable
          rows={records?.items}
          loading={loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState icon={<Clock3 />} title="No attendance in this range" />}
          columns={[
            { key: "emp", header: "Employee", cell: (r) => (
              <div className="flex items-center gap-2.5"><Avatar name={r.employee_name} size={30} /><span className="font-medium">{r.employee_name}</span></div>
            ) },
            { key: "date", header: "Date", cell: (r) => fmtDate(r.date, "d MMM"), hideOnMobile: true },
            { key: "in", header: "In", cell: (r) => fmtTime(r.check_in_time) },
            { key: "out", header: "Out", cell: (r) => <StateBadge record={r} /> },
            { key: "lunch", header: "Lunch", cell: (r) => fmtHours(r.hours.lunch_seconds), hideOnMobile: true },
            { key: "net", header: "Net", cell: (r) => <NetHours record={r} /> },
            { key: "loc", header: "Location", hideOnMobile: true, cell: (r) => <LocationCell record={r} /> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <ManualEntry open={manualOpen} onOpenChange={setManualOpen} onSaved={() => { void reload(); void reloadRecords(); }} />
      <SessionDrawer attendanceId={open} canLocate={can(me, P.LOCATION_READ)} onClose={() => setOpen(null)} />
    </div>
  );
}

function LocationCell({ record }: { record: AttendanceRecord }) {
  const loc = record.location;
  if (!loc || loc.captured + loc.failed + loc.missed === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone="success">{loc.captured} ✓</Badge>
      {loc.missed > 0 && <Badge tone="warning">{loc.missed} missed</Badge>}
      {loc.failed > 0 && <Badge tone="warning">{loc.failed} failed</Badge>}
      {loc.review_pending > 0 && <Badge tone="danger">{loc.review_pending} to review</Badge>}
    </div>
  );
}

function ManualEntry({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { me } = useCan();
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [date, setDate] = useState(todayISO());
  const [checkIn, setCheckIn] = useState("09:00");
  const [checkOut, setCheckOut] = useState("18:00");
  const [lunchStart, setLunchStart] = useState("");
  const [lunchEnd, setLunchEnd] = useState("");
  const [status, setStatus] = useState("present");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();
      await api.post("/attendance/manual", {
        employee_id: employee.id, date, check_in_time: iso(checkIn), check_out_time: checkOut ? iso(checkOut) : null, status, notes: notes || null,
        // Only sent when filled in; otherwise the existing breaks are kept (and checked against the new times).
        ...(lunchStart && lunchEnd ? { breaks: [{ started_at: iso(lunchStart), ended_at: iso(lunchEnd) }] } : {}),
      });
      toast.success("Attendance recorded");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Record attendance" description="Corrections are logged in the audit trail with your name; the original punches are kept."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={!employee} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Employee" required>
          {/* Nobody can correct their own attendance, so they aren't offered. */}
          <EmployeePicker value={employee} onChange={setEmployee} excludeIds={me?.employee ? [me.employee.id] : []} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Check in"><Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Field>
          <Field label="Check out"><Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lunch start" hint="Optional: replaces the recorded lunch"><Input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} /></Field>
          <Field label="Lunch end"><Input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} /></Field>
        </div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="present">Present</option><option value="late">Late</option>
            <option value="half-day">Half day</option><option value="absent">Absent</option>
          </Select>
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for the correction" /></Field>
      </div>
    </Modal>
  );
}
