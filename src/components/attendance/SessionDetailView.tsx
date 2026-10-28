"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Coffee, Lock, LogIn, LogOut, MapPin, PenLine, ScanFace, ShieldAlert, Utensils } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useCan } from "@/components/access/Can";
import { LocationPlot } from "@/components/attendance/SessionDrawer";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Badge, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { EVENT_LABELS } from "@/lib/attendance";
import { fmtDate, fmtHours, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { captureApi, type ReviewItem } from "./captureApi";
import { REVIEW_KIND_LABEL, SOURCE_LABEL } from "./captureModel";
import { EvidencePanel, ReviewItemSheet, SeverityBadge } from "./ReviewItemSheet";

const EVENT_ICONS: Record<string, typeof LogIn> = {
  PUNCH_IN: LogIn, LUNCH_IN: Utensils, LUNCH_OUT: Coffee, PUNCH_OUT: LogOut, CORRECTION: PenLine, SESSION_CLOSED: ShieldAlert,
};
const LOCATION_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CAPTURED: { label: "Location captured", tone: "success" }, FAILED: { label: "Location failed", tone: "warning" },
  EXCEPTION: { label: "Location exception", tone: "danger" }, NOT_PROVIDED: { label: "No location sent", tone: "warning" },
  NOT_REQUIRED: { label: "Location off", tone: "neutral" }, NOT_APPLICABLE: { label: "Kiosk / HR entry", tone: "neutral" },
};

/**
 * `/attendance/sessions/{id}` (09-ui-ux/01 §4.2, twin of `att-session`): one continuous session with its punches,
 * the site-check flags as review items (result + band only), masked evidence with Reveal for
 * `attendance:evidence:read` (step-up, audited) and the location plot only for `location:read`.
 */
export function SessionDetailView({ id }: { id: string }) {
  const { me, can } = useCan();
  const canLocate = can(P.LOCATION_READ);
  const reviewer = can(P.ATTENDANCE_REVIEW) || can(P.LOCATION_REVIEW);
  const { data, error, loading, reload } = useApi(() => captureApi.session(id, canLocate), [id, canLocate]);
  const { data: items } = useApi(
    () => (data && reviewer && data.employee_id !== me?.employee?.id
      ? captureApi.review({ status: "", employee_id: data.employee_id, from: data.date, to: data.date, limit: 100 })
        .then((r) => r.items.filter((i) => i.session_id === data.id || !i.session_id))
        .catch(() => [] as ReviewItem[])
      : Promise.resolve([] as ReviewItem[])),
    [data?.id, reviewer],
  );
  const [open, setOpen] = useState<ReviewItem | null>(null);

  if (error) {
    return error.status === 404
      ? <Card className="mx-auto mt-10 max-w-lg"><EmptyState title="This session doesn't exist or you can't see it."
          action={<Link href="/attendance" className="text-sm font-medium text-primary">Back to attendance</Link>} /></Card>
      : <ErrorState message={error.message} onRetry={() => void reload()} />;
  }
  if (loading || !data) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const extra = data as unknown as { capture_source?: string; session_seq?: number | null; employee_name?: string | null };
  const punchIds = Array.from(new Set((items ?? []).map((i) => i.punch_id).filter((p): p is number => !!p)));

  return (
    <div className="mx-auto max-w-4xl" data-testid="session-page" data-session-id={data.id}>
      <Link href="/attendance" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Attendance
      </Link>
      <PageHeader eyebrow="Session" title={`${extra.employee_name ?? data.employee_name ?? "Session"} · ${fmtDate(data.date, "EEE d MMM yyyy")}`}
        description={`In ${fmtTime(data.check_in_time)} · Out ${data.check_out_time ? fmtTime(data.check_out_time) : "—"}${extra.session_seq ? ` · session ${extra.session_seq}` : ""}${extra.capture_source ? ` · ${SOURCE_LABEL[extra.capture_source] ?? extra.capture_source}` : ""}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-3 text-center">
            {[["Total (gross)", data.hours.gross_seconds], ["Lunch", data.hours.lunch_seconds], ["Worked (net)", data.hours.net_seconds]].map(([label, value]) => (
              <Card key={label as string} className="p-4">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="font-display text-xl font-semibold tabular-nums">{fmtHours(value as number | null)}</p>
              </Card>
            ))}
          </motion.div>
          <Card>
            <CardHeader title="Punches" description="Every punch of this session, in order." action={<StatusBadge status={data.status} />} />
            <ol className="space-y-2 p-4" data-testid="session-events">
              {data.events.map((event, index) => {
                const Icon = EVENT_ICONS[event.event_type] ?? PenLine;
                const location = LOCATION_STATUS[event.location_status];
                const verified = (event as unknown as { face_verified?: boolean }).face_verified;
                return (
                  <motion.li key={event.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 12) * 0.025 }}
                    className="flex items-start gap-3 rounded-xl border border-border px-3 py-2 text-sm" data-testid={`session-event-${event.event_type}`}>
                    <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type} · {fmtTime(event.occurred_at)}</p>
                      <p className="text-xs text-muted-foreground">{event.source === "kiosk" ? "Kiosk" : event.source === "manual" ? "HR entry" : "Self service"}
                        {verified ? " · face verified" : ""}{event.note ? ` · ${event.note}` : ""}</p>
                    </div>
                    {verified && <ScanFace className="h-4 w-4 text-success" aria-label="Face verified" />}
                    {location && <Badge tone={location.tone}>{location.label}</Badge>}
                  </motion.li>
                );
              })}
            </ol>
          </Card>
          {canLocate && data.samples?.length ? (
            <Card className="p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" aria-hidden /> Location readings</p>
              <LocationPlot samples={data.samples} />
            </Card>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground" data-testid="session-location-masked">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Exact places are shown only with the “View location data” permission; site checks show as a result and a distance band.
            </p>
          )}
        </div>
        <div className="space-y-4">
          {reviewer && (
            <Card>
              <CardHeader title="Flags" description="Site checks and other items raised for this day." />
              <div className="space-y-2 p-4" data-testid="session-flags">
                {(items ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No flags.</p> : (items ?? []).map((i) => (
                  <button key={i.id} type="button" onClick={() => setOpen(i)} data-testid={`session-flag-${i.kind}`}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-start text-sm transition hover:bg-surface-muted">
                    <span className="font-medium">{REVIEW_KIND_LABEL[i.kind] ?? i.kind}</span>
                    <SeverityBadge severity={i.severity} />
                  </button>
                ))}
              </div>
            </Card>
          )}
          {punchIds.map((p) => <EvidencePanel key={p} punchId={p} />)}
        </div>
      </div>
      <ReviewItemSheet item={open} onClose={() => setOpen(null)} onDecided={() => setOpen(null)} />
    </div>
  );
}
