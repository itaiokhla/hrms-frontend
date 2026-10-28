"use client";

import { CalendarRange, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useApi, useDebounced } from "@/lib/hooks";
import { WEEKDAYS, calendarsApi, HolidayApiError, OBSERVANCE_LABEL, type Calendar, type CalendarWrite, type Observance } from "@/lib/holiday/api";
import { useModalRoute } from "@/lib/useModalRoute";

export const CALENDAR_MODAL = "holiday-calendar";
export const ASSIGNMENT_MODAL = "calendar-assignment";

interface Entity {
  id: number;
  legal_name: string;
  country_code: string;
}

export function useEntities() {
  return useApi(() => api.get<Entity[]>("/legal-entities").catch(() => [] as Entity[]), []);
}

const weekendLabel = (days: number[]) => days.map((d) => WEEKDAYS[d]).join(", ");

const FIELD_OF_CODE: Record<string, string> = {
  ORG_CODE_TAKEN: "code",
  ORG_CODE_INVALID: "code",
  ORG_NAME_INVALID: "name",
  ORG_COUNTRY_INVALID: "country_code",
  ORG_SUBDIVISION_INVALID: "subdivision_code",
  INVALID_WEEKEND: "weekend_days",
};

/** The `holiday-calendar` form (New calendar / Edit details; 09-ui-ux/02 §18). Weekend blank = derived (V3-013). */
export function CalendarForm({
  calendar,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  calendar?: Calendar;
  onSaved: (calendar: Calendar) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const entities = useEntities();
  const [form, setForm] = useState({
    name: calendar?.name ?? "",
    code: calendar?.code ?? "",
    legal_entity_id: calendar?.legal_entity_id ? String(calendar.legal_entity_id) : "",
    country_code: calendar?.country_code ?? "",
    subdivision_code: calendar?.subdivision_code ?? "",
    weekend: calendar?.weekend_days ?? ([] as number[]),
    employee_observance: (calendar?.employee_observance ?? "NONE") as Observance,
    description: calendar?.description ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    onDirtyChange?.(true);
  };

  const save = async () => {
    setErrors({});
    setFormError(null);
    if (!form.name.trim()) return setErrors({ name: "Enter a name." });
    const body: CalendarWrite = {
      name: form.name.trim(),
      ...(form.code.trim() ? { code: form.code.trim().toUpperCase() } : {}),
      legal_entity_id: form.legal_entity_id ? Number(form.legal_entity_id) : null,
      country_code: form.country_code ? form.country_code.toUpperCase() : null,
      subdivision_code: form.subdivision_code ? form.subdivision_code.toUpperCase() : null,
      weekend_days: form.weekend.length ? [...form.weekend].sort() : null,
      employee_observance: form.employee_observance,
      description: form.description.trim() || null,
    };
    setSaving(true);
    try {
      const saved = calendar ? await calendarsApi.update(calendar.id, body, calendar.row_version) : await calendarsApi.create(body);
      toast.success(`Calendar ${saved.code} saved`);
      onDirtyChange?.(false);
      onSaved(saved);
    } catch (e) {
      if (e instanceof HolidayApiError && e.code && FIELD_OF_CODE[e.code]) setErrors({ [FIELD_OF_CODE[e.code]]: e.message });
      else setFormError(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="calendar-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>
          <Input value={form.name} maxLength={150} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Code" hint="Blank = from the name; fixed once the calendar is in use." error={errors.code}>
          <Input value={form.code} maxLength={50} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <Field label="Owner" hint="Tenant-wide calendars can be used by every entity; an entity's calendar only inside it.">
        <Select value={form.legal_entity_id} onChange={(e) => set({ legal_entity_id: e.target.value })}>
          <option value="">Tenant-wide</option>
          {(entities.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.legal_name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" hint="ISO code, e.g. IN" error={errors.country_code}>
          <Input value={form.country_code} maxLength={2} onChange={(e) => set({ country_code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="State or region" hint="ISO 3166-2, e.g. IN-KA" error={errors.subdivision_code}>
          <Input value={form.subdivision_code} maxLength={6} onChange={(e) => set({ subdivision_code: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-[13px] font-medium">Weekend (for observed rules and banking)</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={form.weekend.includes(i)}
                onChange={() => set({ weekend: form.weekend.includes(i) ? form.weekend.filter((x) => x !== i) : [...form.weekend, i] })}
              />
              {d}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {form.weekend.length ? "Explicit weekend." : `None ticked = derived from the country${calendar ? ` (now ${weekendLabel(calendar.effective_weekend)})` : ""}.`} Weekly offs come from work
          weeks, not from here.
        </p>
        {errors.weekend_days && <p className="text-xs font-medium text-danger">{errors.weekend_days}</p>}
      </fieldset>
      <Field label="Employee observance">
        <Select value={form.employee_observance} onChange={(e) => set({ employee_observance: e.target.value as Observance })}>
          {(Object.keys(OBSERVANCE_LABEL) as Observance[]).map((o) => (
            <option key={o} value={o}>
              {OBSERVANCE_LABEL[o]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description">
        <Textarea rows={2} maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      {formError && <Notice tone="danger" title={formError} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} data-testid="calendar-save">
          {calendar ? "Save details" : "Create calendar"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Holidays › Calendars (09-ui-ux/02 §18): code, name, owner, region, includes, people; `?modal=holiday-calendar`
 * creates one, rows open the calendar detail.
 */
export function CalendarsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(50);
  const query = useDebounced(q, 300);
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute(CALENDAR_MODAL, { dirty });
  const { data, loading, error, reload } = useApi(
    () => calendarsApi.list({ q: query || undefined, status: status || undefined, skip, limit }),
    [query, status, skip, limit],
  );
  useEffect(() => setSkip(0), [query, status]);

  const columns: Column<Calendar>[] = [
    { key: "code", header: "Code", primary: true, cell: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span> },
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "owner", header: "Owner", hideOnMobile: true, cell: (r) => r.owner },
    { key: "region", header: "Region", hideOnMobile: true, cell: (r) => r.subdivision_code ?? r.country_code ?? "—" },
    { key: "includes", header: "Includes", cell: (r) => r.includes_count || "—" },
    { key: "people", header: "People", cell: (r) => `${r.used_by.employees}${r.used_by.branches ? ` · ${r.used_by.branches} br` : ""}` },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (r) => (
        <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"} dot>
          {r.status === "ACTIVE" ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Holidays"
        title="Holiday calendars"
        description="Keep each location's holidays right: calendars include others and can exclude what they inherit."
        actions={
          data?.can_create && (
            <Button onClick={() => modal.openModal()} data-testid="new-calendar">
              <Plus className="h-4 w-4" /> New calendar
            </Button>
          )
        }
      />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <SearchInput value={q} onChange={setQ} placeholder="Search code or name" />
          </div>
          <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="">All statuses</option>
          </Select>
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void reload()}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
        {error ? (
          <ErrorState message="Couldn't load the calendars." onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Holiday calendars"
              columns={columns}
              rows={data?.items}
              loading={loading && !data}
              busy={loading && !!data}
              rowKey={(r) => r.id}
              rowHref={(r) => `/holidays/calendars/${r.id}`}
              onRowClick={(r) => router.push(`/holidays/calendars/${r.id}`)}
              cardBelowMd
              empty={
                <EmptyState
                  icon={<CalendarRange />}
                  title="No calendars yet"
                  description="Start from your country's holidays: create a national calendar and include it where it applies."
                  action={data?.can_create ? <Button onClick={() => modal.openModal()}>New calendar</Button> : undefined}
                />
              }
            />
            {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} pageSizes={[50, 100]} onLimitChange={setLimit} />}
          </>
        )}
      </Card>
      <Modal open={modal.open} onOpenChange={modal.onOpenChange} title="New calendar" description="Own holidays, includes and exclusions come next." size="lg">
        <CalendarForm
          onDirtyChange={setDirty}
          onCancel={() => void modal.close()}
          onSaved={(saved) => {
            setDirty(false);
            router.push(`/holidays/calendars/${saved.id}?tab=includes`);
          }}
        />
      </Modal>
    </div>
  );
}
