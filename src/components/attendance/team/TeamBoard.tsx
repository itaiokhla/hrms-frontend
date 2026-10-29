"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LogIn, LogOut, MapPin, MapPinOff, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/layout";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { fmtDate, fmtTime } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { teamApi, type MemberTracking, type TeamMember } from "@/lib/teamAttendance";

import { ProxyPunchModal } from "./ProxyPunchModal";

const STATE: Record<TeamMember["state"], { label: string; tone: "neutral" | "info" | "success" }> = {
  NOT_PUNCHED_IN: { label: "Not punched in", tone: "neutral" },
  WORKING: { label: "Working", tone: "info" },
  PUNCHED_OUT: { label: "Punched out", tone: "success" },
};

/** "Location 10:05 · next 11:05" — the hourly (policy interval) location checks of a working member. */
function TrackingLine({ t }: { t: MemberTracking }) {
  if (t.state !== "ACTIVE" && t.state !== "PAUSED") {
    return t.state === "STOPPED" ? <span className="text-muted-foreground"> · location checks stopped</span> : null;
  }
  const overdue = t.schedule_state === "OVERDUE";
  return (
    <span className={overdue ? "text-warning" : "text-muted-foreground"} data-testid="team-tracking">
      {" · "}
      {overdue ? <MapPinOff className="inline h-3 w-3" aria-hidden /> : <MapPin className="inline h-3 w-3" aria-hidden />}
      {t.last_at ? ` Location ${fmtTime(t.last_at)}` : " No location yet"}
      {t.state === "PAUSED" ? " · paused on break" : t.next_due_at ? ` · next ${fmtTime(t.next_due_at)}` : ""}
      {t.interval_minutes ? ` (every ${t.interval_minutes} min)` : ""}
      {t.missed ? ` · ${t.missed} missed` : ""}
      {t.can_see_location && t.latitude != null && t.longitude != null && (
        <a className="ms-1 underline" target="_blank" rel="noreferrer" data-testid="team-tracking-map"
          href={`https://www.openstreetmap.org/?mlat=${t.latitude}&mlon=${t.longitude}#map=17/${t.latitude}/${t.longitude}`}>
          map
        </a>
      )}
    </span>
  );
}

/** The manager's team today (IG-AS-98): who is in, the hourly location checks of whoever is working, and punch in /
 * out for one person or a selected crew (bulk) when they cannot do it themselves. */
