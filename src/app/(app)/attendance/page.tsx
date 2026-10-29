"use client";

import { Clock3, Coffee, PenLine, Timer, Trash2, UserCheck, Users, UserX } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { LiveBoard } from "@/components/attendance/live/LiveBoard";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { LocationReviewPanel } from "@/components/attendance/LocationReviewPanel";
import { MyAttendanceCard } from "@/components/attendance/MyAttendanceCard";
import { MyDayEvaluation } from "@/components/attendance/days/MyDayEvaluation";
import { MyRequests } from "@/components/attendance/requests/MyRequests";
import { RegularizeModal, type RegularizeInitial } from "@/components/attendance/requests/RegularizeModal";
import { TeamBoard } from "@/components/attendance/team/TeamBoard";
import { teamApi } from "@/lib/teamAttendance";
import { SessionDrawer } from "@/components/attendance/SessionDrawer";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canAny, canBeyondSelf } from "@/lib/access";
import { fmtDate, fmtHours, fmtTime, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { AttendanceRecord, MyAttendance, Page, TodaySummary } from "@/lib/types";

const PAGE_SIZES = [25, 50];

export default function AttendancePage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_MARK, P.ATTENDANCE_READ])}>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Attendance />
      </Suspense>
    </RequireAccess>
  );
}

