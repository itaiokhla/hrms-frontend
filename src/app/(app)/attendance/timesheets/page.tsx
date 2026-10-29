"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, toApiError } from "@/lib/api";
import { canAny } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface TimesheetWeek {
  employee_id: number;
  employee_name: string;
  week_start: string;
  week_end: string;
  net_minutes: number;
  own: boolean;
  days: { date: string; day_result: string | null; evaluation_state: string | null; net_minutes: number | null; exceptions: string[] }[];
  approval: { id: number; status: string; submitted_at: string | null; decided_at: string | null } | null;
}

function monday(d: Date): string {
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return copy.toISOString().slice(0, 10);
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hours(minutes: number | null): string {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  APPROVED: "success", SUBMITTED: "warning", REJECTED: "danger", REOPENED: "info", OPEN: "neutral",
};

/** Weekly timesheet (AS 04-attendance/04 §12): review the week, submit it, follow its approval. */
export default function TimesheetsPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_REQUEST, P.ATTENDANCE_READ])}>
      <Suspense fallback={<Skeleton className="h-96" />}><Timesheet /></Suspense>
    </RequireAccess>
  );
}

function Timesheet() {
  const search = useSearchParams();
  const [week, setWeek] = useState(search?.get("week") ?? monday(new Date(Date.now() - 7 * 86400000)));
  const employeeId = search?.get("employee_id");
  const { data, error, loading, reload } = useApi(
    () => api.get<TimesheetWeek>("/attendance/timesheets", { params: { week, employee_id: employeeId ?? undefined } }),
    [week, employeeId]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/attendance/timesheets/submit", { week_start: week });
      toast.success("Timesheet submitted for approval");
      await reload();
    } catch (e) {
      const err = toApiError(e);
      const days = (err.details as { days?: string[] } | undefined)?.days;
      toast.error(days?.length ? `${err.message} (${days.map((d) => fmtDate(d, "EEE d")).join(", ")})` : err.message);
    } finally {
      setSaving(false);
    }
  };

  const status = data?.approval?.status ?? "OPEN";
  const canSubmit = data?.own && ["OPEN", "REOPENED", "REJECTED"].includes(status);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Timesheet" description="Check your week, then submit it to your manager. A change after approval reopens the week." />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <Button size="sm" variant="ghost" aria-label="Previous week" data-testid="ts-prev" onClick={() => setWeek(shift(week, -7))}><ChevronLeft className="h-4 w-4" /></Button>
        <p className="font-medium" data-testid="ts-week">{fmtDate(week, "d MMM")} – {fmtDate(shift(week, 6), "d MMM yyyy")}</p>
        <Button size="sm" variant="ghost" aria-label="Next week" data-testid="ts-next" onClick={() => setWeek(shift(week, 7))}><ChevronRight className="h-4 w-4" /></Button>
        <div className="flex-1" />
        {data && <Badge tone={TONE[status] ?? "neutral"} dot><span data-testid="ts-status">{status.toLowerCase()}</span></Badge>}
        {canSubmit && <Button data-testid="ts-submit" loading={saving} onClick={submit}><Send className="h-4 w-4" /> Submit week</Button>}
      </Card>
      {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : loading || !data ? <Skeleton className="h-72" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="ts-table">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Day</th><th className="p-3">Result</th><th className="p-3">Worked</th><th className="p-3">Notes</th></tr></thead>
            <tbody>
              {data.days.map((d, i) => (
                <motion.tr key={d.date} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-t border-border/70">
                  <td className="p-3">{fmtDate(d.date, "EEE d MMM")}</td>
                  <td className="p-3">{d.day_result ? d.day_result.toLowerCase().replace("_", " ") : "—"}
                    {d.evaluation_state && d.evaluation_state !== "FINAL" && <Badge tone="warning" className="ms-2">not final</Badge>}</td>
                  <td className="p-3 tabular-nums">{hours(d.net_minutes)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{d.exceptions.map((x) => x.toLowerCase().replace(/_/g, " ")).join(", ")}</td>
                </motion.tr>
              ))}
              <tr className="border-t border-border font-semibold"><td className="p-3" colSpan={2}>Week total</td><td className="p-3 tabular-nums" data-testid="ts-total">{hours(data.net_minutes)}</td><td /></tr>
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
