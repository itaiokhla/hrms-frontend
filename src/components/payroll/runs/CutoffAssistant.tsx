"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ExternalLink, HeartPulse, Lock, Unlock, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { api, toApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export interface CutoffItem {
  code: string;
  module: string;
  severity: "BLOCKING" | "WARNING";
  count: number;
  message: string;
  link?: string;
}

export interface CutoffResult {
  pay_group: { id: number; name: string | null };
  period: { id: number; start: string; end: string; status: string; input_cutoff_on: string; pay_date: string | null } | null;
  attendance_window: { start: string; end: string; split: boolean } | null;
  lock_state: "OPEN" | "INPUT_LOCKED" | "FINALIZED" | null;
  employees: number;
  runs: { id: number; status: string; stale: boolean }[];
  items: CutoffItem[];
  blocking: number;
  warnings: number;
  ready: boolean;
}

const LOCK_TEXT: Record<NonNullable<CutoffResult["lock_state"]>, string> = {
  OPEN: "Inputs open", INPUT_LOCKED: "Inputs locked", FINALIZED: "Paid (finalized)",
};

/** Pre-run health check (X 03 §5, D-X-16): one read across attendance, leave, devices and payroll before inputs lock. */
export function CutoffAssistant({ open, onOpenChange, payGroups, initialGroup }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payGroups: { id: number; name: string }[];
  initialGroup?: number | null;
}) {
  const [group, setGroup] = useState<number | null>(initialGroup ?? null);
  const [data, setData] = useState<CutoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && group === null && payGroups.length) setGroup(initialGroup ?? payGroups[0].id);
  }, [open, group, payGroups, initialGroup]);

  useEffect(() => {
    if (!open || group === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<CutoffResult>("/cutoff", { params: { pay_group_id: group } })
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) { setData(null); setError(toApiError(e).message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, group]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Pre-run health check"
      description="What still needs attention before payroll inputs lock, across attendance, leave and devices."
      footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      <div className="space-y-4" data-testid="cutoff-assistant">
        <Field label="Pay group">
          <Select data-testid="cutoff-group" value={group ?? ""} onChange={(e) => setGroup(Number(e.target.value))}>
            {payGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        {loading && !data ? <Skeleton className="h-40" /> : data && (
          <>
            <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${data.ready ? "border-success/40 bg-success-soft/40" : "border-danger/40 bg-danger-soft/30"}`}
              data-testid="cutoff-summary">
              {data.ready ? <CheckCircle2 className="h-6 w-6 text-success" /> : <XCircle className="h-6 w-6 text-danger" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{data.ready ? "Ready to lock inputs" : `${data.blocking} blocking item(s)`}</p>
                {data.period ? (
                  <p className="text-xs text-muted-foreground">
                    Period {fmtDate(data.period.start, "d MMM")} – {fmtDate(data.period.end, "d MMM yyyy")} · cutoff {fmtDate(data.period.input_cutoff_on, "EEE d MMM")}
                    {data.attendance_window?.split && <> · attendance {fmtDate(data.attendance_window.start, "d MMM")} – {fmtDate(data.attendance_window.end, "d MMM")}</>}
                    {" · "}{data.employees} employee(s)
                  </p>
                ) : <p className="text-xs text-muted-foreground">No pay period yet</p>}
              </div>
              {data.lock_state && (
                <Badge tone={data.lock_state === "OPEN" ? "success" : data.lock_state === "INPUT_LOCKED" ? "warning" : "neutral"}>
                  {data.lock_state === "OPEN" ? <Unlock className="me-1 h-3 w-3" /> : <Lock className="me-1 h-3 w-3" />}
                  <span data-testid="cutoff-lock">{LOCK_TEXT[data.lock_state]}</span>
                </Badge>
              )}
            </motion.section>
            {data.items.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success"><HeartPulse className="h-4 w-4" /> Nothing pending.</p>
            ) : (
              <ul className="space-y-2" data-testid="cutoff-items">
                <AnimatePresence initial={false}>
                  {data.items.map((item, index) => (
                    <motion.li key={item.code} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className="flex items-start gap-3 rounded-xl border border-border px-3 py-2 text-sm" data-testid={`cutoff-item-${item.code}`}>
                      {item.severity === "BLOCKING"
                        ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                      <div className="min-w-0 flex-1">
                        <p>{item.message}</p>
                        <p className="text-xs text-muted-foreground">{item.module}</p>
                      </div>
                      <Badge tone={item.severity === "BLOCKING" ? "danger" : "warning"}>{item.severity === "BLOCKING" ? "Blocking" : "Warning"}</Badge>
                      {item.link && (
                        <Link href={item.link} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Open <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
