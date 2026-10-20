"use client";

import { motion } from "framer-motion";
import { CalendarDays, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Holiday } from "@/lib/types";

export default function HolidaysPage() {
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_READ)}>
      <Holidays />
    </RequireAccess>
  );
}

function Holidays() {
  const { me } = useCan();
  const confirm = useConfirm();
  const manage = can(me, P.HOLIDAY_MANAGE);
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<"mine" | "all">(manage ? "all" : "mine");
  const [location, setLocation] = useState("");
  const { data, loading, reload } = useApi(
    () => api.get<Holiday[]>("/holidays", { params: { year, mine: view === "mine", location: view === "all" && location ? location : undefined } }),
    [year, view, location],
  );
  const { data: locations } = useApi(() => api.get<string[]>("/holidays/locations"), []);
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      const body = { name: editing.name, date: editing.date, location: editing.location || null, is_optional: !!editing.is_optional, description: editing.description || null };
      if (editing.id) await api.put(`/holidays/${editing.id}`, body);
      else await api.post("/holidays", body);
      toast.success("Holiday saved");
      setEditing(null);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (h: Holiday) => {
    if (!(await confirm({ title: `Delete ${h.name}?`, message: "Working-day calculations for future payroll will include this date again.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api.delete(`/holidays/${h.id}`);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const byMonth = (data ?? []).reduce<Record<string, Holiday[]>>((acc, h) => {
    const key = fmtDate(h.date, "MMMM");
    (acc[key] ||= []).push(h);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Holidays"
        description="Company holidays reduce working days in payroll. Location-specific holidays apply only to employees at that location."
        actions={manage && <Button onClick={() => setEditing({ date: `${year}-01-01` })}><Plus className="h-4 w-4" /> Add holiday</Button>}
      />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <Field label="Year" className="w-28"><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        <Field label="Calendar" className="w-48">
          <Select value={view} onChange={(e) => setView(e.target.value as "mine" | "all")}>
            <option value="mine">My calendar</option>
            <option value="all">All holidays</option>
          </Select>
        </Field>
        {view === "all" && (
          <Field label="Location" className="w-48">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">Every location</option>
              {locations?.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
        )}
      </Card>
      {loading && !data && <Skeleton className="h-64 rounded-2xl" />}
      {data && data.length === 0 && <Card><EmptyState icon={<CalendarDays />} title={`No holidays in ${year}`} /></Card>}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(byMonth).map(([month, holidays], i) => (
          <motion.div key={month} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{month}</p>
              <ul className="space-y-3">
                {holidays.map((h) => (
                  <li key={h.id} className="group flex items-start gap-3">
                    <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-primary-soft py-1.5 text-primary">
                      <span className="text-lg font-semibold leading-none">{fmtDate(h.date, "d")}</span>
                      <span className="text-[10px] uppercase">{fmtDate(h.date, "EEE")}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{h.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {h.location ? <Badge tone="info"><MapPin className="h-3 w-3" /> {h.location}</Badge> : <Badge>All locations</Badge>}
                        {h.is_optional && <Badge tone="warning">Optional</Badge>}
                      </div>
                    </div>
                    {manage && (
                      <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(h)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(h)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        ))}
      </div>
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit holiday" : "Add holiday"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <Field label="Name" required><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" required><Input type="date" value={editing.date ?? ""} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></Field>
              <Field label="Location" htmlFor="holiday-location" hint="Leave empty for every location">
                <Input id="holiday-location" list="holiday-locations" value={editing.location ?? ""} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
                <datalist id="holiday-locations">{locations?.map((l) => <option key={l} value={l} />)}</datalist>
              </Field>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
              Optional holiday (not deducted from working days)
              <Switch checked={!!editing.is_optional} onChange={(v) => setEditing({ ...editing, is_optional: v })} label="Optional" />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
