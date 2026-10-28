"use client";

/**
 * Holidays › Next year (`/holidays/rollover`; LH 09-ui-ux/02 §20, 04-holiday/02 §8.5). Header: year, "Drafts were
 * generated on …; n of m calendars published", [Generate drafts now] (secondary), [Declare emergency closure] and
 * [Import holidays]. Left: every calendar with its year status (Published vN · Draft · Not generated · No rules ·
 * Failed) and counts. Right: the comparison with the year before (Same rule · New · Not repeating · Moved), filter
 * ALL / CHANGES / TO_DO, footer [Discard draft] · [Publish {year}…] (the page's only primary). Query keys `year`,
 * `calendar_id`, `filter`; modal `import-holidays` (`calendar_id`, `year`).
 */

import { motion } from "framer-motion";
import { AlertTriangle, CalendarClock, CalendarX2, CheckCircle2, FileUp, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { BackdatedClosureModal } from "@/components/holiday/BackdatedClosureModal";
import { HolidayImportWizard } from "@/components/holiday/HolidayImportWizard";
import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { can } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { ROLLOVER_STATUS_LABEL, rolloverApi, yearsApi, type DiffLine, type RolloverItem, type RolloverStatus } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";
import { useModalRoute } from "@/lib/useModalRoute";

type Filter = "ALL" | "CHANGES" | "TO_DO";

const STATUS_TONE: Record<RolloverStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  PUBLISHED: "success",
  DRAFT: "info",
  NOT_GENERATED: "warning",
  NO_RULES: "neutral",
  FAILED: "danger",
};

const NOTE: Record<DiffLine["line"], string> = { SAME: "Same rule", NEW: "New", MOVED: "Moved", GONE: "Not repeating" };

const weekday = (d: string | null) => (d ? fmtDate(d, "EEE dd MMM") : "—");

