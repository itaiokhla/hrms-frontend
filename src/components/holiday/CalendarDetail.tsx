"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarX2, FileUp, Link2, MinusCircle, Pencil, Plus, Power, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Notice, ReasonModal } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  calendarsApi,
  HolidayApiError,
  OBSERVANCE_LABEL,
  WEEKDAYS,
  yearsApi,
  type Calendar,
  type CalendarExclusion,
  type CriteriaAssignment,
  type HolidayRule,
  type YearItem,
} from "@/lib/holiday/api";
import { useModalRoute } from "@/lib/useModalRoute";
import { useTabParam } from "@/lib/useTabParam";

import { BackdatedClosureModal } from "./BackdatedClosureModal";
import { CalendarAssignmentForm } from "./CalendarAssignmentForm";
import { HolidayImportWizard } from "./HolidayImportWizard";
import { CalendarLineageTree } from "./CalendarLineageTree";
import { HistoryTab, OccurrenceModal, RulesTab, WorkingDaysTab, YearBar, YearHolidaysTable } from "./CalendarYearTabs";
import { ASSIGNMENT_MODAL, CALENDAR_MODAL, CalendarForm } from "./CalendarsPage";
import { PublishYearPanel } from "./PublishYearPanel";
import { RuleEditor } from "./RuleEditor";

export const RULE_MODAL = "holiday-rule";
export const PUBLISH_MODAL = "publish-year";
const TABS = ["holidays", "rules", "includes", "exclusions", "working-days", "assignments", "history"] as const;
type Tab = (typeof TABS)[number];

/** An inherited row the calendar can exclude (Holidays tab), with its path from the calendar itself. */
interface Excludable {
  id: number;
  name: string;
  date: string;
  holiday_rule_id: number | null;
  path: string[];
}

interface IncludeRow {
  included_calendar_id: number;
  code: string;
  name: string;
}

/** Priorities by position: the legacy parent keeps 0 while it stays first; everything else 1, 2, … (§3.3 rule 4). */
export function includePriorities(rows: IncludeRow[], parentId: number | null) {
  const parentFirst = parentId !== null && rows[0]?.included_calendar_id === parentId;
  return rows.map((r, i) => ({ included_calendar_id: r.included_calendar_id, priority: parentFirst ? i : i + 1 }));
}

/** Where an inherited holiday comes from: the include path without the calendar itself. */
const via = (h: { path: string[] }) => h.path.slice(1).join(" › ");

function criteriaSummary(criteria: Record<string, unknown>) {
  const parts: string[] = [];
  const count = (key: string, label: string) => {
    const v = criteria[key];
    if (Array.isArray(v) && v.length) parts.push(`${v.length} ${label}${v.length === 1 ? "" : "s"}`);
  };
  count("branch_ids", "branch");
  count("department_ids", "department");
  count("shift_ids", "shift");
  count("legal_entity_ids", "entity");
  if (criteria.hired_on_or_after) parts.push(`joined ≥ ${criteria.hired_on_or_after}`);
  if (criteria.hired_before) parts.push(`joined < ${criteria.hired_before}`);
  return parts.join(" · ") || "Everyone";
}

/**
 * Calendar detail /holidays/calendars/{id} (09-ui-ux/02 §18): header with owner, region, weekend and status;
 * tabs Holidays (flattened year with source and excluded rows), Includes & exclusions (lineage tree + ordered
 * include editor), Exclusions, Assignments (branch links, criteria rows, placement overrides). Edits that touch dates
 * already behind the calendar's today need the publish permission and a reason — the server decides and the page asks.
 */
