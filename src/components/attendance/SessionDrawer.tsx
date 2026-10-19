"use client";

import { Coffee, Lock, LogIn, LogOut, MapPin, PenLine, ShieldAlert, Utensils } from "lucide-react";

import { EmptyState } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Badge, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { EVENT_LABELS } from "@/lib/attendance";
import { fmtDate, fmtHours, fmtMeters, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { LocationSampleBrief, SessionDetail } from "@/lib/types";

const EVENT_ICONS: Record<string, typeof LogIn> = {
  PUNCH_IN: LogIn, LUNCH_IN: Utensils, LUNCH_OUT: Coffee, PUNCH_OUT: LogOut, CORRECTION: PenLine, SESSION_CLOSED: ShieldAlert,
};

const LOCATION_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  CAPTURED: { label: "Location captured", tone: "success" },
  FAILED: { label: "Location failed", tone: "warning" },
  EXCEPTION: { label: "Location exception", tone: "danger" },
  NOT_PROVIDED: { label: "No location sent", tone: "warning" },
  NOT_REQUIRED: { label: "Location off", tone: "neutral" },
  NOT_APPLICABLE: { label: "Kiosk / HR entry", tone: "neutral" },
};

const MOVEMENT: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  BASELINE: { label: "Reference", tone: "info" },
  WITHIN_RANGE: { label: "Within range", tone: "success" },
  UNCERTAIN: { label: "Uncertain", tone: "neutral" },
  LOW_ACCURACY: { label: "Low accuracy", tone: "warning" },
  SIGNIFICANT_MOVEMENT_REVIEW: { label: "Moved: review", tone: "danger" },
};

const SAMPLE_STATUS: Record<string, string> = {
  CAPTURED: "Captured",
  PERMISSION_DENIED: "Permission denied",
  POSITION_UNAVAILABLE: "Unavailable",
  TIMEOUT: "Timed out",
  INSECURE_CONTEXT: "Not HTTPS",
  UNSUPPORTED: "Unsupported",
  ERROR: "Failed",
  MISSED: "Missed (page closed or asleep)",
};

