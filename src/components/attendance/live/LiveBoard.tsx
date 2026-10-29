"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Coffee, Home, Pause, Play, Search, UserCheck, UserX, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { insightsApi, type LiveBoard as Board, type LiveRow, type LiveStatus, type LiveTile } from "@/lib/attendanceInsights";

const TONE: Record<LiveStatus, "success" | "warning" | "danger" | "neutral" | "info" | "primary"> = {
  WORKING: "success", ON_LUNCH: "info", IN_FIELD: "primary", COMPLETED: "neutral", NOT_YET_IN: "danger",
  NOT_STARTED: "neutral", ABSENT: "danger", UNMARKED: "warning", ON_LEAVE: "info", OFF: "neutral",
};

/** Tile → status filter (each card filters the list, 10-analytics §3.5). */
const TILE_FILTER: Record<string, LiveStatus[] | "late"> = {
  present_people: ["WORKING", "ON_LUNCH", "COMPLETED"], present_units: ["WORKING", "ON_LUNCH", "COMPLETED"],
  not_yet_in: ["NOT_YET_IN"], absent: ["NOT_YET_IN", "NOT_STARTED", "ABSENT", "UNMARKED"], on_leave: ["ON_LEAVE"],
  off: ["OFF"], on_duty: ["IN_FIELD"], late: "late",
};

const QUICK = [
  { key: "in_office", label: "In office", icon: UserCheck },
  { key: "remote", label: "Remote / field", icon: Home },
  { key: "on_lunch", label: "On lunch", icon: Coffee },
  { key: "late", label: "Late", icon: AlertTriangle },
  { key: "not_in", label: "Not in", icon: UserX },
] as const;

const LIMIT = 25;

function TileCard({ tile, active, onClick, index }: { tile: LiveTile; active: boolean; onClick: () => void; index: number }) {
  const reduce = useReducedMotion();
  const composition = tile.composition && Object.entries(tile.composition).filter(([, v]) => v !== "0.0");
  return (
    <motion.button type="button" onClick={onClick} data-testid={`live-tile-${tile.key}`} aria-pressed={active}
      initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: reduce ? 0 : index * 0.03 }}
      className={cn("min-w-[8.5rem] flex-1 rounded-2xl border p-3 text-left transition-colors",
        active ? "border-primary bg-primary-soft/60" : "border-border bg-surface hover:border-primary/50")}
      title={`${tile.kpi} · ${tile.unit === "PEOPLE" ? "people" : "portion units (a half day counts 0.5)"}`}>
      <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`live-tile-${tile.key}-value`}>{tile.value}</p>
      {composition && composition.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {composition.map(([k, v]) => `${v} ${k.replace(/_/g, " ").toLowerCase()}`).join(" · ")}
        </p>
      )}
      {!!tile.no_show && <p className="mt-1 text-[11px] font-medium text-danger">{tile.no_show} no-show</p>}
    </motion.button>
  );
}

