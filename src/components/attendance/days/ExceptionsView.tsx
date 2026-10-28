"use client";

import Link from "next/link";
import { useState } from "react";

import { NotFoundState } from "@/components/payroll/inputs/shared";
import { DataTable, ErrorState, PageHeader, Pagination, type Column } from "@/components/ui/layout";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Card } from "@/components/ui/primitives";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { attendanceExceptionsApi, type ExceptionItem } from "./api";

const PAGE_SIZE = 50;
const CODES = [
  "UNMARKED_DAY", "MISSING_PUNCH_OUT", "ABSENT", "LATE_IN", "EARLY_OUT", "SHORT_HOURS", "WORKED_ON_LEAVE",
  "NON_WORKING_DAY_WORKED", "LEAVE_PENDING_PAST_DATE", "UNSCHEDULED_WORK", "BREAK_MISSED", "BREAK_OVERSTAY",
  "REST_VIOLATION", "DEVICE_SYNC_PENDING", "REQUEST_PENDING", "OVERTIME_ON_ABSENT_DAY", "NO_SHIFT_ASSIGNED",
] as const;
const RESULT_TONES: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  PRESENT: "success", HALF_DAY: "warning", ABSENT: "danger", MISSING_PUNCH: "danger", UNMARKED: "warning",
  PENDING: "info", OFF: "neutral",
};
const label = (code: string) => code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Exceptions of decided days in the viewer's scope (04-attendance/03 §12; V2). Rows open the evaluated day. */
export function ExceptionsView() {
  const today = todayISO();
  const [start, setStart] = useState(daysBefore(today, 6));
  const [end, setEnd] = useState(today);
  const [code, setCode] = useState("");
  const [skip, setSkip] = useState(0);
  const { data, error, loading, reload } = useApi(
    () => attendanceExceptionsApi.list({ start, end, code: code || undefined, skip, limit: PAGE_SIZE }),
    [start, end, code, skip]);
  const columns: Column<ExceptionItem>[] = [
    { key: "employee", header: "Employee", primary: true,
      cell: (row) => (
        <Link className="font-medium hover:underline" href={`/attendance/days/${row.employee_id}/${row.shift_date}`}>
          {row.employee_name}
        </Link>) },
    { key: "date", header: "Date", cell: (row) => fmtDate(row.shift_date) },
    { key: "result", header: "Day", cell: (row) => <Badge tone={RESULT_TONES[row.day_result] ?? "neutral"}>{label(row.day_result)}</Badge> },
    { key: "codes", header: "Exceptions",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.exception_codes.map((c) => <Badge key={c} tone="warning">{label(c)}</Badge>)}
        </div>) },
  ];
  // V2-only (spine §15.7): a v1 tenant answers 404, shown as "not found" rather than an error.
  if (error?.status === 404) return <NotFoundState what="Page" backHref="/attendance" backLabel="Back to Attendance" />;
  return (
    <div className="space-y-4" data-testid="attendance-exceptions">
      <PageHeader title="Attendance exceptions" description="Decided days that need attention: missing punches, absences, late and early marks." />
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="From"><Input type="date" value={start} max={end} onChange={(e) => { setStart(e.target.value); setSkip(0); }} /></Field>
        <Field label="To"><Input type="date" value={end} min={start} onChange={(e) => { setEnd(e.target.value); setSkip(0); }} /></Field>
        <Field label="Exception">
          <Select value={code} onChange={(e) => { setCode(e.target.value); setSkip(0); }}>
            <option value="">All exceptions</option>
            {CODES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </Select>
        </Field>
      </Card>
      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <>
          <DataTable columns={columns} rows={data?.items ?? []} loading={loading} rowKey={(row) => row.day_id}
            cardBelowMd empty="No exceptions in this range." />
          <Pagination total={data?.total ?? 0} skip={skip} limit={PAGE_SIZE} onChange={setSkip} />
        </>
      )}
    </div>
  );
}
