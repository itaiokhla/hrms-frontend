"use client";

import { motion } from "framer-motion";
import { CalendarClock, History } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

interface RetroItem {
  proposal_id: number;
  trigger: string;
  status: string;
  reason: string | null;
  currency: string;
  original_period: { start: string; end: string };
  lines: { component_code: string; direction: "ARREARS" | "RECOVERY"; delta: string; explanation: string | null }[];
  cause: { record_type?: string; record_id?: number; version?: string; dates?: string[] };
  attendance_days: { employee_id: number; date: string; attendance_day_id: number; version: string; link: string }[];
}

interface Breakdown { run_employee_id: number; paid_here: RetroItem[]; corrections_of_this_period: RetroItem[] }

/**
 * Retroactive attendance adjustments of one run employee (JC-AS-11): what this pay run pays for earlier periods and
 * the later corrections of this period, each linked to the evaluated day (and version) that caused it.
 */
export function RetroBreakdown({ runEmployeeId }: { runEmployeeId: number | string }) {
  const { data } = useApi(() => api.get<Breakdown>(`/payroll/run-employees/${runEmployeeId}/retro-breakdown`)
    .catch(() => null), [runEmployeeId]);
  if (!data || (data.paid_here.length === 0 && data.corrections_of_this_period.length === 0)) return null;
  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} aria-label="Retro adjustments"
      className="space-y-3" data-testid="retro-breakdown">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Retro adjustments</h3>
      {data.paid_here.length > 0 && <Group title="Paid in this run for earlier periods" items={data.paid_here} />}
      {data.corrections_of_this_period.length > 0 && (
        <Group title="Corrections of this period (paid in a later run)" items={data.corrections_of_this_period} />
      )}
    </motion.section>
  );
}

function Group({ title, items }: { title: string; items: RetroItem[] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.proposal_id} className="rounded-xl border border-border p-3 text-sm" data-testid={`retro-item-${item.proposal_id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {fmtDate(item.original_period.start, "d MMM")} – {fmtDate(item.original_period.end, "d MMM yyyy")}
              </span>
              <Badge tone={item.status === "SETTLED" ? "success" : item.status === "APPROVED" ? "info" : "warning"}>
                {item.status.toLowerCase().replace("_", " ")}
              </Badge>
            </div>
            <ul className="mt-1 space-y-0.5">
              {item.lines.map((line, i) => (
                <li key={i} className="flex justify-between text-xs">
                  <span>{line.component_code}</span>
                  <span className={line.direction === "RECOVERY" ? "text-danger" : "text-success"}>
                    {line.direction === "RECOVERY" ? "" : "+"}{line.delta} {item.currency}
                  </span>
                </li>
              ))}
            </ul>
            {item.attendance_days.length > 0 ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> Caused by
                {item.attendance_days.map((d) => (
                  <Link key={d.date} href={d.link} className="font-medium text-primary hover:underline" data-testid="retro-day-link">
                    {fmtDate(d.date, "EEE d MMM")} (revision {d.version})
                  </Link>
                ))}
              </p>
            ) : item.cause.record_type ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Caused by a change to {item.cause.record_type.replace("_", " ")} #{item.cause.record_id}
                {item.cause.dates?.length ? ` on ${item.cause.dates.map((d) => fmtDate(d, "d MMM")).join(", ")}` : ""}
              </p>
            ) : item.reason ? <p className="mt-2 text-xs text-muted-foreground">{item.reason}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
