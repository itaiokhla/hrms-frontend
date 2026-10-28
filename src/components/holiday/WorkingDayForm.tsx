"use client";

/**
 * Declare a working day (LH 04-holiday/01 §5.5, 03 §4): the body of modal `working-day` and of its full-page twin
 * `/holidays/calendars/{id}/working-days/new`. A declared working day turns a WEEKLY weekly off into work for everyone
 * on the calendar and on calendars that include it; on a published year it is an amendment (reason required).
 */

import { useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { errorMessage } from "@/lib/api";
import { yearsApi } from "@/lib/holiday/api";

export function WorkingDayForm({ calendarId, defaultDate = "", onSaved, onCancel, onDirty }: {
  calendarId: number;
  defaultDate?: string;
  onSaved: () => void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState({ date: defaultDate, name: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    onDirty?.(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await yearsApi.declareWorkingDay(calendarId, form);
      toast.success(`${form.date} is a working day`);
      onDirty?.(false);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="working-day-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required>
          <Input type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} />
        </Field>
        <Field label="Name" required>
          <Input value={form.name} maxLength={150} onChange={(e) => update({ name: e.target.value })} />
        </Field>
      </div>
      <Field label="Reason" required>
        <Textarea rows={2} maxLength={300} value={form.reason} onChange={(e) => update({ reason: e.target.value })} />
      </Field>
      {error && <Notice tone="danger" title={error} />}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={busy} disabled={!form.date || !form.name.trim() || !form.reason.trim()} onClick={() => void save()} data-testid="working-day-save">
          Declare
        </Button>
      </div>
    </div>
  );
}
