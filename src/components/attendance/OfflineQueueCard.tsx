"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, RefreshCw, AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import { dismissFailed, failed, flush, queued, subscribe } from "@/lib/offlineQueue";

const EMPTY: never[] = [];

function useStore<T>(read: () => T[]): T[] {
  const snapshot = useCallback(() => JSON.stringify(read()), [read]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return raw === "[]" ? (EMPTY as T[]) : (JSON.parse(raw) as T[]);
}

const DIRECTION: Record<string, string> = { IN: "Check in", OUT: "Check out", BREAK_START: "Break start", BREAK_END: "Break end" };

/** Pending-sync badge and the failed punches of the offline queue (04-attendance/01 §6.1, O-4, O-7). Syncs on load,
 * when the browser comes back online and on demand. */
export function OfflineQueueCard({ enabled, onSynced }: { enabled: boolean; onSynced: () => void }) {
  const pending = useStore(queued);
  const refused = useStore(failed);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  const sync = useCallback(async (manual = false) => {
    if (!queued().length) return;
    setSyncing(true);
    try {
      const result = await flush();
      if (result) {
        if (result.accepted) toast.success(`${result.accepted} offline punch${result.accepted === 1 ? "" : "es"} synced`);
        if (result.failed) toast.error(`${result.failed} offline punch${result.failed === 1 ? "" : "es"} could not be recorded`);
        onSynced();
      } else if (manual) {
        toast("Still offline — your punches stay on this phone.", { icon: "📶" });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [onSynced]);

  useEffect(() => {
    const up = () => { setOnline(true); void sync(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void sync();
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [sync]);

  if (!enabled && !pending.length && !refused.length) return null;
  return (
    <AnimatePresence>
      {(pending.length > 0 || refused.length > 0 || !online) && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <Card className="space-y-3 p-4" data-testid="offline-queue">
            <div className="flex flex-wrap items-center gap-2">
              <CloudOff className="h-4 w-4 text-warning" aria-hidden />
              <p className="flex-1 text-sm font-medium">
                {!online ? "You're offline." : ""} {pending.length ? `${pending.length} punch${pending.length === 1 ? "" : "es"} waiting to sync` : "Nothing waiting to sync"}
              </p>
              {pending.length > 0 && <Badge tone="warning" data-testid="offline-pending">{pending.length} pending</Badge>}
              {pending.length > 0 && (
                <Button size="sm" variant="secondary" loading={syncing} data-testid="offline-sync" onClick={() => void sync(true)}>
                  <RefreshCw className="h-4 w-4" /> Sync now
                </Button>
              )}
            </div>
            {pending.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {pending.map((p) => <li key={p.idempotency_key}>{DIRECTION[p.direction] ?? p.direction} · saved {fmtDateTime(p.device_wall_clock_at_capture)}</li>)}
              </ul>
            )}
            {refused.length > 0 && (
              <div className="space-y-2" data-testid="offline-failed">
                <p className="flex items-center gap-2 text-sm font-medium text-danger"><AlertTriangle className="h-4 w-4" /> Failed punches</p>
                {refused.map((f) => (
                  <div key={f.idempotency_key} className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
                    <span className="flex-1"><span className="font-medium">{DIRECTION[f.direction] ?? f.direction}</span>
                      {f.captured_at ? ` · ${fmtDateTime(f.captured_at)}` : ""} — {f.message}</span>
                    {f.next_action?.kind === "MISSED_PUNCH" && (
                      <Link className="font-medium text-primary underline" data-testid="offline-missed-punch"
                        href={`/attendance?tab=me&modal=att-regularize&kind=MISSED_PUNCH&date=${f.next_action.shift_date}&direction=${f.next_action.direction}`}>
                        Raise a missed-punch request
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => dismissFailed(f.idempotency_key)}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