function Attendance() {
  const { me } = useCan();
  const mine = can(me, P.ATTENDANCE_MARK) && !!me?.employee;
  const team = canBeyondSelf(me, P.ATTENDANCE_READ);
  // AS-M9 (G-20): the live board is a v2 view for readers beyond SELF (`/attendance?tab=live`).
  const live = team && !!me?.attendance?.v2;
  const tabs = [...(mine ? [{ value: "me", label: "My attendance" }] : []), ...(team ? [{ value: "team", label: "Team" }] : []),
    ...(live ? [{ value: "live", label: "Live" }] : [])];
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("tab");
  const [tab, setTabState] = useState(tabs.some((t) => t.value === requested) ? (requested as string) : mine ? "me" : "team");
  const setTab = (value: string) => {
    setTabState(value);
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    router.replace(`/attendance?${next.toString()}`, { scroll: false });
  };
  return (
    <div>
      <PageHeader title="Attendance" description="Punch in and out, take lunch, and follow your team's day in real time." />
      {tabs.length > 1 ? (
        <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
          <TabPanel value="me"><MyAttendance /></TabPanel>
          <TabPanel value="team"><TeamAttendance /></TabPanel>
          {live && <TabPanel value="live"><LiveBoard /></TabPanel>}
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
  // AS-M4 (V2 gate): self-service correction requests from the history table and the session drawer.
  const requests = !!me?.attendance?.v2 && can(me, P.ATTENDANCE_REQUEST);
  const [regularize, setRegularize] = useState<RegularizeInitial | null>(null);
  const [requestsKey, setRequestsKey] = useState(0);
  const openCorrection = (date: string, sessionId: number | null, missingOut: boolean) => {
    setOpen(null);
    setRegularize({ date, sessionId, kind: missingOut ? "MISSED_PUNCH" : "CORRECTION", direction: "OUT" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <MyDayEvaluation refreshKey={today} />
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
            ...(requests ? [{ key: "fix", header: "", cell: (r: AttendanceRecord) => (
              <Button size="sm" variant="ghost" data-testid={`history-fix-${r.date}`}
                onClick={(e) => { e.stopPropagation(); openCorrection(r.date, r.id, !r.check_out_time); }}>
                <PenLine className="h-3.5 w-3.5" /> Fix
              </Button>
            ) }] : []),
          ]}
        />
      </Card>
      {requests && <MyRequests refreshKey={requestsKey} onNew={() => setRegularize({ kind: "MISSED_PUNCH", direction: "OUT" })} />}
      <SessionDrawer attendanceId={open} canLocate={can(me, P.LOCATION_READ)} onClose={() => setOpen(null)}
        onRequestCorrection={requests ? openCorrection : undefined} />
      {requests && (
        <RegularizeModal open={regularize !== null} onOpenChange={(o) => !o && setRegularize(null)} initial={regularize ?? undefined}
          onSaved={() => { setRequestsKey((k) => k + 1); void reloadHistory(); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Team */
function TeamAttendance() {
  const { me } = useCan();
  const { data: summary, reload } = useApi(() => api.get<TodaySummary>("/attendance/summary/today"), []);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  // Server-side pages with a total (BUG-AS-11); an inverted range is the server's INVALID_RANGE (BUG-AS-18).
  const [limit, setLimit] = useState(PAGE_SIZES[0]);
  const [skip, setSkip] = useState(0);
  const { data: records, loading, error, reload: reloadRecords } = useApi(
    () => api.get<Page<AttendanceRecord>>("/attendance", { params: { start_date: start, end_date: end, skip, limit } }),
    [start, end, skip, limit],
  );
  const setRange = (from: string, to: string) => {
    setStart(from);
    setEnd(to);
    setSkip(0);
  };
  const [manualOpen, setManualOpen] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  // AS-M4: on v2 tenants HR corrections go through requests (DIRECT, with a reason) or on behalf (approval).
  const v2Modes = [
    ...(can(me, P.ATTENDANCE_REGULARIZE) ? ["DIRECT" as const] : []),
    ...(can(me, P.ATTENDANCE_REQUEST_ON_BEHALF) ? ["ON_BEHALF" as const] : []),
  ];
  const [correcting, setCorrecting] = useState(false);
  // Team management (IG-AS-98..100): edit (v2 direct correction / v1 manual entry) and delete (void) team sessions.
  const canEdit = can(me, P.ATTENDANCE_REGULARIZE);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);

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
      {(can(me, P.ATTENDANCE_PROXY_PUNCH) || canBeyondSelf(me, P.ATTENDANCE_READ)) && (
        <TeamBoard onChanged={() => { void reload(); void reloadRecords(); }} />
      )}
      {can(me, P.LOCATION_REVIEW) && <LocationReviewPanel onOpenSession={setOpen} />}
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end">
          <Field label="From" className="sm:w-44"><Input type="date" value={start} onChange={(e) => setRange(e.target.value, end)} /></Field>
          <Field label="To" className="sm:w-44"><Input type="date" value={end} onChange={(e) => setRange(start, e.target.value)} /></Field>
          <div className="flex-1" />
          {me?.attendance?.v2 && v2Modes.length > 0 && (
            <Button variant="subtle" data-testid="team-correct" onClick={() => setCorrecting(true)}><PenLine className="h-4 w-4" /> Correct attendance</Button>
          )}
          {can(me, P.ATTENDANCE_REGULARIZE) && (
            <Button variant="secondary" onClick={() => setManualOpen(true)}><PenLine className="h-4 w-4" /> Record manually</Button>
          )}
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void reloadRecords()} />
        ) : (
        <>
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
            ...(canEdit ? [{ key: "actions", header: "", cell: (r: AttendanceRecord) => (
              <span className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label={`Edit attendance of ${r.employee_name}`} data-testid={`row-edit-${r.id}`}
                  onClick={(e) => { e.stopPropagation(); setEditing(r); }}><PenLine className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger-ghost" aria-label={`Delete attendance of ${r.employee_name}`} data-testid={`row-delete-${r.id}`}
                  onClick={(e) => { e.stopPropagation(); setDeleting(r); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </span>
            ) }] : []),
          ]}
        />
        {records && (
          <Pagination total={records.total} skip={skip} limit={limit} onChange={setSkip} pageSizes={PAGE_SIZES}
            onLimitChange={(n) => { setLimit(n); setSkip(0); }} />
        )}
        </>
        )}
      </Card>
      <ManualEntry open={manualOpen} onOpenChange={setManualOpen} onSaved={() => { void reload(); void reloadRecords(); }} />
      {!me?.attendance?.v2 && (
        <ManualEntry key={editing?.id ?? "none"} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} initial={editing}
          onSaved={() => { setEditing(null); void reload(); void reloadRecords(); }} />
      )}
      {me?.attendance?.v2 && canEdit && (
        <RegularizeModal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} allowedModes={["DIRECT"]}
          initial={editing ? { mode: "DIRECT", kind: editing.check_out_time ? "CORRECTION" : "MISSED_PUNCH", direction: "OUT",
            date: editing.date, sessionId: editing.id, employee: { id: editing.employee_id, full_name: editing.employee_name ?? "" } } : undefined}
          onSaved={() => { setEditing(null); void reload(); void reloadRecords(); }} />
      )}
      <DeleteSessionModal record={deleting} onClose={() => setDeleting(null)}
        onDone={() => { setDeleting(null); void reload(); void reloadRecords(); }} />
      {v2Modes.length > 0 && (
        <RegularizeModal open={correcting} onOpenChange={setCorrecting} allowedModes={v2Modes}
          initial={{ mode: v2Modes[0], kind: "MISSED_PUNCH", direction: "OUT" }}
          onSaved={() => { void reload(); void reloadRecords(); }} />
      )}
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

function hhmm(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Delete (void) a team session (IG-AS-100): kept for audit, excluded everywhere else. */
function DeleteSessionModal({ record, onClose, onDone }: { record: AttendanceRecord | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!record) return;
    setSaving(true);
    try {
      await teamApi.void(record.id, reason.trim());
      toast.success("Attendance deleted");
      setReason("");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const when = record
    ? `${record.employee_name}, ${fmtDate(record.date, "EEE d MMM")}: ${fmtTime(record.check_in_time)} – ${record.check_out_time ? fmtTime(record.check_out_time) : "running"}. The original punches are kept for audit.`
    : undefined;
  return (
    <Modal open={record !== null} onOpenChange={(o) => !o && onClose()} title="Delete attendance" description={when}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" data-testid="delete-confirm" loading={saving} disabled={reason.trim().length < 5} onClick={save}>Delete</Button></>}>
      <Field label="Reason" required hint="At least 5 characters">
        <Textarea data-testid="delete-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Punched by mistake" />
      </Field>
    </Modal>
  );
}

function ManualEntry({ open, onOpenChange, onSaved, initial }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void; initial?: AttendanceRecord | null;
}) {
  const { me } = useCan();
  const [employee, setEmployee] = useState<PickedEmployee | null>(initial ? { id: initial.employee_id, full_name: initial.employee_name ?? "" } : null);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [checkIn, setCheckIn] = useState(hhmm(initial?.check_in_time) || "09:00");
  const [checkOut, setCheckOut] = useState(initial ? hhmm(initial.check_out_time) : "18:00");
  const [lunchStart, setLunchStart] = useState("");
  const [lunchEnd, setLunchEnd] = useState("");
  const [status, setStatus] = useState("present");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const absent = status === "absent";
  // Wall-clock times in the employee's work time zone (the server converts them, BUG-AS-05); an end at or before
  // the start is the next day.
  const overnight = !absent && !!checkOut && checkOut <= checkIn;

  const save = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      await api.post("/attendance/manual", absent
        // An absence carries no times and no hours (BUG-AS-04).
        ? { employee_id: employee.id, date, status, notes: notes || null }
        : {
          employee_id: employee.id, date, status, notes: notes || null, attendance_id: initial?.id ?? undefined,
          check_in_local: checkIn, check_out_local: checkOut || null,
          // Only sent when filled in; otherwise the existing breaks are kept (and checked against the new times).
          ...(lunchStart && lunchEnd ? { lunch_start_local: lunchStart, lunch_end_local: lunchEnd } : {}),
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
          {!absent && (
            <>
              <Field label="Check in"><Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Field>
              <Field label="Check out" hint={overnight ? "Ends the next day (+1 day)" : undefined}>
                <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {!absent && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="manual-zone-note">
              Times are in the employee&apos;s work time zone.{overnight && <> This shift ends the next day.</>}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Lunch start" hint="Optional: replaces the recorded lunch"><Input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} /></Field>
              <Field label="Lunch end"><Input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} /></Field>
            </div>
          </>
        )}
        {absent && <p className="text-xs text-muted-foreground">An absence is recorded without times or hours.</p>}
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
