"use client";

import { CalendarRange, Save } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { LifecycleDates } from "@/lib/leave/adminTypes";

import { ErrorNotice } from "../shared";

const EMPTY: LifecycleDates = { probation_end_date: null, confirmation_date: null, notice_start_date: null, service_start_date: null };

const FIELDS: { key: keyof LifecycleDates; label: string; hint: string }[] = [
  { key: "service_start_date", label: "Service start", hint: "Counts tenure and anniversaries (blank = hire date)." },
  { key: "probation_end_date", label: "Probation ends", hint: "Types that block or only accrue during probation read this." },
  { key: "confirmation_date", label: "Confirmed on", hint: "Ends probation early; also a tenure basis." },
  { key: "notice_start_date", label: "Notice period starts", hint: "Types that block leave during notice read this." },
];

/**
 * Employee lifecycle dates for leave eligibility (`PUT /leaves/employees/{id}/lifecycle`): the four dates are saved
 * together; a blank date clears it. The API has no read of the current values, so they cannot be shown here first.
 */
export function LifecycleTab() {
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [dates, setDates] = useState<LifecycleDates>(EMPTY);
  const [saved, setSaved] = useState<LifecycleDates | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setDates(EMPTY);
    setSaved(null);
    setError(null);
  }, [employee]);
  const save = async () => {
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leaveAdminApi.setLifecycle(employee.id, dates);
      setSaved(result);
      toast.success(`Lifecycle dates of ${employee.full_name} saved`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-3xl space-y-5 p-5" data-testid="lifecycle-tab">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary"><CalendarRange className="h-5 w-5" aria-hidden /></span>
        <div>
          <h3 className="font-semibold">Employee lifecycle dates</h3>
          <p className="text-sm text-muted-foreground">The dates leave eligibility reads: waiting periods, probation and notice rules of the plan.</p>
        </div>
      </div>
      <Field label="Employee" required>
        <EmployeePicker value={employee} onChange={setEmployee} id="lifecycle-employee" />
      </Field>
      <Notice tone="warning" title="All four dates are saved together">
        Enter every date that applies: a blank date is cleared. Current values are not shown because the leave API has no read for them yet.
      </Notice>
      <fieldset disabled={!employee} className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input type="date" value={dates[f.key] ?? ""} onChange={(e) => setDates((d) => ({ ...d, [f.key]: e.target.value || null }))} data-testid={`lifecycle-${f.key}`} />
          </Field>
        ))}
      </fieldset>
      <ErrorNotice error={error} />
      {saved && <p className="text-sm text-success" role="status">Saved. Plans re-check eligibility from now on.</p>}
      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => void save()} loading={busy} disabled={!employee} data-testid="lifecycle-save"><Save className="h-4 w-4" /> Save dates</Button>
      </div>
    </Card>
  );
}
