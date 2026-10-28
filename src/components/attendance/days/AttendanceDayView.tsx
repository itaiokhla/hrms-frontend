"use client";

import { ArrowLeft, Moon, Timer } from "lucide-react";
import Link from "next/link";

import { DetailGate, NotFoundState, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { Badge, Card } from "@/components/ui/primitives";
import { isIdSegment } from "@/lib/attendance-routes";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { attendanceDaysApi, type AttendanceDay, type DayResult, type PortionResult } from "./api";

const RESULT_LABELS: Record<DayResult, string> = {
  PRESENT: "Present", HALF_DAY: "Half day", ABSENT: "Absent", MISSING_PUNCH: "Missing punch", UNMARKED: "Unmarked",
  PENDING: "Pending", OFF: "Off",
};
const RESULT_TONES: Record<PortionResult | "HALF_DAY", "success" | "warning" | "danger" | "neutral" | "info"> = {
  PRESENT: "success", HALF_DAY: "warning", ABSENT: "danger", MISSING_PUNCH: "danger", UNMARKED: "warning",
  PENDING: "info", OFF: "neutral",
};
const STATE_LABELS = { OPEN: "In progress", PROVISIONAL: "Provisional", FINAL: "Final" } as const;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function markText(day: AttendanceDay, kind: "late" | "early"): string {
  const mark = kind === "late" ? day.late_mark : day.early_mark;
  const converted = kind === "late" ? day.late_converted : day.early_converted;
  const excused = kind === "late" ? day.late_excused : day.early_excused;
  const source = kind === "late" ? day.late_excuse_source : day.early_excuse_source;
  const value = kind === "late" ? day.late_minutes : day.early_minutes;
  if (converted) return `Half day instead (${minutes(value)})`;
  if (!mark) return value ? `Within grace (${minutes(value)})` : "None";
  const by = value === 0 ? "by < 1 min" : `by ${minutes(value)}`;
  return excused ? `Excused ${by} (${source === "POLICY" ? "hours complete" : "request"})` : `Marked ${by}`;
}

/** The evaluation of one employee and shift date (page twin of the `att-day` Sheet; 04-attendance/03 §14). */
export function AttendanceDayView({ employeeId, date }: { employeeId: string; date: string }) {
  const valid = isIdSegment(employeeId) && isDate(date);
  const { data, error, loading, reload } = useApi(
    () => (valid ? attendanceDaysApi.get(employeeId, date, true) : Promise.resolve(null)), [employeeId, date]);
  if (!valid) return <NotFoundState what="Day" backHref="/attendance" backLabel="Back to Attendance" />;
  const day = data?.day ?? null;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Day" backHref="/attendance"
      backLabel="Back to Attendance">
      {data && (
        <div className="space-y-6" data-testid="attendance-day">
          <Link href="/attendance" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Back to Attendance
          </Link>
          <WorkspaceHeader eyebrow="Attendance day" showHideAmounts={false} title={fmtDate(date, "EEEE d MMM yyyy")} />
          {!day ? (
            <Card className="p-5 text-sm text-muted-foreground">
              Not evaluated yet. The day is decided after {fmtDateTime(data.explain?.close_point)}.
            </Card>
          ) : (
            <>
              <Card className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={RESULT_TONES[day.day_result]} dot data-testid="day-result">{RESULT_LABELS[day.day_result]}</Badge>
                  <Badge tone="neutral">{STATE_LABELS[day.evaluation_state]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Version {day.version} · {day.rules_mode === "STANDARD" ? "Attendance rules" : "Legacy rules"}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["first_half_result", "second_half_result"] as const).map((half, index) => (
                    <div key={half} className="flex items-center justify-between rounded-xl border border-border/70 px-4 py-3">
                      <span className="text-sm font-medium">{index === 0 ? "First half" : "Second half"}</span>
                      <Badge tone={RESULT_TONES[day[half]]}>{RESULT_LABELS[day[half]]}</Badge>
                    </div>
                  ))}
                </div>
                {day.pending_reasons.length > 0 && (
                  <p className="text-sm text-muted-foreground">Waiting for: {day.pending_reasons.join(", ").replace(/_/g, " ").toLowerCase()}</p>
                )}
              </Card>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Worked (net)" value={minutes(day.net_minutes)}
                  hint={day.unpaid_break_minutes ? `${minutes(day.unpaid_break_minutes)} unpaid breaks` : undefined} />
                <Fact label="Expected" value={minutes(day.expected_minutes)}
                  hint={day.expected_start_at ? `${fmtTime(day.expected_start_at)} – ${fmtTime(day.expected_end_at)}` : undefined} />
                <Fact label="In / out" value={day.first_in_at ? `${fmtTime(day.first_in_at)} – ${fmtTime(day.last_out_at)}` : "—"}
                  hint={`${day.session_count} session${day.session_count === 1 ? "" : "s"}`} />
                <Fact label="Short" value={minutes(day.short_minutes)} hint={day.short_mark ? "Short-hours mark" : undefined} />
              </div>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <div><p className="text-sm font-medium">Late</p><p className="text-sm text-muted-foreground">{markText(day, "late")}</p></div>
                <div><p className="text-sm font-medium">Early</p><p className="text-sm text-muted-foreground">{markText(day, "early")}</p></div>
                <div className="flex items-center gap-2 text-sm"><Moon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Night {minutes(day.night_minutes)}</div>
                <div className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Overtime eligible {minutes(day.ot_eligible_minutes)}</div>
              </Card>
              {day.exception_codes.length > 0 && (
                <Card className="p-5">
                  <p className="text-sm font-medium">Exceptions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {day.exception_codes.map((code) => <Badge key={code} tone="warning">{code.replace(/_/g, " ").toLowerCase()}</Badge>)}
                  </div>
                </Card>
              )}
              {day.history && day.history.length > 0 && (
                <Card className="p-5">
                  <p className="text-sm font-medium">History</p>
                  <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {day.history.map((item) => (
                      <li key={item.version}>v{item.version} · {fmtDateTime(item.created_at)} · {item.trigger.replace(/_/g, " ").toLowerCase()}
                        {item.version > 1 && ` · ${item.changed.length} change${item.changed.length === 1 ? "" : "s"}`}</li>
                    ))}
                  </ol>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </DetailGate>
  );
}
