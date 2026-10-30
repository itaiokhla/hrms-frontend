"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DetailGate, NotFoundState, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import {
  rotationsApi, type RotationPattern, type RotationTemplate, type RotationVersion, type RuleResult,
} from "@/components/rosters/api";
import { useShiftOptions } from "@/components/shifts/AssignmentRuleForm";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, TabPanel, Tabs } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { can } from "@/lib/access";
import { ATTENDANCE_TABS, isIdSegment, visibleTabs } from "@/lib/attendance-routes";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";
import type { Shift } from "@/lib/types";
import { useModalRoute } from "@/lib/useModalRoute";
import { useTabParam } from "@/lib/useTabParam";

import { AssignmentsList, RotationAssignModal, activeVersion } from "./RotationAssignments";
import { CycleGrid, LastAutoPublishRun, LintList, RotationErrorNotice, VersionBadge } from "./RotationParts";
import {
  OFF_TOKEN, WEEKDAYS, blankDraft, cleanTokens, cycleLength, draftBody, draftFromTemplate, draftFromVersion, lintLabel,
  switchMode, usedTokens, validateDraft, versionCrews, versionStatusLabel, type DraftValues, type RowMode,
} from "./rotationModel";
import { useRotationTemplates } from "./RotationsWorkspace";

type EditorTab = "details" | "assignments";

const shiftLabel = (s: Shift | undefined, id: number) => (s ? `${s.code ?? s.name} · ${s.name}` : `Shift #${id}`);

function coverageText(coverage: Record<string, number> | null | undefined): string | null {
  const entries = Object.entries(coverage ?? {});
  if (!entries.length) return null;
  return entries.map(([token, n]) => `${token} ${n} ${n === 1 ? "crew" : "crews"}`).join(" · ");
}

/* ------------------------------------------------------------------ read-only version */