export function TeamBoard({ onChanged }: { onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q, 300);
  const { data, loading, reload } = useApi(() => teamApi.board(query), [query]);
  const [target, setTarget] = useState<{ member: TeamMember; direction: "IN" | "OUT" } | null>(null);
  const [bulk, setBulk] = useState<{ members: TeamMember[]; direction: "IN" | "OUT" } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Keep the board current: locations arrive about every interval, people punch from their own phones.
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) void reload(); }, 60_000);
    return () => window.clearInterval(id);
  }, [reload]);
  useEffect(() => { setSelected(new Set()); }, [query]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const chosen = items.filter((m) => selected.has(m.employee_id));
  const canIn = chosen.filter((m) => m.actions.includes("IN"));
  const canOut = chosen.filter((m) => m.actions.includes("OUT"));
  const selectable = items.filter((m) => m.actions.length > 0);
  const allChosen = selectable.length > 0 && selectable.every((m) => selected.has(m.employee_id));

  if (!data && loading) return <Skeleton className="h-48 rounded-2xl" />;
  if (!data) return null;
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const done = () => { setTarget(null); setBulk(null); setSelected(new Set()); void reload(); onChanged?.(); };

  return (
    <Card data-testid="team-board">
      <CardHeader title="My team today"
        description={data.can_punch ? "Punch someone in or out when they cannot do it themselves — or select several and punch them together." : "Team punches are off in the attendance settings."}
        action={<div className="relative w-56"><Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search team" className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code" /></div>} />
      <AnimatePresence>
        {data.can_punch && chosen.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap items-center gap-2 border-y border-border bg-primary/5 px-4 py-2 text-sm" data-testid="team-bulk-bar">
            <span className="font-medium" data-testid="team-bulk-count">{chosen.length} selected</span>
            <Button size="sm" variant="subtle" disabled={canIn.length === 0} data-testid="team-bulk-in"
              onClick={() => setBulk({ members: canIn, direction: "IN" })}>
              <LogIn className="h-4 w-4" /> Punch in{canIn.length !== chosen.length ? ` (${canIn.length})` : ""}
            </Button>
            <Button size="sm" variant="secondary" disabled={canOut.length === 0} data-testid="team-bulk-out"
              onClick={() => setBulk({ members: canOut, direction: "OUT" })}>
              <LogOut className="h-4 w-4" /> Punch out{canOut.length !== chosen.length ? ` (${canOut.length})` : ""}
            </Button>
            <Button size="sm" variant="ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /></Button>
          </motion.div>
        )}
      </AnimatePresence>
      {items.length === 0 ? (
        <EmptyState icon={<Users />} title="Nobody in your team" description="People who report to you, or teams you lead, appear here." />
      ) : (
        <>
          {data.can_punch && selectable.length > 1 && (
            <label className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground">
              <input type="checkbox" data-testid="team-select-all" checked={allChosen}
                onChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((m) => m.employee_id)))} />
              Select everyone who can be punched
            </label>
          )}
          <ul className="divide-y divide-border">
            <AnimatePresence initial={false}>
              {items.map((m, index) => {
                const complete = m.state === "PUNCHED_OUT" && m.actions.length === 0;
                const otherDate = m.shift_date && m.shift_date !== data.date;
                return (
                  <motion.li key={m.employee_id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 10) * 0.025 }}
                    className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`team-member-${m.employee_id}`}>
                    {data.can_punch && (
                      <input type="checkbox" aria-label={`Select ${m.name}`} data-testid={`team-select-${m.employee_id}`}
                        disabled={m.actions.length === 0} checked={selected.has(m.employee_id)} onChange={() => toggle(m.employee_id)} />
                    )}
                    <Avatar name={m.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{m.name} <span className="text-xs text-muted-foreground">{m.employee_code}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {m.check_in_time ? `In ${fmtTime(m.check_in_time)}` : "No punch yet"}
                        {m.check_out_time ? ` · Out ${fmtTime(m.check_out_time)}` : ""}
                        {m.capture_source === "SUPERVISOR" ? " · by a manager" : ""}
                        {otherDate ? ` · shift of ${fmtDate(m.shift_date!)}` : ""}
                        {complete && <span data-testid="team-day-complete"> · day complete (one session per day)</span>}
                        {m.tracking && <TrackingLine t={m.tracking} />}
                      </p>
                    </div>
                    <Badge tone={STATE[m.state].tone} dot><span data-testid="team-state">{STATE[m.state].label}</span></Badge>
                    {data.can_punch && m.actions.includes("OUT") && (
                      <Button size="sm" variant="secondary" data-testid={`team-punch-out-${m.employee_id}`}
                        onClick={() => setTarget({ member: m, direction: "OUT" })}><LogOut className="h-4 w-4" /> Punch out</Button>
                    )}
                    {data.can_punch && m.actions.includes("IN") && (
                      <Button size="sm" variant="subtle" data-testid={`team-punch-in-${m.employee_id}`}
                        onClick={() => setTarget({ member: m, direction: "IN" })}><LogIn className="h-4 w-4" /> Punch in</Button>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </>
      )}
      <ProxyPunchModal member={target?.member ?? null} members={bulk?.members ?? null}
        direction={bulk?.direction ?? target?.direction ?? "IN"} settings={data.settings}
        onClose={() => { setTarget(null); setBulk(null); }} onDone={done} />
    </Card>
  );
}
