"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck2, Clock3, LogIn, LogOut, PenLine, ScanFace, Timer, UserCheck, Users, UserX } from "lucide-react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { CameraCapture, type CameraHandle } from "@/components/shared/CameraCapture";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, LiveClock, PageHeader, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage, toApiError } from "@/lib/api";
import { can, canAny, canBeyondSelf } from "@/lib/access";
import { fmtDate, fmtDuration, fmtTime, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { AttendanceRecord, Page, TodaySummary } from "@/lib/types";

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
      <PageHeader title="Attendance" description="Check in with face verification and follow your team's day in real time." />
      {tabs.length > 1 ? (
        <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
          <TabPanel value="me"><MyAttendance /></TabPanel>
          <TabPanel value="team"><TeamAttendance /></TabPanel>
        </Tabs>
      ) : mine ? <MyAttendance /> : <TeamAttendance />}
    </div>
  );
}

/* ------------------------------------------------------------- Self service */
function MyAttendance() {
  const { data: today, reload } = useApi(
    () => api.get<{ state: "not_checked_in" | "working" | "completed"; record: AttendanceRecord | null }>("/attendance/me/today"),
    [],
  );
  const { data: history, reload: reloadHistory } = useApi(() => api.get<Page<AttendanceRecord>>("/attendance/me/history"), []);
  const [camera, setCamera] = useState<null | "check_in" | "check_out">(null);
  const [busy, setBusy] = useState(false);
  const cam = useRef<CameraHandle>(null);

  const submit = async (action: "check_in" | "check_out", image?: Blob | null) => {
    setBusy(true);
    try {
      // Only send multipart when there is a photo: an empty multipart body is rejected by the parser.
      let body: FormData | undefined;
      if (image) {
        body = new FormData();
        body.append("file", image, "capture.jpg");
      }
      await api.post(`/attendance/me/${action === "check_in" ? "check-in" : "check-out"}`, body);
      toast.success(action === "check_in" ? "Checked in. Have a great day!" : "Checked out. See you tomorrow!");
      setCamera(null);
      void reload();
      void reloadHistory();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "FACE_REQUIRED") setCamera(action);
      else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const captureAndSubmit = async () => {
    const blob = await cam.current?.capture();
    if (!blob) {
      toast.error("Couldn't capture from the camera. Try again.");
      return;
    }
    await submit(camera!, blob);
  };

  const state = today?.state;
  const record = today?.record;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <Card className="overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <p className="text-sm opacity-90">{fmtDate(new Date().toISOString(), "EEEE, d MMMM")}</p>
          <LiveClock className="mt-1 block font-display text-4xl font-semibold" />
          <AnimatePresence mode="wait">
            <motion.p key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-sm">
              {!today ? "Loading…" : state === "not_checked_in" ? "You haven't checked in yet." : state === "working"
                ? `Working since ${fmtTime(record?.check_in_time)} · ${fmtDuration(record?.working_seconds ?? 0)}`
                : `Day complete · ${fmtDuration(record?.working_seconds ?? 0)}`}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="space-y-3 p-6">
          {state === "not_checked_in" && (
            <Button size="lg" className="w-full" loading={busy} onClick={() => submit("check_in")}>
              <LogIn className="h-4 w-4" /> Check in
            </Button>
          )}
          {state === "working" && (
            <Button size="lg" variant="secondary" className="w-full" loading={busy} onClick={() => submit("check_out")}>
              <LogOut className="h-4 w-4" /> Check out
            </Button>
          )}
          {state === "completed" && (
            <div className="flex items-center gap-3 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
              <CalendarCheck2 className="h-5 w-5" /> Attendance recorded for today.
            </div>
          )}
          {record && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Check in</p><p className="font-semibold">{fmtTime(record.check_in_time)}</p></div>
              <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Check out</p><p className="font-semibold">{record.check_out_time ? fmtTime(record.check_out_time) : "—"}</p></div>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ScanFace className="h-3.5 w-3.5" /> Your face is verified against your own profile on the server.</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Last 30 days" />
        <DataTable
          rows={history?.items}
          loading={!history}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<Clock3 />} title="No attendance yet" />}
          columns={[
            { key: "date", header: "Date", cell: (r) => fmtDate(r.date, "EEE, d MMM") },
            { key: "in", header: "In", cell: (r) => fmtTime(r.check_in_time) },
            { key: "out", header: "Out", cell: (r) => (r.check_out_time ? fmtTime(r.check_out_time) : "—") },
            { key: "hours", header: "Worked", cell: (r) => fmtDuration(r.working_seconds), hideOnMobile: true },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>

      <Modal open={!!camera} onOpenChange={(o) => !o && setCamera(null)} title="Verify it's you"
        description="Look at the camera. We compare this capture with your enrolled face only."
        footer={<><Button variant="secondary" onClick={() => setCamera(null)}>Cancel</Button><Button loading={busy} onClick={captureAndSubmit}><ScanFace className="h-4 w-4" /> Capture & {camera === "check_out" ? "check out" : "check in"}</Button></>}>
        {camera && <CameraCapture ref={cam} scanning={busy} />}
      </Modal>
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

  return (
    <div className="space-y-6">
      {!summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="In scope" value={summary.total_employees} icon={<Users />} />
          <StatCard label="Present" value={summary.present_today} icon={<UserCheck />} tone="success" hint={`${summary.attendance_percentage}%`} delay={0.05} />
          <StatCard label="Working now" value={summary.working_now} icon={<Timer />} tone="info" delay={0.1} />
          <StatCard label="Not checked in" value={summary.absent_today} icon={<UserX />} tone="warning" hint={`${summary.on_leave} on leave`} delay={0.15} />
        </div>
      )}
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
          empty={<EmptyState icon={<Clock3 />} title="No attendance in this range" />}
          columns={[
            { key: "emp", header: "Employee", cell: (r) => (
              <div className="flex items-center gap-2.5"><Avatar name={r.employee_name} size={30} /><span className="font-medium">{r.employee_name}</span></div>
            ) },
            { key: "date", header: "Date", cell: (r) => fmtDate(r.date, "d MMM"), hideOnMobile: true },
            { key: "in", header: "In", cell: (r) => fmtTime(r.check_in_time) },
            { key: "out", header: "Out", cell: (r) => (r.check_out_time ? fmtTime(r.check_out_time) : <StatusBadge status="working" />) },
            { key: "src", header: "Source", cell: (r) => <span className="text-xs capitalize text-muted-foreground">{r.source}</span>, hideOnMobile: true },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <ManualEntry open={manualOpen} onOpenChange={setManualOpen} onSaved={() => { void reload(); void reloadRecords(); }} />
    </div>
  );
}

function ManualEntry({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { me } = useCan();
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [date, setDate] = useState(todayISO());
  const [checkIn, setCheckIn] = useState("09:00");
  const [checkOut, setCheckOut] = useState("18:00");
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
    <Modal open={open} onOpenChange={onOpenChange} title="Record attendance" description="Corrections are logged in the audit trail with your name."
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