export function RolloverPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { me } = useCan();
  const confirm = useConfirm();
  const publisher = can(me, P.HOLIDAY_PUBLISH);
  const yearParam = Number(search?.get("year")) || undefined;
  const selectedParam = Number(search?.get("calendar_id")) || null;
  const filter = (["ALL", "CHANGES", "TO_DO"].includes(search?.get("filter") ?? "") ? search?.get("filter") : "ALL") as Filter;
  const overview = useApi(() => rolloverApi.overview(yearParam), [yearParam]);
  const data = overview.data;
  const year = data?.year ?? yearParam ?? new Date().getFullYear() + 1;
  const items = data?.items ?? [];
  const selected: RolloverItem | undefined = items.find((i) => i.calendar_id === selectedParam) ?? items.find((i) => i.year_status !== "NO_RULES") ?? items[0];
  const diff = useApi(() => (selected && selected.year_status !== "NO_RULES" && selected.year_status !== "NOT_GENERATED" ? rolloverApi.diff(selected.calendar_id, year) : Promise.resolve(null)), [selected?.calendar_id, selected?.year_status, year]);
  const [generating, setGenerating] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [importDirty, setImportDirty] = useState(false);
  const importModal = useModalRoute("import-holidays", { keys: ["calendar_id", "year"], dirty: importDirty });

  const setQuery = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(search?.toString() ?? "");
    Object.entries(patch).forEach(([k, v]) => (v === null || v === "" ? next.delete(k) : next.set(k, String(v))));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const missing = items.filter((i) => i.year_status === "NOT_GENERATED" || i.year_status === "FAILED");
  const generate = async () => {
    setGenerating(true);
    try {
      const run = await rolloverApi.generate(year);
      const made = run.calendars.filter((c) => c.result === "GENERATED").length;
      const failed = run.calendars.filter((c) => c.result === "FAILED").length;
      toast[failed ? "error" : "success"](failed ? `${made} draft(s) generated, ${failed} failed` : `${made} draft(s) generated for ${year}`);
      overview.reload();
      diff.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const discard = async () => {
    if (!selected) return;
    const ok = await confirm({ title: `Discard the ${year} draft of ${selected.code}?`, message: "The draft and its rows are deleted; the repeating rules stay.", confirmLabel: "Discard draft", tone: "danger" });
    if (!ok) return;
    try {
      await yearsApi.discard(selected.calendar_id, year);
      toast.success("Draft discarded");
      overview.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const lines = useMemo(() => {
    const all = diff.data?.lines ?? [];
    if (filter === "CHANGES") return all.filter((l) => l.line !== "SAME");
    if (filter === "TO_DO") return all.filter((l) => l.line === "GONE" || l.line === "NEW");
    return all;
  }, [diff.data, filter]);

  // A closure lands in the current (published) year, whatever next year's state.
  const publishable = items.filter((i) => i.can_publish);
  const localYear = data ? Number(data.local_today.slice(0, 4)) : new Date().getFullYear();

  return (
    <div>
      <PageHeader
        eyebrow="Holidays"
        title="Next year"
        description="Get next year's holidays reviewed and published before people plan leave. Drafts are generated from each calendar's repeating holidays; nothing is published without you."
        actions={
          <div className="flex flex-wrap gap-2">
            {publisher && (
              <Button variant="danger-ghost" onClick={() => setClosureOpen(true)} data-testid="declare-closure">
                <CalendarX2 className="h-4 w-4" /> Declare Emergency Closure
              </Button>
            )}
            {selected && selected.can_manage && (
              <Button variant="secondary" onClick={() => importModal.openModal({ calendar_id: selected.calendar_id, year })} data-testid="open-import">
                <FileUp className="h-4 w-4" /> Import holidays
              </Button>
            )}
            {missing.length > 0 && (
              <Button variant="secondary" onClick={() => void generate()} loading={generating} data-testid="generate-drafts">
                <Sparkles className="h-4 w-4" /> Generate drafts now
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-4 p-4" data-testid="rollover-header">
        <div className="w-32">
          <Select aria-label="Year" value={year} onChange={(e) => setQuery({ year: e.target.value, calendar_id: null })}>
            {[localYear, localYear + 1, localYear + 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </div>
        {data && (
          <p className="text-sm text-muted-foreground" data-testid="rollover-status">
            {data.generated_on
              ? `Drafts were generated on ${fmtDate(data.generated_on)}.`
              : data.before_generate_on
                ? `Drafts for ${year} will be generated on ${fmtDate(data.generate_on)}.`
                : `Drafts for ${year} are due since ${fmtDate(data.generate_on)}.`}{" "}
            <span className="font-medium text-foreground">{data.published} of {data.total} calendars published.</span>
          </p>
        )}
      </Card>

      {overview.loading && !data && <Skeleton className="h-80 w-full rounded-2xl" />}
      {data && items.every((i) => i.year_status === "NO_RULES") && (
        <Card>
          <EmptyState icon={<CalendarClock />} title="No calendar has repeating holidays yet." description="Add rules on a calendar or import last year's holidays." action={<Link href="/holidays/calendars"><Button variant="secondary">Go to calendars</Button></Link>} />
        </Card>
      )}
      {data && data.total > 0 && data.published === data.total && (
        <Notice tone="info" title={`All calendars for ${year} are published.`} className="mb-4" />
      )}

      {data && items.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <Card className="p-2" data-testid="rollover-calendars">
            <ul className="space-y-1">
              {items.map((item, i) => (
                <motion.li key={item.calendar_id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <button
                    type="button"
                    onClick={() => setQuery({ calendar_id: item.calendar_id })}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-muted", selected?.calendar_id === item.calendar_id && "bg-primary-soft")}
                    aria-current={selected?.calendar_id === item.calendar_id ? "true" : undefined}
                    data-testid={`rollover-calendar-${item.code}`}
                    data-status={item.year_status}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-muted-foreground">{item.code}</p>
                      <p className="truncate text-sm font-medium">{item.name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={STATUS_TONE[item.year_status]}>
                        {ROLLOVER_STATUS_LABEL[item.year_status]}{item.year_status === "PUBLISHED" ? ` v${item.version}` : ""}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        {item.counts.needs_date > 0 && <AlertTriangle className="h-3 w-3 text-warning" aria-label="needs dates" />}
                        {item.counts.holidays}
                      </span>
                    </div>
                  </button>
                </motion.li>
              ))}
            </ul>
          </Card>

          {selected && (
            <Card className="flex flex-col p-4 sm:p-5" data-testid="rollover-detail">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{selected.code} · {year}</p>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground" data-testid="rollover-counts">
                    {selected.counts.holidays} holidays · {selected.counts.expected} expected · {selected.counts.needs_date} need a date · {selected.counts.weekend} on a weekend
                  </p>
                </div>
                <Segmented<Filter> label="Filter" value={filter} onChange={(f) => setQuery({ filter: f === "ALL" ? null : f })} options={[{ value: "ALL", label: "All" }, { value: "CHANGES", label: "Changes" }, { value: "TO_DO", label: "To do" }]} />
              </div>
              {selected.year_status === "FAILED" && (
                <Notice tone="danger" title={`Draft could not be generated: ${selected.error ?? "error"}`} className="mb-3">
                  <Button size="sm" variant="secondary" onClick={() => void generate()}><RefreshCw className="h-4 w-4" /> Retry</Button>
                </Notice>
              )}
              {selected.year_status === "NO_RULES" && (
                <Notice tone="info" title="No repeating holidays: add rules or import last year's holidays." className="mb-3">
                  <Link href={`/holidays/calendars/${selected.calendar_id}?tab=rules`} className="text-sm font-medium text-primary">Edit rules</Link>
                </Notice>
              )}
              {selected.year_status === "NOT_GENERATED" && (
                <Notice tone="warning" title={`No ${year} draft yet.`} className="mb-3">
                  <Button size="sm" variant="secondary" onClick={() => void generate()} loading={generating}><Sparkles className="h-4 w-4" /> Generate drafts now</Button>
                </Notice>
              )}
              {diff.loading && !diff.data ? (
                <Skeleton className="h-40 w-full" />
              ) : diff.data ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="rollover-diff">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Holiday</th>
                        <th className="py-2 pr-3">{year - 1}</th>
                        <th className="py-2 pr-3">{year}</th>
                        <th className="py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={`${l.name}-${i}`} className="border-t border-border" data-line={l.line}>
                          <td className="py-2 pr-3 font-medium">{l.name}</td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">{weekday(l.previous_date)}</td>
                          <td className="py-2 pr-3 tabular-nums">{weekday(l.date)}</td>
                          <td className="py-2"><Badge tone={l.line === "SAME" ? "neutral" : l.line === "NEW" ? "success" : l.line === "GONE" ? "warning" : "info"}>{NOTE[l.line]}</Badge></td>
                        </tr>
                      ))}
                      {lines.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Nothing to show for this filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                <Link href={`/holidays/calendars/${selected.calendar_id}?year=${year}`} className="mr-auto text-sm text-primary">Open calendar</Link>
                {selected.year_status === "DRAFT" && selected.can_manage && (
                  <Button variant="secondary" onClick={() => void discard()} data-testid="discard-draft">Discard draft</Button>
                )}
                {selected.year_status === "DRAFT" && (selected.can_publish ? (
                  <Link href={`/holidays/calendars/${selected.calendar_id}/years/${year}/publish`}>
                    <Button data-testid="publish-year">Publish {year}…</Button>
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Ask a holiday publisher to publish</span>
                ))}
                {selected.year_status === "PUBLISHED" && (
                  <span className="flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Published v{selected.version}</span>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {data && (
        <BackdatedClosureModal
          key={closureOpen ? "open" : "closed"}
          open={closureOpen}
          onOpenChange={setClosureOpen}
          calendars={publishable}
          defaultCalendarId={selected?.can_publish ? selected.calendar_id : null}
          today={data.local_today}
          onRecorded={(calendarId, date) => router.push(`/holidays/calendars/${calendarId}?year=${date.slice(0, 4)}&closure=${date}`)}
        />
      )}

      <Modal open={importModal.open} onOpenChange={importModal.onOpenChange} title="Import holidays" size="xl">
        {importModal.open && (
          <HolidayImportWizard
            calendarId={Number(importModal.param("calendar_id")) || selected?.calendar_id || 0}
            calendarCode={items.find((i) => i.calendar_id === Number(importModal.param("calendar_id")))?.code ?? selected?.code ?? ""}
            defaultYear={Number(importModal.param("year")) || year}
            localYear={localYear}
            onDirty={setImportDirty}
            onDone={() => { overview.reload(); diff.reload(); }}
            onCancel={() => void importModal.close()}
          />
        )}
      </Modal>
    </div>
  );
}
