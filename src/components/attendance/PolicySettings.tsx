"use client";

import { Coffee, MapPin, Radar, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { AttendancePolicy } from "@/lib/types";

type PolicySettingsValues = Record<string, string | number | boolean>;

/** Attendance, lunch and location policy of this company (location settings: Company Administrators only). */
export function PolicySettings() {
  const { me } = useCan();
  const admin = !!me?.is_company_admin;
  const { data, setData, reload } = useApi(
    () => api.get<{ policy: AttendancePolicy; settings: PolicySettingsValues }>("/attendance/policy"),
    [],
  );
  const [saving, setSaving] = useState(false);
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const v = data.settings;
  const set = (key: string, value: string | number | boolean) => setData({ ...data, settings: { ...v, [key]: value } });
  const num = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value === "" ? "" : Number(e.target.value));

  const save = async () => {
    setSaving(true);
    try {
      setData(await api.patch<{ policy: AttendancePolicy; settings: PolicySettingsValues }>("/attendance/policy", v));
      toast.success("Attendance policy saved. Running shifts follow it from now on.");
    } catch (e) {
      toast.error(errorMessage(e));
      void reload();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: string, label: string, hint: ReactNode, adminOnly = false) => (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={!!v[key]} disabled={adminOnly && !admin} onChange={(value) => set(key, value)} label={label} />
    </label>
  );
  const mode = (key: string, label: string) => (
    <Field label={label}>
      <Select value={String(v[key])} disabled={!admin} onChange={(e) => set(key, e.target.value)}>
        <option value="OFF">Off: no location</option>
        <option value="OPTIONAL">Optional: try, never block</option>
        <option value="REQUIRED">Required: needs a reading or a reviewed exception</option>
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6" data-testid="attendance-policy">
      {!admin && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">Location settings can only be changed by a Company Administrator.</p>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Coffee className="h-4 w-4" /> Lunch and shifts</span>} />
          <div className="space-y-3 p-5">
            {toggle("allowMultipleLunches", "Allow more than one lunch break", "Each break is recorded separately; they can never overlap.")}
            {toggle("lunchIsPaid", "Lunch is paid", "Paid lunch is reported but not deducted from net working time.")}
            <Field label="Punch-out while on lunch">
              <Select value={String(v.lunchOpenAtPunchOut)} onChange={(e) => set("lunchOpenAtPunchOut", e.target.value)}>
                <option value="CONFIRM_AUTO_CLOSE">Ask to confirm, then end lunch at the punch-out</option>
                <option value="BLOCK">Require “End lunch” first</option>
              </Select>
            </Field>
            {toggle("requireFaceForLunch", "Face check at lunch", "Also verify the face when lunch starts and ends.")}
            <Field label="Close shifts left open after (hours)" hint="No punch-out is invented: the shift is flagged for HR correction.">
              <Input type="number" min={4} max={24} value={String(v.maxShiftHours)} onChange={num("maxShiftHours")} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Location at attendance actions</span>} />
          <div className="space-y-3 p-5">
            {mode("locationPunchPolicy", "Punch in and punch out")}
            {mode("locationLunchPolicy", "Lunch start and end")}
            <Field label="When a required location is unavailable">
              <Select value={String(v.locationExceptionPolicy)} disabled={!admin} onChange={(e) => set("locationExceptionPolicy", e.target.value)}>
                <option value="ALLOW_WITH_REASON">Allow with a written reason for the manager to review</option>
                <option value="BLOCK">Block: HR records the attendance instead</option>
              </Select>
            </Field>
            {toggle("locationRejectLowAccuracy", "Refuse approximate readings when required", "Readings less accurate than the acceptable radius need a reviewed exception.", true)}
          </div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Radar className="h-4 w-4" /> Periodic checks during the shift</span>}
            description="Best effort, web only: browsers pause hidden or closed pages, so missed checks are recorded rather than filled in." />
          <div className="space-y-3 p-5">
            {toggle("trackingEnabled", "Check location during shifts", "Only while punched in and only while the site is open in the employee's browser.", true)}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Every (minutes)" hint="Default 120"><Input type="number" disabled={!admin} value={String(v.trackingIntervalMinutes)} onChange={num("trackingIntervalMinutes")} /></Field>
              <Field label="Late after (minutes)" hint="Then the check counts as missed"><Input type="number" disabled={!admin} value={String(v.trackingGraceMinutes)} onChange={num("trackingGraceMinutes")} /></Field>
            </div>
            {toggle("trackingPauseOnLunch", "Pause during lunch", "Resumes one interval after lunch ends.", true)}
          </div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Accuracy, movement and retention</span>} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Preferred accuracy (m)"><Input type="number" disabled={!admin} value={String(v.gpsPreferredAccuracyM)} onChange={num("gpsPreferredAccuracyM")} /></Field>
            <Field label="Acceptable accuracy (m)" hint="Retry while worse than this"><Input type="number" disabled={!admin} value={String(v.gpsAcceptableAccuracyM)} onChange={num("gpsAcceptableAccuracyM")} /></Field>
            <Field label="Wait for a fix (seconds)"><Input type="number" disabled={!admin} value={String(v.gpsTimeoutSeconds)} onChange={num("gpsTimeoutSeconds")} /></Field>
            <Field label="Attempts per check"><Input type="number" disabled={!admin} value={String(v.gpsMaxAttempts)} onChange={num("gpsMaxAttempts")} /></Field>
            <Field label="Movement review threshold (m)" hint="Straight-line distance beyond both accuracy radii"><Input type="number" disabled={!admin} value={String(v.movementThresholdM)} onChange={num("movementThresholdM")} /></Field>
            <Field label="Keep coordinates for (days)" hint="Then they are deleted; the outcome stays"><Input type="number" disabled={!admin} value={String(v.locationRetentionDays)} onChange={num("locationRetentionDays")} /></Field>
          </div>
        </Card>
      </div>
      <div className="flex justify-end">
        <Button loading={saving} onClick={save}>Save attendance policy</Button>
      </div>
    </div>
  );
}
