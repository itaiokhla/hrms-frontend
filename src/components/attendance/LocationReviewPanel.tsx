"use client";

import { CheckCircle2, MapPinned, XCircle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { EVENT_LABELS } from "@/lib/attendance";
import { fmtDate, fmtMeters, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { LocationReviewItem } from "@/lib/types";

/**
 * Location exceptions and movement flags for the people the caller may review.
 * A flag asks a person to look; it never disciplines anyone or changes pay.
 */
export function LocationReviewPanel({ onOpenSession }: { onOpenSession: (attendanceId: number) => void }) {
  const { data, reload } = useApi(() => api.get<LocationReviewItem[]>("/attendance/location-review"), []);
  const [busy, setBusy] = useState<number | null>(null);
  if (!data?.length) return null;

  const decide = async (item: LocationReviewItem, decision: "APPROVED" | "REJECTED" | "ACKNOWLEDGED") => {
    setBusy(item.id);
    try {
      await api.post(`/attendance/location-review/${item.id}`, { decision });
      toast.success(decision === "ACKNOWLEDGED" ? "Marked as reviewed" : decision === "APPROVED" ? "Exception approved" : "Exception rejected");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="location-review">
      <CardHeader title={<span className="flex items-center gap-2"><MapPinned className="h-4 w-4" /> Location review <Badge tone="warning">{data.length}</Badge></span>}
        description="Exceptions and large movements in your scope. Flags ask for a look; they never change pay." />
      <ul className="divide-y divide-border">
        {data.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.employee_name} · {fmtDate(item.date, "d MMM")} {fmtTime(item.received_at)}</p>
              <p className="text-xs text-muted-foreground">
                {item.kind === "EXCEPTION"
                  ? `${EVENT_LABELS[item.sample_type] ?? "Check"} without a usable location: “${item.exception_reason}”`
                  : `Moved ${fmtMeters(item.distance_from_punch_in_m)} ± ${fmtMeters(item.uncertainty_m)} from the punch-in reading (straight line)`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenSession(item.attendance_id)}>Open shift</Button>
              {item.kind === "EXCEPTION" ? (
                <>
                  <Button size="sm" variant="secondary" loading={busy === item.id} onClick={() => decide(item, "REJECTED")}><XCircle className="h-4 w-4" /> Reject</Button>
                  <Button size="sm" loading={busy === item.id} onClick={() => decide(item, "APPROVED")}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                </>
              ) : (
                <Button size="sm" loading={busy === item.id} onClick={() => decide(item, "ACKNOWLEDGED")}><CheckCircle2 className="h-4 w-4" /> Reviewed</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