function VersionView({ version, shifts }: { version: RotationVersion; shifts: Map<number, Shift> }) {
  const draft = draftFromVersion(version);
  const tokens = usedTokens(draft);
  const coverage = coverageText(version.coverage);
  return (
    <div className="space-y-4" data-testid="version-view">
      <CycleGrid draft={draft} caption={`Version ${version.version_no} by crew and cycle day`} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {tokens.map((t) => {
          const target = version.token_map?.[t];
          return (
            <div key={t}>
              <dt className="text-xs text-muted-foreground">Letter {t}</dt>
              <dd className="mt-0.5">{target === "OFF" ? "Off (rest day)" : target ? shiftLabel(shifts.get(target.shift_id), target.shift_id) : "Not mapped"}</dd>
            </div>
          );
        })}
        <div><dt className="text-xs text-muted-foreground">Letter {OFF_TOKEN}</dt><dd className="mt-0.5">Off (always)</dd></div>
        {coverage && <div><dt className="text-xs text-muted-foreground">Coverage</dt><dd className="mt-0.5">{coverage}</dd></div>}
        {version.lints_muted.length > 0 && (
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Muted warnings</dt>
            <dd className="mt-0.5">{version.lints_muted.map(lintLabel).join(", ")}</dd></div>
        )}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ draft editor */

/**
 * The draft editor (§2.1-§2.4): rows (one base row with crew offsets, or one row per crew), the letter → shift map,
 * the week anchor weekday and muted warnings. A save adds a new DRAFT version (the API never edits a version in
 * place); a saved, unchanged draft can be activated. Structural refusals come back from the API and are listed.
 */
export function DraftEditor({ pattern, initial, draftVersion, template, shifts, activeAssignments, lints, onSaved, onActivated,
  onDiscard }: {
  pattern: RotationPattern;
  initial: DraftValues;
  /** The saved DRAFT being edited (activate it when unchanged); null for a new draft. */
  draftVersion: RotationVersion | null;
  template: RotationTemplate | null;
  shifts: Shift[];
  activeAssignments: number;
  lints: RuleResult[] | null;
  onSaved: (version: RotationVersion, lints: RuleResult[]) => void;
  onActivated: () => void;
  onDiscard?: () => void;
}) {
  const confirm = useConfirm();
  const [values, setValues] = useState<DraftValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const dirty = JSON.stringify(draftBody(values)) !== JSON.stringify(draftBody(initial));
  const length = cycleLength(values);
  const tokens = usedTokens(values);
  const current = activeVersion(pattern);
  const nextNo = Math.max(0, ...pattern.versions.map((v) => v.version_no)) + 1;
  const active = shifts.filter((s) => s.status !== "ARCHIVED");
  const update = (next: DraftValues) => {
    setValues(next);
    setErrors({});
  };

  const save = async () => {
    const found = validateDraft(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await rotationsApi.addVersion(pattern.id, draftBody(values), newIdempotencyKey());
      toast.success(`Draft v${saved.version_no} saved.`);
      onSaved(saved, saved.lints ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!draftVersion) return;
    const n = draftVersion.version_no;
    const message = current
      ? `v${current.version_no} becomes superseded. ${activeAssignments} active ${activeAssignments === 1 ? "assignment stays" : "assignments stay"} on v${current.version_no} until you move ${activeAssignments === 1 ? "it" : "them"}; drafts are regenerated from the version each assignment uses.`
      : "It can then be assigned to people and crew teams.";
    const ok = await confirm({ title: `Activate v${n}?`, message, confirmLabel: "Activate", tone: "primary" });
    if (!ok) return;
    setActivating(true);
    setError(null);
    try {
      await rotationsApi.activate(pattern.id, n, newIdempotencyKey());
      toast.success(`Version ${n} is active.`);
      onActivated();
    } catch (err) {
      setError(err);
    } finally {
      setActivating(false);
    }
  };

  const setOffset = (n: number, patch: Partial<{ code: string; offset: string }>) =>
    update({ ...values, crewOffsets: values.crewOffsets.map((c, i) => (i === n ? { ...c, ...patch } : c)) });
  const setRow = (n: number, patch: Partial<{ code: string; row: string }>) =>
    update({ ...values, crewRows: values.crewRows.map((r, i) => (i === n ? { ...r, ...patch } : r)) });
  const nextCode = () => {
    const taken = new Set([...values.crewOffsets.map((c) => c.code), ...values.crewRows.map((r) => r.code)]);
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((c) => !taken.has(c)) ?? "";
  };

  return (
    <section aria-labelledby="draft-heading" className="space-y-5" data-testid="draft-editor">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="draft-heading" className="text-base font-semibold">
            {draftVersion ? `Draft v${draftVersion.version_no}` : `New draft (will be v${nextNo})`}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {draftVersion
              ? `Saving your changes adds draft v${nextNo}; v${draftVersion.version_no} stays as it is.`
              : "Saving adds a draft version. Activate it to assign it."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onDiscard && <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>}
          {dirty && !onDiscard && <Button variant="ghost" onClick={() => { setValues(initial); setErrors({}); setError(null); }}>Undo changes</Button>}
          <Button variant="secondary" data-testid="save-draft" loading={saving} disabled={saving || (!dirty && !!draftVersion)}
            onClick={() => void save()}>Save draft</Button>
          {draftVersion && (
            <Button data-testid="activate-version" loading={activating} disabled={activating || dirty}
              title={dirty ? "Save the draft first." : undefined} onClick={() => void activate()}>
              Activate v{draftVersion.version_no}
            </Button>
          )}
        </div>
      </div>
      {draftVersion && dirty && <p className="text-sm text-muted-foreground" role="status">Save the draft first to activate it.</p>}

      <RotationErrorNotice error={error} />

      <Segmented<RowMode> label="Rows" value={values.mode} onChange={(mode) => update(switchMode(values, mode))}
        options={[{ value: "BASE", label: "One row, shifted per crew" }, { value: "ROWS", label: "One row per crew" }]} />

      {values.mode === "BASE" ? (
        <div className="space-y-3">
          <Field label="Cycle" required error={errors.tokens}
            hint={`${length} ${length === 1 ? "day" : "days"}. One letter per day; ${OFF_TOKEN} is a day off.`}>
            <Input className="font-mono tracking-wider" value={values.tokens} maxLength={366} autoComplete="off" spellCheck={false}
              onChange={(e) => update({ ...values, tokens: cleanTokens(e.target.value) })} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-foreground/90">Crews and offsets (days into the cycle)</legend>
            {values.crewOffsets.map((c, n) => (
              <div key={n} className="space-y-1">
                <div className="flex items-end gap-2">
                  <Field label={`Crew ${n + 1}`} className="w-24"><Input value={c.code} maxLength={8} onChange={(e) => setOffset(n, { code: e.target.value.toUpperCase().trim() })} /></Field>
                  <Field label={`Crew ${n + 1} offset`} className="w-32">
                    <Input type="number" inputMode="numeric" min={0} max={Math.max(length - 1, 0)} value={c.offset}
                      onChange={(e) => setOffset(n, { offset: e.target.value })} />
                  </Field>
                  <Button variant="ghost" size="icon" aria-label={`Remove crew ${c.code || n + 1}`}
                    onClick={() => update({ ...values, crewOffsets: values.crewOffsets.filter((_, i) => i !== n) })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                {errors[`crew-${n}`] && <p role="alert" className="text-xs font-medium text-danger">{errors[`crew-${n}`]}</p>}
              </div>
            ))}
            <Button variant="ghost" onClick={() => update({ ...values, crewOffsets: [...values.crewOffsets, { code: nextCode(), offset: "0" }] })}>
              <Plus className="h-4 w-4" aria-hidden /> Add crew
            </Button>
          </fieldset>
        </div>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground/90">Crew rows ({length} days; {OFF_TOKEN} is a day off)</legend>
          {errors.rows && <p role="alert" className="text-xs font-medium text-danger">{errors.rows}</p>}
          {values.crewRows.map((r, n) => (
            <div key={n} className="space-y-1">
              <div className="flex items-end gap-2">
                <Field label={`Crew ${n + 1}`} className="w-24"><Input value={r.code} maxLength={8} onChange={(e) => setRow(n, { code: e.target.value.toUpperCase().trim() })} /></Field>
                <Field label={`Row of crew ${n + 1}`} className="min-w-0 flex-1">
                  <Input className="font-mono tracking-wider" value={r.row} maxLength={366} autoComplete="off" spellCheck={false}
                    onChange={(e) => setRow(n, { row: cleanTokens(e.target.value) })} />
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Remove crew ${r.code || n + 1}`}
                  onClick={() => update({ ...values, crewRows: values.crewRows.filter((_, i) => i !== n) })}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              {errors[`row-${n}`] && <p role="alert" className="text-xs font-medium text-danger">{errors[`row-${n}`]}</p>}
            </div>
          ))}
          <Button variant="ghost" onClick={() => update({ ...values, crewRows: [...values.crewRows, { code: nextCode(), row: "" }] })}>
            <Plus className="h-4 w-4" aria-hidden /> Add crew
          </Button>
        </fieldset>
      )}

      <CycleGrid draft={values} caption="Cycle by crew and cycle day" />

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium text-foreground/90">What each letter means</legend>
        {tokens.length === 0 && <p className="text-sm text-muted-foreground">Add working letters to the cycle to map them to shifts.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {tokens.map((t) => {
            const times = template?.default_shifts?.[t];
            return (
              <Field key={t} label={`Letter ${t}`} required error={errors[`map-${t}`]}
                hint={times ? `Template time ${String(times.start).slice(0, 5)}–${String(times.end).slice(0, 5)}` : undefined}>
                <Select value={values.tokenMap[t] ?? ""} onChange={(e) => update({ ...values, tokenMap: { ...values.tokenMap, [t]: e.target.value } })}>
                  <option value="">Choose a shift…</option>
                  <option value="OFF">Off (rest day)</option>
                  {active.map((s) => <option key={s.id} value={s.id}>{shiftLabel(s, s.id)}</option>)}
                </Select>
              </Field>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day 1 falls on" hint="Lines up weekly hours; leave as any day when it doesn't matter.">
          <Select value={values.weekAnchorWeekday} onChange={(e) => update({ ...values, weekAnchorWeekday: e.target.value })}>
            <option value="">Any day</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
        </Field>
        {coverageText(values.coverage) && (
          <div className="text-sm">
            <p className="text-[13px] font-medium text-foreground/90">Coverage</p>
            <p className="mt-2 text-muted-foreground">{coverageText(values.coverage)} on every day of the cycle.</p>
          </div>
        )}
      </div>

      <section aria-labelledby="lints-heading" className="space-y-2">
        <h4 id="lints-heading" className="text-sm font-semibold">Fatigue checks</h4>
        {lints ? (
          <LintList lints={lints} muted={values.lintsMuted} disabled={saving}
            onToggleMute={(key, mute) => update({ ...values,
              lintsMuted: mute ? [...values.lintsMuted, key] : values.lintsMuted.filter((k) => k !== key) })} />
        ) : (
          <p className="text-sm text-muted-foreground">Warnings appear after you save. They never block a save.</p>
        )}
        {values.lintsMuted.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Muted warnings">
            {values.lintsMuted.map((key) => (
              <li key={key} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                Muted: {lintLabel(key)}
                <button type="button" className="ms-1 underline" onClick={() => update({ ...values, lintsMuted: values.lintsMuted.filter((k) => k !== key) })}>
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

/* ------------------------------------------------------------------ pattern panel */

function PatternPanel({ pattern, template, manage, activeAssignments, onChanged }: {
  pattern: RotationPattern;
  template: RotationTemplate | null;
  manage: boolean;
  activeAssignments: number;
  onChanged: () => Promise<unknown>;
}) {
  const all = useShiftOptions("ALL");
  const versions = pattern.versions;
  const current = activeVersion(pattern);
  const preferred = useCallback((list: RotationVersion[]) => {
    const active = list.find((v) => v.id === pattern.current_version_id);
    const newerDraft = [...list].reverse().find((v) => v.status === "DRAFT" && (!active || v.version_no > active.version_no));
    return (newerDraft ?? active ?? list[list.length - 1])?.version_no ?? null;
  }, [pattern.current_version_id]);
  const [selected, setSelected] = useState<number | null>(() => preferred(versions));
  const [newFrom, setNewFrom] = useState<number | null>(null);
  const [lints, setLints] = useState<{ versionNo: number; items: RuleResult[] } | null>(null);
  useEffect(() => {
    if (selected === null || !versions.some((v) => v.version_no === selected)) setSelected(preferred(versions));
  }, [versions, selected, preferred]);
  const version = versions.find((v) => v.version_no === selected) ?? null;
  const crews = version ? versionCrews(version) : [];

  const saved = async (v: RotationVersion, items: RuleResult[]) => {
    setLints({ versionNo: v.version_no, items });
    setNewFrom(null);
    await onChanged();
    setSelected(v.version_no);
  };

  const editorFor = (initial: DraftValues, draftVersion: RotationVersion | null, onDiscard?: () => void) => (
    <DraftEditor key={`${draftVersion?.id ?? "new"}-${newFrom ?? ""}`} pattern={pattern} initial={initial} draftVersion={draftVersion}
      template={template} shifts={all.items} activeAssignments={activeAssignments}
      lints={lints && draftVersion && lints.versionNo === draftVersion.version_no ? lints.items : null}
      onSaved={(v, items) => void saved(v, items)} onActivated={() => void onChanged()} onDiscard={onDiscard} />
  );

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 text-base font-semibold">Pattern</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Name</dt><dd className="mt-1">{pattern.name}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Template</dt><dd className="mt-1">{template?.name ?? (pattern.template_key ?? "Blank")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Version in use</dt>
            <dd className="mt-1">{current ? `v${current.version_no}` : "None active yet"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{pattern.status === "ARCHIVED" ? "Archived" : "Active"}</dd></div>
          {version && <div><dt className="text-xs text-muted-foreground">Cycle (v{version.version_no})</dt><dd className="mt-1">{version.cycle_days} days</dd></div>}
          {version && <div><dt className="text-xs text-muted-foreground">Crews</dt><dd className="mt-1">{crews.map((c) => c.code).join(", ") || "One"}</dd></div>}
          {version && <div><dt className="text-xs text-muted-foreground">Day 1 falls on</dt>
            <dd className="mt-1">{version.week_anchor_weekday == null ? "Any day" : WEEKDAYS[version.week_anchor_weekday]}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">Active assignments</dt><dd className="mt-1">{activeAssignments}</dd></div>
        </dl>
      </Card>

      <Card className="space-y-5 p-5">
        <h2 className="text-base font-semibold">Versions</h2>
        {versions.length === 0 ? (
          manage ? editorFor(template ? draftFromTemplate(template) : blankDraft(), null) : (
            <EmptyState title="No version yet" description="A shift manager maps the pattern's letters to shifts and saves the first draft." />
          )
        ) : (
          <>
            <Segmented label="Version" value={String(selected ?? "")} onChange={(v) => { setSelected(Number(v)); setNewFrom(null); }}
              options={versions.map((v) => ({ value: String(v.version_no), label: `v${v.version_no} · ${versionStatusLabel(v.status)}` }))} />
            {version && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Version {version.version_no}</span>
                <VersionBadge status={version.status} />
                {version.status === "ACTIVE" && <span className="text-muted-foreground">Read-only: changes go into a new version.</span>}
              </div>
            )}
            {version && version.status === "DRAFT" && manage && newFrom === null
              ? editorFor(draftFromVersion(version), version)
              : version && newFrom === version.version_no
                ? editorFor(draftFromVersion(version), null, () => setNewFrom(null))
                : version && (
                  <>
                    {manage && version.status !== "DRAFT" && (
                      <Button variant="secondary" onClick={() => setNewFrom(version.version_no)}>
                        <Plus className="h-4 w-4" aria-hidden /> New version from v{version.version_no}
                      </Button>
                    )}
                    <VersionView version={version} shifts={all.byId} />
                  </>
                )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * `/attendance/rotations/{pattern_id}` (A16 editor page; 09-ui-ux/02 §8.2, 01 §4.3): tabs Pattern (facts, versions,
 * the draft editor and Activate) and Assignments (`?tab=assignments`; "Assign rotation…" opens `rotation-assign`), with
 * the last automatic publish under the title. Edit needs `shift:manage`, assignments `shift:assign`.
 */
export function RotationEditorPage({ id }: { id: string }) {
  const { me } = useCan();
  const valid = isIdSegment(id);
  const { data, error, loading, reload } = useApi(() => (valid ? rotationsApi.get(id) : Promise.resolve(null)), [id]);
  const tabs = visibleTabs(ATTENDANCE_TABS["/attendance/rotations/[pattern_id]"], me);
  const [tab, setTab] = useTabParam<EditorTab>(tabs.map((t) => t.value as EditorTab), "details");
  const [refresh, setRefresh] = useState(0);
  const manage = can(me, P.SHIFT_MANAGE);
  const assign = can(me, P.SHIFT_ASSIGN);
  const assignRoute = useModalRoute("rotation-assign", { keys: ["pattern"] });
  const templates = useRotationTemplates();
  const assignments = useApi(() => (valid ? rotationsApi.assignments({ pattern_id: Number(id), limit: 500 }).catch(() => null)
    : Promise.resolve(null)), [id, refresh]);
  const activeCount = useMemo(() => {
    const current = data?.current_version_id;
    return (assignments.data?.items ?? []).filter((a) => a.status === "ACTIVE" && a.pattern_version_id === current).length;
  }, [assignments.data, data?.current_version_id]);
  const changed = useCallback(async () => {
    setRefresh((n) => n + 1);
    return reload();
  }, [reload]);

  if (!valid) return <NotFoundState what="Rotation" backHref="/attendance/rotations" backLabel="Back to Rotations" />;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Rotation" backHref="/attendance/rotations"
      backLabel="Back to Rotations">
      {data && (
        <div>
          <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              <li><Link href="/attendance/shifts" className="inline-flex min-h-[44px] items-center hover:text-foreground">Shifts</Link></li>
              <li aria-hidden>›</li>
              <li><Link href="/attendance/rotations" className="inline-flex min-h-[44px] items-center hover:text-foreground">Rotations</Link></li>
              <li aria-hidden>›</li>
              <li aria-current="page" className="font-mono font-medium text-foreground">{data.code}</li>
            </ol>
          </nav>
          <WorkspaceHeader eyebrow="Shifts" showHideAmounts={false} title={`Rotation ${data.code}`}
            description={data.name}
            actions={assign && activeVersion(data) ? (
              <Button variant="secondary" onClick={() => assignRoute.openModal()}>Assign rotation…</Button>
            ) : undefined} />
          <LastAutoPublishRun refresh={refresh} />
          <Tabs value={tab} onValueChange={(v) => setTab(v as EditorTab)} tabs={tabs.map((t) => ({ value: t.value, label: t.label }))}>
            <TabPanel value="details">
              <PatternPanel pattern={data} template={data.template_key ? templates.byKey.get(data.template_key) ?? null : null}
                manage={manage} activeAssignments={activeCount} onChanged={changed} />
            </TabPanel>
            <TabPanel value="assignments">
              <Card>
                <AssignmentsList patternId={data.id} refresh={refresh} canAssign={assign}
                  onAssign={activeVersion(data) ? () => assignRoute.openModal() : undefined} />
              </Card>
            </TabPanel>
          </Tabs>
          {assign && <RotationAssignModal pattern={data} onDone={() => setRefresh((n) => n + 1)} />}
        </div>
      )}
    </DetailGate>
  );
}