export function CalendarDetailPage({ id }: { id: number }) {
  const confirm = useConfirm();
  const [tab, setTab] = useTabParam<Tab>(TABS, "holidays");
  const { data, error, reload } = useApi(() => calendarsApi.get(id), [id]);
  const today = data?.local_today ?? new Date().toISOString().slice(0, 10);
  const search = useSearchParams();
  const router = useRouter();
  const [year, setYear] = useState<number | null>(() => Number(search?.get("year")) || null);
  const shownYear = year ?? Number(today.slice(0, 4));
  const version = data?.row_version;

  const lineage = useApi(() => calendarsApi.lineage(id, shownYear), [id, shownYear, version]);
  const holidays = useApi(() => calendarsApi.holidays(id, shownYear), [id, shownYear, version]);
  const assignments = useApi(() => (tab === "assignments" ? calendarsApi.assignments(id) : Promise.resolve(null)), [id, tab, version]);
  const candidates = useApi(() => calendarsApi.list({ status: "ACTIVE", limit: 200 }).then((p) => p.items), [version]);

  const [editDirty, setEditDirty] = useState(false);
  const editModal = useModalRoute(CALENDAR_MODAL, { dirty: editDirty });
  const [assignDirty, setAssignDirty] = useState(false);
  const assignModal = useModalRoute(ASSIGNMENT_MODAL, { dirty: assignDirty });
  const editingAssignment: CriteriaAssignment | undefined = useMemo(() => {
    const aid = Number(assignModal.id);
    return aid ? assignments.data?.criteria.find((a) => a.id === aid) : undefined;
  }, [assignModal.id, assignments.data]);

  const [tick, setTick] = useState(0);
  const yearView = useApi(() => yearsApi.year(id, shownYear), [id, shownYear, version, tick]);
  const [ruleDirty, setRuleDirty] = useState(false);
  const ruleModal = useModalRoute(RULE_MODAL, { dirty: ruleDirty });
  const editingRule = useApi(
    () => (ruleModal.open && ruleModal.id ? yearsApi.rule(Number(ruleModal.id)) : Promise.resolve(null as HolidayRule | null)),
    [ruleModal.open, ruleModal.id],
  );
  const publishModal = useModalRoute(PUBLISH_MODAL);
  // Goal 5: modal `import-holidays` (02 §9.1) and the emergency / backdated closure (01 §5.8).
  const [importDirty, setImportDirty] = useState(false);
  const importModal = useModalRoute("import-holidays", { keys: ["calendar_id", "year"], dirty: importDirty });
  const [closureOpen, setClosureOpen] = useState(false);
  const closureDate = search?.get("closure");
  const [generating, setGenerating] = useState(false);
  const [affected, setAffected] = useState<number[]>([]);
  const [applying, setApplying] = useState<number | null>(null);
  const [excluding, setExcluding] = useState<Excludable | null>(null);
  const [excludeWholeRule, setExcludeWholeRule] = useState(false);
  const [restoring, setRestoring] = useState<CalendarExclusion | null>(null);
  const [occurrenceOpen, setOccurrenceOpen] = useState(false);
  // Switch tabs only once the modal's own URL change has landed (both rewrite the query string).
  const [tabAfterClose, setTabAfterClose] = useState<Tab | null>(null);
  useEffect(() => {
    if (tabAfterClose && !assignModal.open && !ruleModal.open && !publishModal.open) {
      setTab(tabAfterClose);
      setTabAfterClose(null);
    }
  }, [tabAfterClose, assignModal.open, ruleModal.open, publishModal.open, setTab]);

  if (error) return <ErrorState message={error.status === 404 ? "This calendar doesn't exist or you can't see it." : error.message} onRetry={() => void reload()} />;
  if (!data) return <Skeleton className="h-96 w-full" />;

  const refresh = () => {
    void reload();
    void lineage.reload();
    void holidays.reload();
    void assignments.reload();
    setTick((t) => t + 1);
  };
  const generate = async () => {
    setGenerating(true);
    try {
      const result = await yearsApi.generate(data.id, shownYear);
      const c = result.counts;
      toast.success(`${shownYear} draft: ${c.inserted ?? 0} added, ${c.updated ?? 0} changed, ${c.deleted ?? 0} removed`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  };
  const discard = async () => {
    if (!(await confirm({ title: `Discard the ${shownYear} draft?`, message: "Its rows are deleted; published years are not affected.", confirmLabel: "Discard", tone: "danger" }))) return;
    try {
      await yearsApi.discard(data.id, shownYear);
      toast.success(`${shownYear} draft discarded`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const setStatus = async (status: "ACTIVE" | "INACTIVE") => {
    if (status === "INACTIVE" && !(await confirm({ title: `Deactivate ${data.name}?`, message: "It can no longer be included, linked or assigned.", confirmLabel: "Deactivate", tone: "danger" }))) return;
    try {
      await calendarsApi.update(data.id, { status }, data.row_version);
      toast.success(status === "INACTIVE" ? "Calendar deactivated" : "Calendar activated");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <Link href="/holidays/calendars" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Calendars
      </Link>
      <PageHeader
        eyebrow={`Holidays › Calendars › ${data.code}`}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <Badge tone="primary">{data.owner}</Badge>
            {(data.subdivision_code || data.country_code) && <Badge tone="neutral">{data.subdivision_code ?? data.country_code}</Badge>}
            <Badge tone={data.status === "ACTIVE" ? "success" : "neutral"} dot>
              {data.status === "ACTIVE" ? "Active" : "Inactive"}
            </Badge>
          </span>
        }
        description={
          <>
            Weekend {data.effective_weekend.map((d) => WEEKDAYS[d]).join(", ")}
            {data.weekend_days ? "" : " (derived)"} · Observance {OBSERVANCE_LABEL[data.employee_observance].toLowerCase()} · Used by {data.used_by.employees} people
            {data.used_by.branches ? `, ${data.used_by.branches} branches` : ""}
          </>
        }
        actions={
          data.can_manage && (
            <>
              {data.status === "ACTIVE" ? (
                <span title={data.in_use ? `In use by ${data.in_use}` : undefined}>
                  <Button variant="danger-ghost" disabled={!!data.in_use} onClick={() => void setStatus("INACTIVE")}>
                    <Power className="h-4 w-4" /> Deactivate
                  </Button>
                </span>
              ) : (
                <Button variant="secondary" onClick={() => void setStatus("ACTIVE")}>
                  Activate
                </Button>
              )}
              <Button variant="secondary" onClick={() => editModal.openModal()}>
                <Pencil className="h-4 w-4" /> Edit details
              </Button>
              <Button variant="secondary" onClick={() => importModal.openModal({ calendar_id: data.id, year: shownYear })} data-testid="import-holidays">
                <FileUp className="h-4 w-4" /> Import holidays
              </Button>
              {yearView.data?.can_publish && (
                <Button variant="danger-ghost" onClick={() => setClosureOpen(true)} data-testid="record-closure">
                  <CalendarX2 className="h-4 w-4" /> Record a closure
                </Button>
              )}
              <Button onClick={() => assignModal.openModal()} data-testid="assign-calendar">
                <Link2 className="h-4 w-4" /> Assign…
              </Button>
            </>
          )
        }
      />
      {data.can_manage && data.status === "ACTIVE" && data.in_use && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">Deactivate is unavailable: in use by {data.in_use}.</p>
      )}

      <YearBar
        view={yearView.data}
        years={[-1, 0, 1, 2].map((o) => Number(today.slice(0, 4)) + o)}
        year={shownYear}
        onYear={setYear}
        generating={generating}
        onGenerate={() => void generate()}
        onDiscard={() => void discard()}
        onPublish={() => publishModal.openModal({ year: shownYear })}
        onReviewChange={() => publishModal.openModal({ year: shownYear, mode: "approve-amendment" })}
      />
      {holidays.data && (
        <p className="-mt-2 mb-3 text-sm text-muted-foreground" data-testid="flat-summary">
          {holidays.data.summary.total} holiday{holidays.data.summary.total === 1 ? "" : "s"} · {holidays.data.summary.own} own · {holidays.data.summary.total - holidays.data.summary.own} inherited ·{" "}
          {holidays.data.summary.excluded} excluded <span className="text-xs">(what employees get now)</span>
        </p>
      )}
      {affected.length > 0 && (
        <Notice tone="warning" title={`${affected.join(", ")} ${affected.length > 1 ? "are" : "is"} published: the rule change is not applied there yet.`} className="mb-3">
          <span className="flex flex-wrap gap-2 pt-1">
            {affected.map((y) => (
              <Button key={y} size="sm" variant="secondary" onClick={() => setApplying(y)} data-testid={`apply-rules-${y}`}>
                Review and apply to {y}…
              </Button>
            ))}
          </span>
        </Notice>
      )}

      <Tabs
        tabs={[
          { value: "holidays", label: "Holidays", badge: yearView.data ? yearView.data.summary.own + yearView.data.summary.inherited : undefined },
          { value: "rules", label: "Rules", badge: yearView.data?.summary.rules },
          { value: "includes", label: "Includes" },
          { value: "exclusions", label: "Exclusions", badge: lineage.data?.exclusions.length },
          { value: "working-days", label: "Working days", badge: yearView.data?.working_days.length },
          { value: "assignments", label: "Assignments" },
          { value: "history", label: "History" },
        ]}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      >
        <TabPanel value="holidays">
          <Card className="p-4 sm:p-5">
            {data.can_manage && (
              <div className="mb-3 flex justify-end">
                <Button variant="secondary" onClick={() => setOccurrenceOpen(true)} data-testid="add-occurrence">
                  <Plus className="h-4 w-4" /> Add holiday
                </Button>
              </div>
            )}
            {yearView.error ? (
              <ErrorState message="Couldn't load the year." onRetry={() => void yearView.reload()} />
            ) : (
              <YearHolidaysTable
                calendar={data}
                view={yearView.data}
                onChanged={refresh}
                onExclude={(item: YearItem) =>
                  setExcluding({ id: item.id, name: item.name, date: item.date, holiday_rule_id: item.rule_id, path: [data.code, ...item.path] })
                }
              />
            )}
            {!!holidays.data?.excluded.length && (
              <div className="mt-4" data-testid="excluded-list">
                <p className="mb-2 text-sm font-medium">Excluded here</p>
                <ul className="space-y-1">
                  {holidays.data.excluded.map((h) => (
                    <li key={`${h.id}-${h.date}`} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground line-through decoration-danger/60">
                      <span className="tabular-nums">{fmtDate(h.date)}</span> {h.name} <span className="text-xs no-underline">via {via(h)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="includes">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4 sm:p-5">
              <p className="mb-3 text-sm font-medium">Lineage</p>
              {lineage.data ? <CalendarLineageTree root={lineage.data.tree} year={shownYear} /> : <Skeleton className="h-40 w-full" />}
              {!!lineage.data?.included_by.length && (
                <p className="mt-3 text-xs text-muted-foreground">Included by {lineage.data.included_by.map((c) => c.code).join(", ")}.</p>
              )}
            </Card>
            <Card className="p-4 sm:p-5">
              <IncludesEditor
                key={`${data.id}-${data.row_version}`}
                calendar={data}
                candidates={candidates.data ?? []}
                onSaved={() => {
                  toast.success("Includes saved");
                  refresh();
                }}
              />
            </Card>
          </div>
        </TabPanel>

        <TabPanel value="exclusions">
          <Card className="p-4 sm:p-5">
            {!lineage.data ? (
              <Skeleton className="h-24 w-full" />
            ) : lineage.data.exclusions.length === 0 ? (
              <EmptyState
                icon={<MinusCircle />}
                title="Nothing excluded"
                description="Exclude an inherited holiday from the Holidays tab; the calendar it comes from is not changed."
              />
            ) : (
              <ul className="space-y-2" data-testid="exclusion-list">
                {lineage.data.exclusions.map((x) => (
                  <motion.li key={x.id} layout className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <MinusCircle className="h-4 w-4 text-warning" aria-hidden />
                    {x.holiday ? (
                      <span>
                        <span className="font-medium">{x.holiday.name}</span> {fmtDate(x.holiday.date)}
                        {x.holiday.calendar_code ? <span className="text-muted-foreground"> from {x.holiday.calendar_code}</span> : null}
                      </span>
                    ) : (
                      <span>
                        Rule #{x.holiday_rule_id} from {x.effective_from_year ?? "every year"}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">— {x.reason}</span>
                    {data.can_manage && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRestoring(x)}>
                        <Undo2 className="h-4 w-4" /> Restore
                      </Button>
                    )}
                  </motion.li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="rules">
          <RulesTab
            calendar={data}
            version={tick}
            onAdd={() => ruleModal.openModal()}
            onEdit={(rule) => ruleModal.openModal({ id: rule.id })}
            onChanged={refresh}
          />
        </TabPanel>

        <TabPanel value="working-days">
          <WorkingDaysTab calendar={data} view={yearView.data} onChanged={refresh} />
        </TabPanel>

        <TabPanel value="history">
          <HistoryTab calendar={data} version={tick} />
        </TabPanel>

        <TabPanel value="assignments">
          <AssignmentsTab
            loading={!assignments.data}
            data={assignments.data}
            canManage={data.can_manage}
            onEdit={(a) => assignModal.openModal({ id: a.id })}
          />
        </TabPanel>
      </Tabs>

      {closureDate && (
        <Notice tone="info" title={`Closure recorded for ${fmtDate(closureDate)}. Approved leave on that date is recounted; payroll picks it up per period state.`} className="mb-4" />
      )}
      <Modal open={importModal.open} onOpenChange={importModal.onOpenChange} title={`Import holidays into ${data.code}`} size="xl">
        {importModal.open && (
          <HolidayImportWizard
            calendarId={data.id}
            calendarCode={data.code}
            defaultYear={Number(importModal.param("year")) || shownYear}
            localYear={Number(today.slice(0, 4))}
            onDirty={setImportDirty}
            onDone={() => {
              setTick((t) => t + 1);
              refresh();
            }}
            onCancel={() => void importModal.close()}
          />
        )}
      </Modal>
      <BackdatedClosureModal
        key={closureOpen ? "closure-open" : "closure-closed"}
        open={closureOpen}
        onOpenChange={setClosureOpen}
        calendars={[{ calendar_id: data.id, code: data.code, name: data.name }]}
        defaultCalendarId={data.id}
        today={today}
        onRecorded={(_, day) => {
          setYear(Number(day.slice(0, 4)));
          setTick((t) => t + 1);
          refresh();
          router.replace(`/holidays/calendars/${data.id}?year=${day.slice(0, 4)}&closure=${day}`, { scroll: false });
        }}
      />

      <Modal open={editModal.open} onOpenChange={editModal.onOpenChange} title={`Edit ${data.name}`} size="lg">
        <CalendarForm
          calendar={data}
          onDirtyChange={setEditDirty}
          onCancel={() => void editModal.close()}
          onSaved={() => {
            setEditDirty(false);
            void editModal.close({ force: true }).then(refresh);
          }}
        />
      </Modal>

      <Modal
        open={assignModal.open}
        onOpenChange={assignModal.onOpenChange}
        title={editingAssignment ? "Edit assignment" : `Assign ${data.code}`}
        description="Who follows this calendar, and from when."
        size="lg"
      >
        <CalendarAssignmentForm
          key={editingAssignment?.id ?? "new"}
          calendar={data}
          today={today}
          assignment={editingAssignment}
          onDirtyChange={setAssignDirty}
          onCancel={() => void assignModal.close()}
          onSaved={() => {
            setAssignDirty(false);
            void assignModal.close({ force: true }).then(refresh);
            setTabAfterClose("assignments");
          }}
        />
      </Modal>

      <ReasonModal
        open={!!excluding}
        onOpenChange={(o) => !o && (setExcluding(null), setExcludeWholeRule(false))}
        title={`Exclude ${excluding?.name ?? ""}`}
        consequence={
          <>
            {data.code} stops observing it on {excluding ? fmtDate(excluding.date) : ""}. {excluding ? via(excluding) : ""} keeps it for everyone else.
          </>
        }
        confirmLabel="Exclude"
        danger
        onSubmit={async (reason) => {
          if (!excluding) return;
          const ruleId = excluding.holiday_rule_id;
          await calendarsApi.addExclusion(
            data.id,
            excludeWholeRule && ruleId ? { holiday_rule_id: ruleId, effective_from_year: Number(excluding.date.slice(0, 4)), reason } : { holiday_id: excluding.id, reason },
          );
          toast.success(`${excluding.name} excluded`);
          refresh();
        }}
      >
        {excluding?.holiday_rule_id ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={excludeWholeRule} onChange={(e) => setExcludeWholeRule(e.target.checked)} />
            Every year from {excluding?.date.slice(0, 4)} (the whole recurring holiday)
          </label>
        ) : null}
      </ReasonModal>

      <ReasonModal
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Restore the holiday"
        consequence={<>{restoring?.holiday?.name ?? "The excluded holiday"} comes back to {data.code} from what it includes.</>}
        confirmLabel="Restore"
        optional
        onSubmit={async (reason) => {
          if (!restoring) return;
          await calendarsApi.removeExclusion(data.id, restoring.id, reason || undefined);
          toast.success("Exclusion removed");
          refresh();
        }}
      />

      <OccurrenceModal
        open={occurrenceOpen}
        onOpenChange={setOccurrenceOpen}
        calendar={data}
        view={yearView.data}
        onSaved={() => {
          setOccurrenceOpen(false);
          refresh();
        }}
      />

      <Modal
        open={ruleModal.open}
        onOpenChange={ruleModal.onOpenChange}
        title={ruleModal.id ? "Edit repeating holiday" : "Repeating holiday"}
        description="How the holiday repeats; draft years follow, published years are reviewed separately."
        size="xl"
      >
        {ruleModal.id && !editingRule.data ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <RuleEditor
            key={editingRule.data?.id ?? "new"}
            calendar={data}
            today={today}
            rule={editingRule.data ?? undefined}
            onDirtyChange={setRuleDirty}
            onCancel={() => void ruleModal.close()}
            onSaved={(result) => {
              setRuleDirty(false);
              setAffected(result.published_years_affected);
              void ruleModal.close({ force: true }).then(refresh);
              setTabAfterClose("rules");
            }}
          />
        )}
      </Modal>

      <Modal
        open={publishModal.open}
        onOpenChange={publishModal.onOpenChange}
        title={publishModal.param("mode") === "approve-amendment" ? `Review the change to ${shownYear}` : `Publish ${shownYear} · ${data.code} ${data.name}`}
        size="xl"
      >
        {yearView.data ? (
          <PublishYearPanel
            calendarId={data.id}
            year={yearView.data}
            mode={publishModal.param("mode") === "approve-amendment" ? "approve-amendment" : "publish"}
            onCancel={() => void publishModal.close({ force: true })}
            onDone={() => {
              void publishModal.close({ force: true }).then(refresh);
              setTabAfterClose("holidays");
            }}
          />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </Modal>

      <ReasonModal
        open={applying !== null}
        onOpenChange={(o) => !o && setApplying(null)}
        title={`Apply the rules to ${applying ?? ""}`}
        consequence={<>The dates the rules now give {applying} are added or moved in one amendment; leave on them is recounted.</>}
        confirmLabel="Apply"
        onSubmit={async (reason) => {
          if (applying === null) return;
          const result = await yearsApi.applyRules(data.id, applying, reason);
          toast.success(result.status === "NO_CHANGE" ? `${applying} already matches the rules` : `${applying} amended`);
          setAffected((a) => a.filter((y) => y !== applying));
          refresh();
        }}
      />
    </div>
  );
}

/** The ordered include list (09-ui-ux/02 §18): add, reorder (first wins a same-day clash), remove; reason when the server asks. */
function IncludesEditor({ calendar, candidates, onSaved }: { calendar: Calendar; candidates: Calendar[]; onSaved: () => void }) {
  const initial: IncludeRow[] = (calendar.includes ?? []).map((i) => ({ included_calendar_id: i.included_calendar_id, code: i.code, name: i.name }));
  const [rows, setRows] = useState<IncludeRow[]>(initial);
  const [adding, setAdding] = useState("");
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(rows.map((r) => r.included_calendar_id)) !== JSON.stringify(initial.map((r) => r.included_calendar_id));
  const options = candidates.filter((c) => c.id !== calendar.id && !rows.some((r) => r.included_calendar_id === c.id));

  const move = (i: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row);
    setRows(next);
  };
  const save = async () => {
    setError(null);
    if (needsReason && !reason.trim()) return setError("Give a reason for changing dates that have passed.");
    setSaving(true);
    try {
      await calendarsApi.setIncludes(calendar.id, includePriorities(rows, calendar.parent_calendar_id), reason.trim() || undefined, calendar.row_version);
      onSaved();
    } catch (e) {
      if (e instanceof HolidayApiError && e.code === "REASON_REQUIRED") setNeedsReason(true);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="includes-editor">
      <p className="text-sm font-medium">Includes (first wins a same-day clash)</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Only its own holidays. Include a calendar to inherit its holidays.</p>}
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <motion.li layout key={r.included_calendar_id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm" data-testid={`include-${r.code}`}>
            <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
            <span className="font-mono text-xs font-semibold">{r.code}</span>
            <span className="truncate text-muted-foreground">{r.name}</span>
            {calendar.can_manage && (
              <span className="ml-auto flex gap-0.5">
                <Button size="icon" variant="ghost" aria-label={`Move ${r.code} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Move ${r.code} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Remove ${r.code}`} onClick={() => setRows(rows.filter((x) => x !== r))}>
                  <X className="h-4 w-4" />
                </Button>
              </span>
            )}
          </motion.li>
        ))}
      </ol>
      {calendar.can_manage && (
        <>
          <div className="flex gap-2">
            <Select aria-label="Calendar to include" value={adding} onChange={(e) => setAdding(e.target.value)} data-testid="include-select">
              <option value="">Include a calendar…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={!adding}
              data-testid="include-add"
              onClick={() => {
                const c = candidates.find((x) => x.id === Number(adding));
                if (c) setRows([...rows, { included_calendar_id: c.id, code: c.code, name: c.name }]);
                setAdding("");
              }}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          {needsReason && (
            <Field label="Reason" required hint="This change reaches dates that have passed; it is kept in the audit trail.">
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {error && <Notice tone="danger" title={error} />}
          <div className="flex justify-end gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setRows(initial)}>
                Reset
              </Button>
            )}
            <Button disabled={!dirty} loading={saving} onClick={() => void save()} data-testid="includes-save">
              Save includes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function AssignmentsTab({
  loading,
  data,
  canManage,
  onEdit,
}: {
  loading: boolean;
  data: Awaited<ReturnType<typeof calendarsApi.assignments>> | null | undefined;
  canManage: boolean;
  onEdit: (a: CriteriaAssignment) => void;
}) {
  if (loading || !data) return <Skeleton className="h-40 w-full" />;
  const range = (from: string, to: string | null) => `${fmtDate(from)} – ${to ? fmtDate(to) : "open"}`;
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <p className="mb-2 text-sm font-medium">Branches</p>
        {data.branch_links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No branch follows this calendar.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="branch-links">
            {data.branch_links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="font-medium">{l.branch_name}</span>
                <span className="font-mono text-xs text-muted-foreground">{l.branch_code}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{range(l.effective_from, l.effective_to)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-5">
        <p className="mb-2 text-sm font-medium">Groups of people</p>
        {data.criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground">No criteria rows.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="criteria-rows">
            {data.criteria.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <Badge tone="neutral">priority {a.priority}</Badge>
                <span>{criteriaSummary(a.criteria)}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{range(a.effective_from, a.effective_to)}</span>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => onEdit(a)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.overrides.length > 0 && (
        <Card className="p-4 sm:p-5">
          <p className="mb-2 text-sm font-medium">Placement overrides</p>
          <ul className="space-y-1 text-sm">
            {data.overrides.map((o) => (
              <li key={o.assignment_id}>
                <Link className="hover:underline" href={`/employees/${o.employee_id}`}>
                  Employee #{o.employee_id}
                </Link>{" "}
                <span className="text-muted-foreground">{range(o.effective_from, o.effective_to)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
