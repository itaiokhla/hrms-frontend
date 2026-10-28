"use client";

import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, CornerDownRight, History, MinusCircle, MoveRight, Plus, Power, RotateCcw, Sparkles, Trash2, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { WorkingDayForm } from "@/components/holiday/WorkingDayForm";
import { Notice, ReasonModal } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useModalRoute } from "@/lib/useModalRoute";
import {
  CATEGORY_LABEL,
  HolidayApiError,
  yearsApi,
  type Calendar,
  type HolidayCategory,
  type HolidayRule,
  type HolidayType,
  type YearItem,
  type YearView,
} from "@/lib/holiday/api";

const TYPE_TONE: Record<HolidayType, "danger" | "info" | "warning"> = { PUBLIC: "danger", COMPANY: "info", OPTIONAL: "warning" };
const STATUS_TONE = { CONFIRMED: "success", PROVISIONAL: "warning", CANCELLED: "neutral" } as const;
const STATUS_LABEL = { CONFIRMED: "Confirmed", PROVISIONAL: "Expected", CANCELLED: "Cancelled" } as const;

/* ------------------------------------------------------------------------------------------------ year bar */

/** Year state line (09-ui-ux/02 §18 "Year bar"): DRAFT -> Generate / Publish, PUBLISHED -> version, pending requests. */
export function YearBar({
  view,
  years,
  year,
  onYear,
  onGenerate,
  onPublish,
  onReviewChange,
  onDiscard,
  generating,
}: {
  view: YearView | null | undefined;
  years: number[];
  year: number;
  onYear: (y: number) => void;
  onGenerate: () => void;
  onPublish: () => void;
  onReviewChange: () => void;
  onDiscard: () => void;
  generating: boolean;
}) {
  const status = view?.status;
  const pending = view?.pending_request;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2" data-testid="year-bar">
      <Select aria-label="Year" className="w-28" value={year} onChange={(e) => onYear(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
      {!view ? (
        <Skeleton className="h-6 w-40" />
      ) : (
        <>
          <Badge tone={status === "PUBLISHED" ? "success" : status === "DRAFT" ? "warning" : "neutral"} dot data-testid="year-status">
            {status === "PUBLISHED" ? `Published v${view.version}` : status === "DRAFT" ? "Draft" : "Not started"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {view.summary.own} own · {view.summary.inherited} inherited
            {view.summary.expected ? ` · ${view.summary.expected} expected` : ""}
            {view.generated_at ? ` · generated ${fmtDate(view.generated_at.slice(0, 10))}` : ""}
          </span>
          {pending && (
            <Badge tone="info" data-testid="pending-request">
              {pending.kind === "PUBLISH" ? "Publication" : "Change"} awaiting a second publisher
            </Badge>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {view.can_manage && status !== "PUBLISHED" && view.summary.rules > 0 && (
              <Button variant="secondary" size="sm" loading={generating} onClick={onGenerate} data-testid="generate-year">
                <Sparkles className="h-4 w-4" /> Generate {year} draft
              </Button>
            )}
            {view.can_manage && status === "DRAFT" && !pending && (
              <Button variant="ghost" size="sm" onClick={onDiscard}>
                <Trash2 className="h-4 w-4" /> Discard draft
              </Button>
            )}
            {view.can_publish && status === "DRAFT" && (
              <Button size="sm" onClick={onPublish} data-testid="publish-year">
                <CheckCircle2 className="h-4 w-4" /> {pending ? "Review publication" : view.requires_second_person ? "Request publication…" : `Publish ${year}…`}
              </Button>
            )}
            {view.can_publish && status === "PUBLISHED" && pending?.kind === "AMEND" && (
              <Button size="sm" onClick={onReviewChange} data-testid="review-change">
                Review change
              </Button>
            )}
          </span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ holidays */

/** The year's rows (01 §9.2): own rows in every status, inherited published rows; actions per year state and band. */
export function YearHolidaysTable({
  calendar,
  view,
  onChanged,
  onExclude,
}: {
  calendar: Calendar;
  view: YearView | null | undefined;
  onChanged: () => void;
  onExclude: (item: YearItem) => void;
}) {
  const [cancelling, setCancelling] = useState<YearItem | null>(null);
  const [moving, setMoving] = useState<YearItem | null>(null);
  const [confirmingWithReason, setConfirmingWithReason] = useState<YearItem | null>(null);
  const published = view?.status === "PUBLISHED";

  const draftAction = async (item: YearItem, action: "SKIP" | "RESTORE" | "RESET") => {
    try {
      await yearsApi.editDraftRow(item.id, { action }, item.row_version);
      toast.success(action === "SKIP" ? `${item.name} skipped this year` : action === "RESET" ? "Back to the rule's date" : `${item.name} restored`);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const confirm = async (item: YearItem) => {
    try {
      const result = await yearsApi.confirm(item.id, {});
      toast.success(result.status === "PENDING_SECOND_PERSON" ? "Confirmation requested" : `${item.name} confirmed`);
      onChanged();
    } catch (e) {
      if (e instanceof HolidayApiError && e.code === "REASON_REQUIRED") setConfirmingWithReason(item);
      else toast.error(errorMessage(e));
    }
  };

  const columns: Column<YearItem>[] = [
    {
      key: "date",
      header: "Date",
      primary: true,
      cell: (h) => (
        <span className={h.status === "CANCELLED" ? "text-muted-foreground line-through" : "font-medium tabular-nums"}>
          {h.observance === "OBSERVED" && <CornerDownRight className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
          {fmtDate(h.date)}
        </span>
      ),
    },
    {
      key: "name",
      header: "Holiday",
      cell: (h) => (
        <span>
          {h.name}
          {h.observance === "OBSERVED" && h.observed_from_date && <span className="ml-1 text-xs text-muted-foreground">(observed, for {fmtDate(h.observed_from_date)})</span>}
          {h.overridden && <Badge tone="neutral" className="ml-1">edited</Badge>}
        </span>
      ),
    },
    { key: "type", header: "Type", hideOnMobile: true, cell: (h) => <Badge tone={TYPE_TONE[h.holiday_type]}>{h.holiday_type.toLowerCase()}</Badge> },
    { key: "status", header: "Status", cell: (h) => <Badge tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Badge> },
    {
      key: "source",
      header: "Source",
      hideOnMobile: true,
      cell: (h) =>
        h.own ? (
          <Badge tone="primary">{h.rule_id ? "rule" : "own"}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">via {h.path.join(" › ") || h.source_code}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      cell: (h) => {
        if (!h.own) {
          return calendar.can_manage ? (
            <Button size="sm" variant="ghost" onClick={() => onExclude(h)} data-testid={`exclude-${h.date}`}>
              <MinusCircle className="h-4 w-4" /> Exclude
            </Button>
          ) : null;
        }
        const actions = h.actions ?? [];
        return (
          <span className="flex flex-wrap justify-end gap-1">
            {!published && actions.includes("skip") && h.status !== "CANCELLED" && view?.can_manage && (
              <Button size="sm" variant="ghost" onClick={() => void draftAction(h, "SKIP")} data-testid={`skip-${h.date}`}>
                <XCircle className="h-4 w-4" /> {h.rule_id ? "Skip this year" : "Remove"}
              </Button>
            )}
            {!published && h.status === "CANCELLED" && view?.can_manage && (
              <Button size="sm" variant="ghost" onClick={() => void draftAction(h, "RESTORE")}>
                <Undo2 className="h-4 w-4" /> Restore
              </Button>
            )}
            {!published && actions.includes("reset") && view?.can_manage && (
              <Button size="sm" variant="ghost" onClick={() => void draftAction(h, "RESET")}>
                <RotateCcw className="h-4 w-4" /> Reset to rule
              </Button>
            )}
            {actions.includes("confirm") && (view?.can_publish || !published) && (
              <Button size="sm" variant="ghost" onClick={() => void confirm(h)} data-testid={`confirm-${h.date}`}>
                <CheckCircle2 className="h-4 w-4" /> Confirm
              </Button>
            )}
            {published && actions.includes("move") && view?.can_publish && (
              <Button size="sm" variant="ghost" onClick={() => setMoving(h)} data-testid={`move-${h.date}`}>
                <MoveRight className="h-4 w-4" /> Move…
              </Button>
            )}
            {published && actions.includes("cancel") && view?.can_publish && (
              <Button size="sm" variant="ghost" onClick={() => setCancelling(h)} data-testid={`cancel-${h.date}`}>
                <XCircle className="h-4 w-4" /> Cancel…
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {view?.notes.filter((n) => n.code === "HOLIDAY_DATE_NEEDED").map((n) => (
        <Notice key={n.message} tone="warning" title={n.message} className="mb-3" />
      ))}
      <DataTable
        caption={`Holidays of ${calendar.code} in ${view?.year ?? ""}`}
        columns={columns}
        rows={view?.items}
        loading={!view}
        rowKey={(h) => `${h.id}-${h.date}`}
        cardBelowMd
        empty={<EmptyState title={`No holidays in ${view?.year ?? ""}`} description="Add one, add a repeating rule and generate the year, or include a calendar." />}
      />
      <ReasonModal
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.name ?? ""}`}
        consequence={<>Employees work on {cancelling ? fmtDate(cancelling.date) : ""}; leave on that day is charged again. The year gets a new version.</>}
        confirmLabel="Cancel holiday"
        danger
        onSubmit={async (reason) => {
          if (!cancelling) return;
          const result = await yearsApi.cancel(cancelling.id, { reason });
          toast.success(result.status === "PENDING_SECOND_PERSON" ? "Cancellation requested" : `${cancelling.name} cancelled`);
          onChanged();
        }}
      />
      <ReasonModal
        open={!!confirmingWithReason}
        onOpenChange={(o) => !o && setConfirmingWithReason(null)}
        title={`Confirm ${confirmingWithReason?.name ?? ""}`}
        consequence={<>The date starts counting as a holiday; leave on it is recounted.</>}
        confirmLabel="Confirm"
        onSubmit={async (reason) => {
          if (!confirmingWithReason) return;
          await yearsApi.confirm(confirmingWithReason.id, { reason });
          toast.success(`${confirmingWithReason.name} confirmed`);
          onChanged();
        }}
      />
      <MoveModal item={moving} today={view?.local_today ?? ""} onClose={() => setMoving(null)} onDone={onChanged} />
    </>
  );
}

function MoveModal({ item, today, onClose, onDone }: { item: YearItem | null; today: string; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const result = await yearsApi.move(item.id, { new_date: date, reason: reason.trim() || undefined });
      toast.success(result.status === "PENDING_SECOND_PERSON" ? "Move requested" : `${item.name} moved to ${fmtDate(date)}`);
      onClose();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={`Move ${item?.name ?? ""}`}
      description="The old date is cancelled and the holiday is added on the new one; leave on both dates is recounted."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!date} onClick={() => void save()} data-testid="move-save">
            Move holiday
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New date" required hint="A future date in the same year.">
          <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Notice tone="danger" title={error} />}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------------ add holiday */

/** Modal `holiday` (01 §9.3): into a DRAFT year directly; into a PUBLISHED year as an amendment with a reason (a
 * date in the backdate window is a backdated closure). */
export function OccurrenceModal({
  open,
  onOpenChange,
  calendar,
  view,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  calendar: Calendar;
  view: YearView | null | undefined;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", date: "", holiday_type: "PUBLIC" as HolidayType, category: "OTHER" as HolidayCategory, expected: false, lasts: 1, reason: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = view?.status === "PUBLISHED";
  const past = !!form.date && !!view && form.date <= view.local_today;
  const save = async () => {
    setError(null);
    if (!form.name.trim() || !form.date) return setError("Enter a name and a date.");
    setSaving(true);
    try {
      const result = await yearsApi.addOccurrence(calendar.id, {
        name: form.name.trim(),
        date: form.date,
        holiday_type: form.holiday_type,
        category: form.category,
        status: form.expected ? "PROVISIONAL" : "CONFIRMED",
        duration_days: form.lasts,
        reason: form.reason.trim() || undefined,
      });
      toast.success(
        result.status === "PENDING_SECOND_PERSON"
          ? "Change requested: another publisher completes it."
          : result.status === "AMENDED"
            ? `${form.name.trim()} added (v${result.year.version})`
            : `${form.name.trim()} added to the draft`,
      );
      setForm({ name: "", date: "", holiday_type: "PUBLIC", category: "OTHER", expected: false, lasts: 1, reason: "" });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add a holiday to ${calendar.code}`}
      description={published ? "The year is published: this is an amendment and needs a reason." : "Draft rows count once the year is published."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()} data-testid="occurrence-save">
            {published ? "Publish change" : "Save to draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="occurrence-form">
        <Field label="Name" required>
          <Input value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required hint={past ? "Past date: recorded as a backdated closure." : undefined}>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Lasts (days)">
            <Input type="number" min={1} max={31} value={form.lasts} onChange={(e) => setForm({ ...form, lasts: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Type">
            <Select value={form.holiday_type} onChange={(e) => setForm({ ...form, holiday_type: e.target.value as HolidayType })}>
              <option value="PUBLIC">Public</option>
              <option value="COMPANY">Company</option>
              <option value="OPTIONAL">Optional</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as HolidayCategory })}>
              {(Object.keys(CATEGORY_LABEL) as HolidayCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.checked })} />
            Expected date (to be confirmed)
          </label>
        </div>
        {(form.category === "EMERGENCY" || form.category === "SHUTDOWN") && (
          <p className="text-xs text-muted-foreground">Not paid? Record unpaid leave for the affected employees instead.</p>
        )}
        {(published || past) && (
          <Field label="Reason" required>
            <Textarea rows={2} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="occurrence-reason" />
          </Field>
        )}
        {error && <Notice tone="danger" title={error} />}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------------ rules */

export function RulesTab({
  calendar,
  onAdd,
  onEdit,
  onChanged,
  version,
}: {
  calendar: Calendar;
  onAdd: () => void;
  onEdit: (rule: HolidayRule) => void;
  onChanged: () => void;
  version: unknown;
}) {
  const rules = useApi(() => yearsApi.rules(calendar.id), [calendar.id, version]);
  const [deactivating, setDeactivating] = useState<HolidayRule | null>(null);
  const [expected, setExpected] = useState<HolidayRule | null>(null);
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Repeating holidays generate each year&apos;s draft. Only published years count.</p>
        {calendar.can_manage && (
          <Button onClick={onAdd} data-testid="add-rule">
            <Plus className="h-4 w-4" /> Add rule
          </Button>
        )}
      </div>
      {!rules.data ? (
        <Skeleton className="h-32 w-full" />
      ) : rules.data.items.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No repeating holidays" description="Add 26 January once and every year gets it." />
      ) : (
        <ul className="space-y-2" data-testid="rule-list">
          {rules.data.items.map((r) => (
            <motion.li key={r.id} layout className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm" data-testid={`rule-${r.name}`}>
              <span className="font-medium">{r.name}</span>
              <span className="text-muted-foreground">{r.summary}</span>
              <Badge tone="neutral">
                {r.valid_from_year}–{r.valid_to_year ?? "open"}
              </Badge>
              {r.status === "INACTIVE" && <Badge tone="neutral">inactive</Badge>}
              {r.next_dates.length > 0 && <span className="text-xs text-muted-foreground">next {r.next_dates.map((d) => fmtDate(d)).join(", ")}</span>}
              {calendar.can_manage && r.status === "ACTIVE" && (
                <span className="ml-auto flex gap-1">
                  {r.kind === "ANNUAL_CONFIRM" && (
                    <Button size="sm" variant="ghost" onClick={() => setExpected(r)}>
                      <CalendarClock className="h-4 w-4" /> Expected date…
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeactivating(r)}>
                    <Power className="h-4 w-4" /> Deactivate
                  </Button>
                </span>
              )}
            </motion.li>
          ))}
        </ul>
      )}
      <ReasonModal
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ""}`}
        consequence={<>Draft years lose its rows; published years keep them (change those by amendment).</>}
        confirmLabel="Deactivate"
        danger
        onSubmit={async (reason) => {
          if (!deactivating) return;
          await yearsApi.deactivateRule(deactivating.id, reason);
          toast.success(`${deactivating.name} deactivated`);
          void rules.reload();
          onChanged();
        }}
      />
      <ExpectedDateModal rule={expected} onClose={() => setExpected(null)} onDone={() => (void rules.reload(), onChanged())} />
    </Card>
  );
}

function ExpectedDateModal({ rule, onClose, onDone }: { rule: HolidayRule | null; onClose: () => void; onDone: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!rule) return;
    setBusy(true);
    try {
      const result = await yearsApi.setExpectedDate(rule.id, year, date || null);
      toast.success(result.published_years_affected.length ? `Saved; ${result.published_years_affected.join(", ")} is published: amend it.` : "Expected date saved");
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!rule}
      onOpenChange={(o) => !o && onClose()}
      title={`Expected date of ${rule?.name ?? ""}`}
      description="Draft years get expected (provisional) days from this date; confirm them when announced."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Year">
          <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
        </Field>
        <Field label="Expected first day" hint="Empty removes it.">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------------ working days */

export function WorkingDaysTab({ calendar, view, onChanged }: { calendar: Calendar; view: YearView | null | undefined; onChanged: () => void }) {
  // Modal `working-day` (deep link `?modal=working-day&date=`; full-page twin /holidays/calendars/{id}/working-days/new).
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute("working-day", { keys: ["date"], dirty });
  const [removing, setRemoving] = useState<number | null>(null);
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">A declared working day turns a weekly off into work for everyone on this calendar and on calendars that include it.</p>
        {calendar.can_manage && (
          <Button variant="secondary" onClick={() => modal.openModal()} data-testid="declare-working-day">
            <Plus className="h-4 w-4" /> Declare working day
          </Button>
        )}
      </div>
      {!view ? (
        <Skeleton className="h-20 w-full" />
      ) : view.working_days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No declared working days in {view.year}.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="working-days">
          {view.working_days.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{fmtDate(w.date)}</span> {w.name}
              <span className="text-xs text-muted-foreground">— {w.reason}</span>
              {calendar.can_manage && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRemoving(w.id)}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={modal.open} onOpenChange={modal.onOpenChange} title="Declare a working day">
        {modal.open && (
          <WorkingDayForm
            calendarId={calendar.id}
            defaultDate={modal.param("date") ?? ""}
            onDirty={setDirty}
            onCancel={() => void modal.close()}
            onSaved={() => {
              void modal.close({ force: true });
              onChanged();
            }}
          />
        )}
      </Modal>
      <ReasonModal
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove the working day"
        consequence={<>The date goes back to the work week&apos;s weekly off.</>}
        confirmLabel="Remove"
        optional={view?.status !== "PUBLISHED"}
        onSubmit={async (reason) => {
          if (removing === null) return;
          await yearsApi.removeWorkingDay(calendar.id, removing, reason || undefined);
          toast.success("Working day removed");
          onChanged();
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------ history */

export function HistoryTab({ calendar, version }: { calendar: Calendar; version: unknown }) {
  const history = useApi(() => yearsApi.history(calendar.id), [calendar.id, version]);
  if (!history.data) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card className="p-4 sm:p-5">
        <p className="mb-2 text-sm font-medium">Years</p>
        {history.data.years.length === 0 ? (
          <p className="text-sm text-muted-foreground">No years yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm" data-testid="history-years">
            {history.data.years.map((y) => (
              <li key={y.year} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{y.year}</span>
                <Badge tone={y.status === "PUBLISHED" ? "success" : "warning"}>{y.status === "PUBLISHED" ? `Published v${y.version}` : "Draft"}</Badge>
                {y.published_by && <span className="text-xs text-muted-foreground">by {y.published_by}</span>}
                {y.approved_by && <span className="text-xs text-muted-foreground">, approved by {y.approved_by}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-5">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <History className="h-4 w-4" aria-hidden /> Changes
        </p>
        <ol className="space-y-2" data-testid="history-events">
          {history.data.events.map((e) => (
            <li key={e.id} className="rounded-xl border border-border px-3 py-2 text-sm">
              <p className="font-medium">{e.description}</p>
              <p className="text-xs text-muted-foreground">
                {e.action} · {e.actor ?? "system"} · {e.created_at ? fmtDateTime(e.created_at) : ""}
                {e.reason ? ` · ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
