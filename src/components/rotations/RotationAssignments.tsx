"use client";

import { CalendarX2, MoreHorizontal, Repeat, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import {
  rotationsApi, type RotationAssignBody, type RotationAssignment, type RotationPattern, type RotationVersion,
} from "@/components/rosters/api";
import { EmployeePicker } from "@/components/shared/EmployeePicker";
import { addDays, todayIn } from "@/components/shifts/shiftModel";
import { teamsApi } from "@/components/teams/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { DropdownMenu, MenuItem, Modal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { useModalRoute } from "@/lib/useModalRoute";

import { RotationErrorNotice } from "./RotationParts";
import { versionCrews } from "./rotationModel";

/** The ACTIVE version of a pattern (assignments need one; §2.5). */
export function activeVersion(pattern: RotationPattern | null | undefined): RotationVersion | null {
  return pattern?.versions.find((v) => v.id === pattern.current_version_id && v.status === "ACTIVE") ?? null;
}

const MAX_PEOPLE = 100;

/* ------------------------------------------------------------------ list */

/**
 * Rotation assignments (03-shifts/02 §3.3; list key `shift.rotation_assignments`): person, pattern version, crew,
 * offset, anchor, dates, auto publish and status. One pattern's on its editor page, every pattern's on the list page.
 */
export function AssignmentsList({ patternId, refresh = 0, canAssign, onAssign }: {
  patternId?: number;
  refresh?: number;
  canAssign: boolean;
  onAssign?: () => void;
}) {
  const [skip, setSkip] = useState(0);
  const [ending, setEnding] = useState<RotationAssignment | null>(null);
  const limit = 50;
  const { data, error, loading, reload } = useApi(() => rotationsApi.assignments({ pattern_id: patternId, skip, limit }),
    [patternId, skip, refresh]);
  const personOf = (a: RotationAssignment) => a.employee_name ?? (a.employee_id ? `Employee #${a.employee_id}` : `Team #${a.team_id}`);
  const columns: Column<RotationAssignment>[] = [
    { key: "person", header: "Person", primary: true, cell: (a) => (
      <span>{personOf(a)}
        {a.employee_code && <span className="ms-1 text-xs text-muted-foreground">{a.employee_code}</span>}</span>
    ) },
    ...(patternId ? [] : [{ key: "pattern", header: "Pattern", cell: (a: RotationAssignment) => (
      <Link href={`/attendance/rotations/${a.pattern_id}?tab=assignments`} className="font-mono font-semibold hover:underline">
        {a.pattern_code}</Link>
    ) }]),
    { key: "version", header: "Version", cell: (a) => `v${a.version_no}` },
    { key: "crew", header: "Crew", cell: (a) => a.crew_code ?? "—" },
    { key: "offset", header: "Offset", hideOnMobile: true, cell: (a) => `${a.offset_days} ${a.offset_days === 1 ? "day" : "days"}` },
    { key: "anchor", header: "Anchor", hideOnMobile: true, cell: (a) => fmtDate(a.anchor_date) },
    { key: "effective", header: "Effective", cell: (a) => `${fmtDate(a.effective_from)} – ${a.effective_to ? fmtDate(a.effective_to) : "open-ended"}` },
    { key: "auto", header: "Auto publish", cell: (a) => (a.auto_publish ? <Badge tone="primary">Yes</Badge> : "No") },
    { key: "status", header: "Status", cell: (a) => (
      <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"} dot>{a.status === "ACTIVE" ? "Active" : "Ended"}</Badge>
    ) },
    ...(canAssign ? [{ key: "actions", header: <span className="sr-only">Actions</span>, cell: (a: RotationAssignment) => (
      a.status === "ACTIVE" ? (
        <DropdownMenu trigger={
          <Button variant="ghost" size="icon" aria-label={`More actions for ${personOf(a)}`} data-testid={`assignment-menu-${a.id}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>}>
          <MenuItem icon={<CalendarX2 />} onSelect={() => setEnding(a)}>End assignment…</MenuItem>
        </DropdownMenu>
      ) : null
    ) }] : []),
  ];
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  return (
    <>
      <DataTable columns={columns} rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(a) => a.id}
        cardBelowMd caption="Rotation assignments"
        empty={<EmptyState icon={<Repeat />} title="No one follows this rotation yet"
          description={canAssign ? "Assign people or a crew team to start their cycle on an anchor date." : "Assignments appear here once a planner adds them."}
          action={canAssign && onAssign ? <Button variant="secondary" onClick={onAssign}>Assign rotation…</Button> : undefined} />} />
      {data && data.total > limit && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
      <EndAssignmentModal assignment={ending} person={ending ? personOf(ending) : ""} onClose={() => setEnding(null)}
        onEnded={() => { setEnding(null); void reload(); }} />
    </>
  );
}

/**
 * `⋯ End assignment` (UA-AS-161): the last day the rotation applies and a reason. The assignment becomes ENDED; its
 * unpublished rotation drafts after that day are removed, published schedules never change.
 */
export function EndAssignmentModal({ assignment, person, onClose, onEnded }: {
  assignment: RotationAssignment | null;
  person: string;
  onClose: () => void;
  onEnded: () => void;
}) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const [last, setLast] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (!assignment) return;
    const start = assignment.effective_from;
    const end = assignment.effective_to;
    const proposed = today < start ? start : today;
    setLast(end && end < proposed ? end : proposed);
    setReason("");
    setErrors({});
    setError(null);
    setKey(newIdempotencyKey());
  }, [assignment, today]);
  if (!assignment) return null;

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!last) found.last = "Choose the last day.";
    else if (last < assignment.effective_from) found.last = `Choose ${fmtDate(assignment.effective_from)} or later.`;
    else if (assignment.effective_to && last > assignment.effective_to) {
      found.last = `It already ends ${fmtDate(assignment.effective_to)}; choose that day or earlier.`;
    }
    if (!reason.trim()) found.reason = "Give a reason.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await rotationsApi.endAssignment(assignment.id,
        { effective_to: last, reason: reason.trim(), row_version: assignment.row_version }, key);
      toast.success(`Assignment ends ${fmtDate(last)}. Unpublished drafts after it were removed.`);
      onEnded();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="End assignment"
      description={`${person} stops following ${assignment.pattern_code} v${assignment.version_no} after the last day.`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="end-submit" loading={busy} disabled={busy} onClick={() => void submit()}>End assignment</Button>
      </>}>
      <div className="space-y-4" data-testid="end-assignment">
        <RotationErrorNotice error={error} />
        <Field label="Last day" required error={errors.last}
          hint="Unpublished rotation drafts after this day are removed. Published schedules don't change.">
          <Input type="date" value={last} min={assignment.effective_from} max={assignment.effective_to ?? undefined}
            onChange={(e) => setLast(e.target.value)} />
        </Field>
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ assign form */

interface Person { id: number; full_name: string }
type Target = "PEOPLE" | "TEAM";

/**
 * Assign rotation (`?modal=rotation-assign`, overlay `rotation-assign`; §3.3): the active version of a pattern, people
 * (up to 100) or a crew team's current members, crew and offset, anchor, effective dates and `auto_publish`.
 * A crew team is expanded into its members here: the API stores one assignment per employee.
 */
export function RotationAssignModal({ pattern, patterns = [], onDone }: {
  pattern?: RotationPattern | null;
  patterns?: RotationPattern[];
  onDone?: () => void;
}) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("rotation-assign", { keys: ["pattern"], dirty });
  const assignable = useMemo(() => (pattern ? [pattern] : patterns).filter((p) => activeVersion(p)), [pattern, patterns]);
  const [patternId, setPatternId] = useState("");
  const [target, setTarget] = useState<Target>("PEOPLE");
  const [people, setPeople] = useState<Person[]>([]);
  const [teamId, setTeamId] = useState("");
  const [crew, setCrew] = useState("");
  const [offset, setOffset] = useState("0");
  const [anchor, setAnchor] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const open = route.open;
  const preset = route.param("pattern");
  const teams = useApi(() => (open && target === "TEAM"
    ? teamsApi.list({ team_type: "CREW", status: "ACTIVE", limit: 100 }).then((p) => p.items).catch(() => [])
    : Promise.resolve(null)), [open, target]);

  useEffect(() => {
    if (!open) return;
    setPatternId(pattern ? String(pattern.id) : preset ?? (assignable.length === 1 ? String(assignable[0].id) : ""));
    setTarget("PEOPLE");
    setPeople([]);
    setTeamId("");
    setCrew("");
    setOffset("0");
    setAnchor(today);
    setFrom(today);
    setTo("");
    setAutoPublish(false);
    setErrors({});
    setError(null);
    setKey(newIdempotencyKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset, today, pattern?.id]);
  useEffect(() => setDirty(open && (people.length > 0 || !!teamId)), [open, people.length, teamId]);

  if (!open) return null;
  const chosen = assignable.find((p) => String(p.id) === patternId) ?? null;
  const version = activeVersion(chosen);
  const crews = version ? versionCrews(version) : [];
  const rowMode = !!version?.crew_rows && Object.keys(version.crew_rows).length > 0;
  const length = version?.cycle_days ?? 0;
  const name = (id: number) => people.find((p) => p.id === id)?.full_name ?? `Employee #${id}`;

  const pickCrew = (code: string) => {
    setCrew(code);
    const found = crews.find((c) => c.code === code);
    setOffset(String(found ? found.offset : 0));
  };

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!version) found.pattern = "Choose a rotation with an active version.";
    if (target === "PEOPLE" && !people.length) found.people = "Add at least one person.";
    if (target === "TEAM" && !teamId) found.team = "Choose a crew team.";
    if (target === "TEAM" && !crew) found.crew = "Choose the crew this team follows.";
    if (rowMode && !crew) found.crew = "Choose a crew: each crew has its own row in this pattern.";
    const n = Number(offset);
    if (offset === "" || !Number.isInteger(n) || n < 0 || (length && n >= length)) {
      found.offset = `Enter a whole number from 0 to ${Math.max(length - 1, 0)}.`;
    }
    if (!anchor) found.anchor = "Choose the anchor date (day 1 of the cycle).";
    if (!from) found.from = "Choose the first day.";
    if (to && from && to < from) found.to = "The last day can't be before the first day.";
    return found;
  };

  const submit = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length || !version) return;
    setBusy(true);
    setError(null);
    try {
      let ids = people.map((p) => p.id);
      if (target === "TEAM") {
        const members = await teamsApi.members(teamId, { state: "ACTIVE" });
        ids = [...new Set(members.items.map((m) => m.employee_id))];
        if (!ids.length) throw new Error("This crew team has no current members.");
        if (ids.length > MAX_PEOPLE) throw new Error(`Assign at most ${MAX_PEOPLE} people at a time.`);
      }
      const body: RotationAssignBody = {
        pattern_version_id: version.id, employee_ids: ids, crew_code: crew || null, offset_days: Number(offset),
        anchor_date: anchor, effective_from: from, effective_to: to || null, auto_publish: autoPublish,
      };
      const done = await rotationsApi.assign(body, key);
      const count = done.items.length;
      toast.success(`Rotation assigned to ${count} ${count === 1 ? "person" : "people"}.`);
      setDirty(false);
      await route.close({ force: true });
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={route.onOpenChange} size="lg" title="Assign rotation"
      description="People start the cycle on its anchor date; a person's offset moves them along the cycle."
      footer={<>
        <Button variant="secondary" onClick={() => void route.close()}>Cancel</Button>
        <Button data-testid="assign-submit" loading={busy} disabled={busy || !version} onClick={() => void submit()}>Assign rotation</Button>
      </>}>
      <div className="space-y-4" data-testid="rotation-assign">
        <RotationErrorNotice error={error} nameOf={name} />
        {pattern ? (
          <p className="text-sm">
            <span className="font-mono font-semibold">{pattern.code}</span> · {pattern.name}
            {version ? <> · v{version.version_no} (active)</> : null}
          </p>
        ) : (
          <Field label="Rotation" required error={errors.pattern}>
            <Select value={patternId} onChange={(e) => { setPatternId(e.target.value); setCrew(""); setOffset("0"); }}>
              <option value="">Choose a rotation…</option>
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} (v{activeVersion(p)?.version_no})</option>)}
            </Select>
          </Field>
        )}
        {!version && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm" data-testid="no-active-version">
            {assignable.length ? "Choose a rotation to assign." : "Activate a version of a rotation before assigning it."}
          </p>
        )}
        <Segmented label="Assign to" value={target} onChange={(t) => { setTarget(t); setErrors({}); }}
          options={[{ value: "PEOPLE", label: "People" }, { value: "TEAM", label: "Crew team" }]} />
        {target === "PEOPLE" ? (
          <div className="space-y-2">
            <Field label="Add people" error={errors.people} hint={`Up to ${MAX_PEOPLE} people.`}>
              <EmployeePicker value={null} excludeIds={people.map((p) => p.id)}
                onChange={(p) => p && people.length < MAX_PEOPLE && setPeople([...people, { id: p.id, full_name: p.full_name }])} />
            </Field>
            <p className="text-sm" aria-live="polite">{people.length} selected</p>
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                  {p.full_name}
                  <button type="button" aria-label={`Remove ${p.full_name}`} className="inline-flex h-6 w-6 items-center justify-center"
                    onClick={() => setPeople(people.filter((x) => x.id !== p.id))}>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Field label="Crew team" required error={errors.team}
            hint="Each current member gets their own assignment; people who join the team later are assigned separately.">
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{teams.loading ? "Loading teams…" : "Choose a crew team…"}</option>
              {(teams.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Crew" required={rowMode || target === "TEAM"} error={errors.crew}
            hint={rowMode ? "Each crew follows its own row." : "Picking a crew fills in its offset."}>
            <Select value={crew} onChange={(e) => pickCrew(e.target.value)} disabled={!version}>
              <option value="">{rowMode ? "Choose a crew…" : "No crew"}</option>
              {crews.map((c) => <option key={c.code} value={c.code}>{rowMode ? c.code : `${c.code} (offset ${c.offset})`}</option>)}
            </Select>
          </Field>
          <Field label="Offset (days)" error={errors.offset}
            hint={length ? `The cycle day the person is on at the anchor date: 0 to ${length - 1}.` : undefined}>
            <Input type="number" inputMode="numeric" min={0} max={length ? length - 1 : undefined} value={offset}
              onChange={(e) => setOffset(e.target.value)} disabled={!version} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Anchor date" required error={errors.anchor} hint="Day 1 of the cycle.">
            <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
          <Field label="From" required error={errors.from} hint={`At most 7 days back (${fmtDate(addDays(today, -7))}).`}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (optional)" error={errors.to}>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Publish automatically"
          hint="Every day the rotation is published ahead for dates that have no schedule yet. Working-time rules still apply.">
          <Switch checked={autoPublish} onChange={setAutoPublish} />
        </Field>
      </div>
    </Modal>
  );
}