export function SessionDrawer({ attendanceId, canLocate, onClose }: {
  attendanceId: number | null;
  canLocate: boolean;
  onClose: () => void;
}) {
  const { data, loading, error } = useApi(
    () => api.get<SessionDetail>(`/attendance/sessions/${attendanceId}`, { params: { include_locations: canLocate } }),
    [attendanceId, canLocate],
    { enabled: attendanceId !== null },
  );
  return (
    <Sheet open={attendanceId !== null} onOpenChange={(open) => !open && onClose()}
      title={data?.employee_name ?? "Attendance"} description={data ? fmtDate(data.date, "EEEE, d MMMM yyyy") : undefined}>
      {loading || !data ? (
        error ? <EmptyState title="Couldn't load this shift" description={error.message} /> : <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6" data-testid="session-detail">
          <section className="grid grid-cols-3 gap-2 text-center">
            {[["Total (gross)", data.hours.gross_seconds], ["Lunch", data.hours.lunch_seconds], ["Worked (net)", data.hours.net_seconds]].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-muted p-3">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="font-display text-lg font-semibold tabular-nums" data-testid={`detail-${String(label).split(" ")[0].toLowerCase()}`}>{fmtHours(value as number | null)}</p>
              </div>
            ))}
            <p className="col-span-3 text-xs text-muted-foreground">
              {data.hours.provisional ? "Still running: totals are provisional. " : ""}
              {!data.hours.complete ? "The punch-out is missing; hours are not estimated until HR corrects it. " : ""}
              In {fmtTime(data.check_in_time)} · Out {data.check_out_time ? fmtTime(data.check_out_time) : "—"} · <StatusBadge status={data.status} />
            </p>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold">Timeline</h4>
            <ol className="space-y-2">
              {data.events.map((event) => {
                const Icon = EVENT_ICONS[event.event_type] ?? PenLine;
                const location = LOCATION_STATUS[event.location_status];
                return (
                  <li key={event.id} className="flex items-start gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                    <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type} · {fmtTime(event.occurred_at)}</p>
                      {event.note && <p className="text-xs text-muted-foreground">{event.note}</p>}
                    </div>
                    {location && <Badge tone={location.tone}>{location.label}</Badge>}
                  </li>
                );
              })}
            </ol>
          </section>

          {data.breaks.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold">Lunch breaks</h4>
              <ul className="space-y-1 text-sm">
                {data.breaks.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                    <span>{fmtTime(b.started_at)} – {b.ended_at ? fmtTime(b.ended_at) : "ongoing"}</span>
                    <span className="text-xs text-muted-foreground">{b.is_paid ? "paid" : "unpaid"}{b.end_reason === "AUTO_CLOSED_AT_PUNCH_OUT" ? " · ended at punch-out" : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" /> Location</h4>
            {!data.location_access ? (
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="location-restricted">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Location details for this person need the separate “View location data” permission.
                  {data.location && ` ${data.location.captured} reading(s), ${data.location.missed} missed, ${data.location.review_pending} awaiting review.`}
                </span>
              </div>
            ) : !data.samples?.length ? (
              <p className="text-sm text-muted-foreground">No location readings for this shift.</p>
            ) : (
              <>
                <LocationPlot samples={data.samples} />
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs" data-testid="samples-table">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Time</th><th className="pr-2">Check</th><th className="pr-2">Result</th><th className="pr-2">±</th><th className="pr-2">From punch-in</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.samples.map((s) => (
                        <tr key={s.id} className="border-t border-border/60">
                          <td className="py-1.5 pr-2 tabular-nums">{fmtTime(s.received_at)}</td>
                          <td className="pr-2">{s.sample_type === "PERIODIC" ? (s.is_recovery ? "Scheduled (late)" : "Scheduled") : EVENT_LABELS[s.sample_type]}</td>
                          <td className="pr-2">{SAMPLE_STATUS[s.status] ?? s.status}{s.redacted ? " (coordinates deleted after retention)" : ""}</td>
                          <td className="pr-2 tabular-nums">{fmtMeters(s.accuracy_m)}</td>
                          <td className="pr-2 tabular-nums">{s.distance_from_punch_in_m !== null ? `${fmtMeters(s.distance_from_punch_in_m)} ± ${fmtMeters(s.uncertainty_m)}` : "—"}</td>
                          <td>{s.movement_status && <Badge tone={MOVEMENT[s.movement_status].tone}>{MOVEMENT[s.movement_status].label}</Badge>}
                            {s.exception_reason && <Badge tone="danger">Exception: {s.exception_reason}</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Readings are the browser&apos;s estimates with a 95% accuracy radius. Distances are straight lines from the punch-in
                  reading, not a route travelled; movement flags ask for review and never change pay.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

/** Observed points only (local east/north metres from the first reading); no path is drawn or implied. */
export function LocationPlot({ samples }: { samples: LocationSampleBrief[] }) {
  const points = samples.filter((s) => s.latitude != null && s.longitude != null && s.accuracy_m != null);
  if (!points.length) return null;
  const origin = points.find((p) => p.sample_type === "PUNCH_IN") ?? points[0];
  const lat0 = (origin.latitude! * Math.PI) / 180;
  const xy = points.map((p) => ({
    sample: p,
    x: (p.longitude! - origin.longitude!) * 111_320 * Math.cos(lat0),
    y: (p.latitude! - origin.latitude!) * 110_574,
  }));
  const extent = Math.max(50, ...xy.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) + (p.sample.accuracy_m ?? 0)));
  const size = 220;
  const scale = (size / 2 - 8) / extent;
  return (
    <figure className="rounded-xl border border-border bg-surface-muted/40 p-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-56 w-56" role="img"
        aria-label={`${points.length} observed location readings, up to ${fmtMeters(extent)} from the punch-in reading`}>
        <line x1={size / 2} y1={4} x2={size / 2} y2={size - 4} className="stroke-border" strokeDasharray="3 3" />
        <line x1={4} y1={size / 2} x2={size - 4} y2={size / 2} className="stroke-border" strokeDasharray="3 3" />
        {xy.map(({ sample, x, y }, index) => (
          <g key={sample.id}>
            <circle cx={size / 2 + x * scale} cy={size / 2 - y * scale} r={Math.max(2, (sample.accuracy_m ?? 0) * scale)}
              className={sample.movement_status === "SIGNIFICANT_MOVEMENT_REVIEW" ? "fill-danger/15 stroke-danger/50" : "fill-primary/10 stroke-primary/40"} />
            <circle cx={size / 2 + x * scale} cy={size / 2 - y * scale} r={3} className="fill-primary" />
            <text x={size / 2 + x * scale + 5} y={size / 2 - y * scale - 5} className="fill-foreground text-[9px]">{index + 1}</text>
          </g>
        ))}
      </svg>
      <figcaption className="text-center text-[11px] text-muted-foreground">
        Readings in order (1 = {origin.sample_type === "PUNCH_IN" ? "punch-in" : "first reading"}); circles are accuracy radii. Scale ±{fmtMeters(extent)}.
      </figcaption>
    </figure>
  );
}
