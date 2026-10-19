"use client";

import { AlertTriangle, MapPin, PauseCircle } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { useTracking } from "@/store/tracking";

/** Shown on every page while location is being collected, so tracking is never invisible. */
export function TrackingIndicator() {
  const status = useTracking((s) => s.status);
  const phase = useTracking((s) => s.phase);
  if (!status || (status.state !== "ACTIVE" && status.state !== "PAUSED")) return null;
  const overdue = status.state === "ACTIVE" && status.schedule_state === "OVERDUE";
  const label =
    phase === "capturing" ? "Checking location…"
      : status.state === "PAUSED" ? "Location paused (lunch)"
        : overdue ? "Location check overdue"
          : `Location on · next ${fmtTime(status.next_due_at)}`;
  const Icon = status.state === "PAUSED" ? PauseCircle : overdue ? AlertTriangle : MapPin;
  return (
    <Link href="/attendance" data-testid="tracking-indicator" data-state={status.state}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:px-3",
        overdue ? "border-warning/40 bg-warning-soft text-warning" : "border-border bg-surface text-muted-foreground hover:text-foreground",
      )}
      aria-label={`${label}. Open attendance for details.`}>
      <Icon className={cn("h-3.5 w-3.5", phase === "capturing" && "animate-pulse")} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