/** Attendance › Live (`/attendance?tab=live`): who is in, on lunch, in the field or not yet in — refreshed every minute. */
export function LiveBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus[]>([]);
  const [activeTile, setActiveTile] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const params = useMemo(() => ({ q, quick: quick ?? undefined, status, skip, limit: LIMIT }), [q, quick, status, skip]);

  useEffect(() => {
    const timer = setTimeout(() => { setQ(search.trim()); setSkip(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      setBusy(true);
      try {
        const next = await insightsApi.liveBoard(params);
        if (!cancelled) { setBoard(next); setError(null); setUpdated(new Date()); }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    const timer = paused ? undefined : setInterval(load, 60_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [params, paused]);

  const pickTile = (tile: LiveTile) => {
    const filter = TILE_FILTER[tile.key];
    setSkip(0);
    if (!filter || activeTile === tile.key) { setActiveTile(null); setStatus([]); setQuick(null); return; }
    setActiveTile(tile.key);
    if (filter === "late") { setStatus([]); setQuick("late"); } else { setQuick(null); setStatus(filter); }
  };

  const columns: Column<LiveRow>[] = [
    { key: "name", header: "Employee", primary: true, cell: (r) => (
      <div><p className="font-medium" data-testid={`live-row-${r.employee_id}`}>{r.name}</p>
        <p className="text-xs text-muted-foreground">{r.employee_code}</p></div>) },
    { key: "status", header: "Status", cell: (r) => (
      <span className="flex flex-wrap items-center gap-1" data-testid={`live-status-${r.employee_id}`} data-status={r.status}>
        <Badge tone={TONE[r.status]} dot>{r.status_label}</Badge>
        {r.late && <Badge tone="warning">Late{r.late_by_minutes ? ` ${r.late_by_minutes}m` : ""}</Badge>}
        {r.no_show && <Badge tone="danger">No-show</Badge>}
      </span>) },
    { key: "in", header: "First in", cell: (r) => <span className="tabular-nums">{r.first_in_at ? fmtTime(r.first_in_at) : "—"}</span> },
    { key: "start", header: "Shift start", hideOnMobile: true, cell: (r) => <span className="tabular-nums">{r.expected_start_at ? fmtTime(r.expected_start_at) : "—"}</span> },
    { key: "out", header: "Last out", hideOnMobile: true, cell: (r) => <span className="tabular-nums">{r.last_out_at ? fmtTime(r.last_out_at) : "—"}</span> },
    { key: "mode", header: "Work mode", hideOnMobile: true, cell: (r) => (r.work_mode ? r.work_mode.replace("_", " ").toLowerCase() : "—") },
  ];

  if (error && !board) return <ErrorState message={error} onRetry={() => setSkip((s) => s)} />;
  return (
    <div className="space-y-4" data-testid="live-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={cn("inline-block h-2 w-2 rounded-full", paused ? "bg-muted-foreground" : "animate-pulse bg-success")} aria-hidden />
          <span data-testid="live-updated">{board ? `Live · ${board.zone_now} ${board.zone}` : "Loading…"}
            {updated && ` · updated ${updated.toLocaleTimeString()}`}</span>
          {board && !board.consistency.expected_equals_present_plus_on_duty_plus_absent && (
            <Badge tone="warning">Figures are being recalculated</Badge>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)} data-testid="live-pause">
          {paused ? <><Play className="h-3.5 w-3.5" aria-hidden /> Resume</> : <><Pause className="h-3.5 w-3.5" aria-hidden /> Pause</>}
        </Button>
      </div>
      {!board ? <Skeleton className="h-24" /> : (
        <div className="flex flex-wrap gap-2" data-testid="live-tiles">
          {board.tiles.map((t, i) => <TileCard key={t.key} tile={t} index={i} active={activeTile === t.key} onClick={() => pickTile(t)} />)}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code" className="ps-9"
              aria-label="Search by name or code" data-testid="live-search" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
            {QUICK.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" aria-pressed={quick === key} data-testid={`live-quick-${key}`}
                onClick={() => { setActiveTile(null); setStatus([]); setSkip(0); setQuick(quick === key ? null : key); }}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  quick === key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60")}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                {board && key !== "late" && key !== "not_in" && (
                  <span className="tabular-nums opacity-80">{key === "in_office" ? (board.counts.WORKING + board.counts.ON_LUNCH)
                    : key === "remote" ? board.counts.IN_FIELD : board.counts.ON_LUNCH}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <AnimatePresence mode="popLayout">
          <motion.div key={`${quick}-${status.join()}-${q}`} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <DataTable rows={board?.items} loading={!board} busy={busy && !!board} rowKey={(r) => r.employee_id} columns={columns} cardBelowMd
              caption="Live board"
              empty={<EmptyState icon={<Users />} title={q || quick || status.length ? "No one matches these filters" : "No one in this selection today"}
                description="Clear the filters or pick another tile." />} />
          </motion.div>
        </AnimatePresence>
        {board && <Pagination total={board.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
    </div>
  );
}
