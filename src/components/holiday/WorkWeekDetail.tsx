"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CalendarClock, Copy, Power } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DataTable, ErrorState, PageHeader, TabPanel, Tabs, type Column } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { workWeeksApi, type PreviewDay, type WorkWeekVersion } from "@/lib/holiday/api";
import { monthRange } from "@/lib/holiday/workWeekRules";
import { useModalRoute } from "@/lib/useModalRoute";
import { useTabParam } from "@/lib/useTabParam";

import { WorkWeekEditor } from "./WorkWeekEditor";
import { WorkWeekPreview } from "./WorkWeekPreview";
import { WORK_WEEK_MODAL, useEditorData } from "./WorkWeeksPage";

const TABS = ["schedule", "versions", "used-by", "history"] as const;
type Tab = (typeof TABS)[number];
const STATE_TONE = { CURRENT: "success", SCHEDULED: "warning", PAST: "neutral" } as const;

/** 12 mini-months of one year, shading full and half offs (Schedule tab). */
function YearStrip({ days, year }: { days: PreviewDay[]; year: number }) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="year-strip">
      {months.map((m) => {
        const inMonth = days.filter((d) => d.date.startsWith(m));
        const lead = inMonth.length ? inMonth[0].weekday : 0;
        return (
          <div key={m} className="rounded-xl border border-border p-2">
            <p className="mb-1 text-xs font-semibold">
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
            </p>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: lead }, (_, i) => (
                <span key={i} />
              ))}
              {inMonth.map((d) => (
                <span
                  key={d.date}
                  title={`${d.date}: ${d.portion ? (d.portion === "FULL" ? "weekly off" : "half day off") : "working"}`}
                  className={cn(
                    "aspect-square rounded-[3px]",
                    d.portion === "FULL" ? "bg-primary/70" : d.portion ? "bg-warning/70" : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pattern detail /holidays/work-weeks/{id} (04-holiday/03 §5.10): header with kind, owner and status; tabs
 * Schedule (month preview + 12-month strip), Versions, Used by, History; "Change from a date…" posts a new version
 * through the `work-week` modal (`?modal=work-week&id=`), "Duplicate as crew" for cycles, Deactivate when unused.
 */
export function WorkWeekDetailPage({ id }: { id: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tab, setTab] = useTabParam<Tab>(TABS, "schedule");
  const { data, error, reload } = useApi(() => workWeeksApi.get(id), [id]);
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute(WORK_WEEK_MODAL, { dirty });
  const editorData = useEditorData();
  const today = data?.local_today ?? new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month ?? today.slice(0, 7);
  const [year, setYear] = useState<number | null>(null);
  const shownYear = year ?? Number(today.slice(0, 4));
  const [crewOpen, setCrewOpen] = useState(false);
  const [crew, setCrew] = useState({ name: "", offset: 7 });

  const monthPreview = useApi(
    () => (data ? workWeeksApi.preview({ pattern_id: data.id, stored: true, ...monthRange(shownMonth) }) : Promise.resolve(null)),
    [data?.id, data?.row_version, shownMonth],
  );
  const yearPreview = useApi(
    () =>
      data && tab === "schedule"
        ? workWeeksApi.preview({ pattern_id: data.id, stored: true, from: `${shownYear}-01-01`, to: `${shownYear}-12-31` })
        : Promise.resolve(null),
    [data?.id, data?.row_version, shownYear, tab],
  );
  const history = useApi(() => (tab === "history" ? workWeeksApi.history(id) : Promise.resolve([])), [id, tab, data?.row_version]);

  const versionColumns: Column<WorkWeekVersion>[] = useMemo(
    () => [
      { key: "version", header: "Version", primary: true, cell: (v) => <span className="font-semibold">v{v.version}</span> },
      {
        key: "dates",
        header: "Effective",
        cell: (v) => `${fmtDate(v.effective_from)} – ${v.effective_to ? fmtDate(v.effective_to) : "open"}`,
      },
      { key: "summary", header: "Rules", cell: (v) => v.summary },
      { key: "state", header: "State", cell: (v) => <Badge tone={STATE_TONE[v.state]}>{v.state.toLowerCase()}</Badge> },
      { key: "reason", header: "Reason", hideOnMobile: true, cell: (v) => v.reason ?? "—" },
      { key: "author", header: "Author", hideOnMobile: true, cell: (v) => v.created_by ?? "Migration" },
    ],
    [],
  );

  if (error) return <ErrorState message={error.status === 404 ? "This work week doesn't exist or you can't see it." : error.message} onRetry={() => void reload()} />;
  if (!data) return <Skeleton className="h-96 w-full" />;

  const actions = data.allowed_actions ?? [];
  const setStatus = async (status: "ACTIVE" | "INACTIVE") => {
    if (status === "INACTIVE" && !(await confirm({ title: `Deactivate ${data.name}?`, message: "It can no longer be linked to branches, criteria or placements.", confirmLabel: "Deactivate", tone: "danger" }))) return;
    try {
      await workWeeksApi.update(data.id, { status }, data.row_version);
      toast.success(status === "INACTIVE" ? "Work week deactivated" : "Work week activated");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const duplicate = async () => {
    try {
      const created = await workWeeksApi.duplicateAsCrew(data.id, { name: crew.name, offset_days: crew.offset, acknowledge_warnings: true });
      toast.success(`Crew ${created.name} created`);
      setCrewOpen(false);
      router.push(`/holidays/work-weeks/${created.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <Link href="/holidays/work-weeks" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Work weeks
      </Link>
      <PageHeader
        eyebrow={`Holidays › Work weeks › ${data.code}`}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <Badge tone={data.kind === "CYCLE" ? "info" : "neutral"}>{data.kind === "CYCLE" ? "Rotating cycle" : "Weekly"}</Badge>
            <Badge tone="primary">{data.owner}</Badge>
            <Badge tone={data.status === "ACTIVE" ? "success" : "neutral"} dot>
              {data.status === "ACTIVE" ? "Active" : "Inactive"}
            </Badge>
          </span>
        }
        description={
          <>
            {data.summary} · Used by {data.used_by.employees} people
            {data.next_change ? ` · v${data.next_change.version} from ${fmtDate(data.next_change.effective_from)}` : ""}
          </>
        }
        actions={
          <>
            {actions.includes("duplicate_as_crew") && (
              <Button variant="secondary" onClick={() => setCrewOpen(true)}>
                <Copy className="h-4 w-4" /> Duplicate as crew
              </Button>
            )}
            {data.can_manage && data.status === "ACTIVE" && (
              <span title={data.in_use ? `In use by ${data.in_use}` : undefined}>
                <Button variant="danger-ghost" disabled={!actions.includes("deactivate")} onClick={() => void setStatus("INACTIVE")}>
                  <Power className="h-4 w-4" /> Deactivate
                </Button>
              </span>
            )}
            {actions.includes("activate") && (
              <Button variant="secondary" onClick={() => void setStatus("ACTIVE")}>
                Activate
              </Button>
            )}
            {actions.includes("add_version") && (
              <Button onClick={() => modal.openModal({ id: data.id })} data-testid="change-from-date">
                <CalendarClock className="h-4 w-4" /> Change from a date…
              </Button>
            )}
          </>
        }
      />
      {data.can_manage && data.status === "ACTIVE" && data.in_use && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">Deactivate is unavailable: in use by {data.in_use}.</p>
      )}

      <Tabs
        tabs={[
          { value: "schedule", label: "Schedule" },
          { value: "versions", label: "Versions", badge: data.versions.length },
          { value: "used-by", label: "Used by" },
          { value: "history", label: "History" },
        ]}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      >
        <TabPanel value="schedule">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <WorkWeekPreview month={shownMonth} days={monthPreview.data?.days} loading={monthPreview.loading} onMonthChange={setMonth} />
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Year at a glance</p>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setYear(shownYear - 1)} aria-label="Previous year">
                    ‹
                  </Button>
                  <span className="text-sm tabular-nums">{shownYear}</span>
                  <Button variant="ghost" size="sm" onClick={() => setYear(shownYear + 1)} aria-label="Next year">
                    ›
                  </Button>
                </div>
              </div>
              {yearPreview.data ? <YearStrip days={yearPreview.data.days} year={shownYear} /> : <Skeleton className="h-64 w-full" />}
            </Card>
          </div>
        </TabPanel>
        <TabPanel value="versions">
          <Card className="p-4">
            <DataTable caption="Versions" columns={versionColumns} rows={data.versions} rowKey={(v) => v.id} cardBelowMd />
          </Card>
        </TabPanel>
        <TabPanel value="used-by">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Branch links</p>
              {data.used_by_detail.branches.length ? (
                <ul className="space-y-1 text-sm">
                  {data.used_by_detail.branches.map((b) => (
                    <li key={b.id}>
                      {b.name} <span className="text-muted-foreground">({b.code})</span>
                      {b.links.map((l) => (
                        <span key={l.id} className="block text-xs text-muted-foreground">
                          from {fmtDate(l.effective_from)}
                          {l.effective_to ? ` to ${fmtDate(l.effective_to)}` : ""}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No branch uses it.</p>
              )}
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Criteria assignments</p>
              {data.used_by_detail.criteria.length ? (
                <ul className="space-y-1 text-sm">
                  {data.used_by_detail.criteria.map((c) => (
                    <li key={c.id}>
                      Priority {c.priority} · from {fmtDate(c.effective_from)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Employee overrides</p>
              {data.used_by_detail.employees.length ? (
                <ul className="space-y-1 text-sm">
                  {data.used_by_detail.employees.map((e) => (
                    <li key={e.assignment_id}>
                      <Link className="text-primary hover:underline" href={`/employees/${e.employee_id}`}>
                        Employee #{e.employee_id}
                      </Link>{" "}
                      <span className="text-muted-foreground">from {fmtDate(e.effective_from)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No placement overrides it.</p>
              )}
            </Card>
          </div>
        </TabPanel>
        <TabPanel value="history">
          <Card className="p-4">
            {history.loading && !history.data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ol className="space-y-3">
                {(history.data ?? []).map((h, i) => (
                  <motion.li
                    key={h.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-l-2 border-primary/40 pl-3"
                  >
                    <p className="text-sm font-medium">{h.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.action} · {h.actor_email ?? "system"} · {fmtDateTime(h.created_at)}
                    </p>
                  </motion.li>
                ))}
              </ol>
            )}
          </Card>
        </TabPanel>
      </Tabs>

      <Modal
        open={modal.open}
        onOpenChange={modal.onOpenChange}
        title={`Change ${data.name} from a date`}
        description="Earlier dates keep the version that applied to them."
        size="xl"
      >
        {editorData.ready ? (
          <WorkWeekEditor
            mode="version"
            pattern={data}
            templates={editorData.templates}
            entities={editorData.entities}
            today={today}
            onDirtyChange={setDirty}
            onCancel={() => void modal.close()}
            onSaved={() => {
              setDirty(false);
              void modal.close({ force: true }).then(() => reload());
              setTab("versions");
            }}
          />
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </Modal>

      <Modal
        open={crewOpen}
        onOpenChange={setCrewOpen}
        title="Duplicate as crew"
        description="Same rules, anchor moved by the offset (e.g. crews 7 days apart)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCrewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void duplicate()} disabled={!crew.name.trim()}>
              Create crew
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={crew.name} onChange={(e) => setCrew({ ...crew, name: e.target.value })} />
          </Field>
          <Field label="Anchor offset (days)" required>
            <Input type="number" min={1} max={55} value={crew.offset} onChange={(e) => setCrew({ ...crew, offset: Number(e.target.value) || 1 })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
