"use client";

import { motion } from "framer-motion";
import { Crosshair, LocateFixed, MapPin, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { captureLocation } from "@/lib/geolocation";
import { newKey, teamApi, type PunchLocation, type TeamMember, type TeamSettings } from "@/lib/teamAttendance";

/** Punch one team member, or several at once, in or out (IG-AS-99): the manager's device position, or one entered by
 * hand when allowed. A batch reports who was punched and who was refused (and why) without undoing the others. */
export function ProxyPunchModal({ member, members, direction, settings, onClose, onDone }: {
  member: TeamMember | null;
  members?: TeamMember[] | null;
  direction: "IN" | "OUT";
  settings: TeamSettings;
  onClose: () => void;
  onDone: () => void;
}) {
  const batch = members && members.length > 0 ? members : null;
  const [failures, setFailures] = useState<{ name: string; message: string }[]>([]);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"DEVICE" | "MANUAL">("DEVICE");
  const [device, setDevice] = useState<PunchLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const open = member !== null || batch !== null;
  const locationMode = settings.proxy_punch_location;

  useEffect(() => {
    if (!open) return;
    setFailures([]);
    setReason("");
    setDevice(null);
    setLocError(null);
    setMode("DEVICE");
    setLat("");
    setLng("");
    setAddress("");
  }, [open, member?.employee_id, direction]);

  const locate = async () => {
    setLocating(true);
    setLocError(null);
    const attempt = await captureLocation({ timeoutMs: 15000, maxAttempts: 2, acceptableAccuracyM: 200, maxFixAgeSeconds: 120,
      allowPrompt: true });
    setLocating(false);
    if (attempt.status === "CAPTURED" && attempt.latitude != null && attempt.longitude != null) {
      setDevice({ source: "DEVICE", latitude: attempt.latitude, longitude: attempt.longitude, accuracy_m: attempt.accuracy_m ?? null });
    } else {
      setLocError(settings.allow_manual_location
        ? "This device could not give a position. Enter the location by hand instead."
        : "This device could not give a position. Allow location access and try again.");
      if (settings.allow_manual_location) setMode("MANUAL");
    }
  };

  const manual: PunchLocation | null = lat && lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))
    ? { source: "MANUAL", latitude: Number(lat), longitude: Number(lng), address: address.trim() || null } : null;
  const location = locationMode === "OFF" ? null : mode === "DEVICE" ? device : manual;
  const missingLocation = locationMode === "REQUIRED" && !location;
  const missingReason = settings.reason_required && reason.trim().length < 3;

  const verb = direction === "IN" ? "in" : "out";
  const submit = async () => {
    if (!member && !batch) return;
    setSaving(true);
    try {
      if (batch) {
        const result = await teamApi.bulkPunch({ employee_ids: batch.map((m) => m.employee_id), direction,
          reason: reason.trim() || undefined, location, idempotency_key: newKey(), client_sent_at: new Date().toISOString() });
        const names = new Map(batch.map((m) => [m.employee_id, m.name]));
        const refused = result.results.filter((r) => !r.ok)
          .map((r) => ({ name: names.get(r.employee_id) ?? `#${r.employee_id}`, message: r.message ?? r.code ?? "Refused" }));
        if (result.done) toast.success(`${result.done} ${result.done === 1 ? "person" : "people"} punched ${verb}`);
        if (refused.length) {
          setFailures(refused);  // keep the dialog open: who was not punched and why; Close refreshes the board
          return;
        }
        onDone();
        return;
      }
      await teamApi.punch({ employee_id: member!.employee_id, direction, reason: reason.trim() || undefined, location,
        idempotency_key: newKey(), client_sent_at: new Date().toISOString() });
      toast.success(`${member!.name} punched ${verb}`);
      onDone();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const title = batch ? `Punch ${batch.length} ${batch.length === 1 ? "person" : "people"} ${verb}` : `Punch ${member?.name ?? ""} ${verb}`;
  return (
    <Modal open={open} onOpenChange={(o) => !o && (failures.length ? onDone() : onClose())}
      title={title}
      description="Recorded as your action, with the time now and the location below. Each employee is notified."
      footer={failures.length ? (
        <Button data-testid="proxy-bulk-close" onClick={onDone}>Close</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button data-testid="proxy-submit" loading={saving} disabled={missingLocation || missingReason} onClick={submit}>
            Punch {batch ? `${batch.length} ` : ""}{verb}
          </Button>
        </>
      )}>
      <div className="space-y-4" data-testid="proxy-punch">
        {batch && (
          <div className="flex flex-wrap gap-1.5" data-testid="proxy-bulk-names">
            {batch.map((m) => <Badge key={m.employee_id}>{m.name}</Badge>)}
          </div>
        )}
        {failures.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} data-testid="proxy-bulk-failures"
            className="space-y-1 rounded-2xl border border-warning/40 bg-warning/5 p-3 text-sm">
            <li className="font-medium">Not punched {verb}:</li>
            {failures.map((f) => <li key={f.name}><span className="font-medium">{f.name}</span> — {f.message}</li>)}
          </motion.ul>
        )}
        {locationMode !== "OFF" && (
          <section className="space-y-3 rounded-2xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium"><MapPin className="h-4 w-4" /> Location
                {locationMode === "REQUIRED" ? <Badge tone="warning">Required</Badge> : <Badge>Optional</Badge>}</p>
              {settings.allow_manual_location && (
                <div className="flex gap-1" role="radiogroup">
                  <Button size="sm" variant={mode === "DEVICE" ? "subtle" : "ghost"} data-testid="proxy-mode-device"
                    onClick={() => setMode("DEVICE")}><LocateFixed className="h-3.5 w-3.5" /> This device</Button>
                  <Button size="sm" variant={mode === "MANUAL" ? "subtle" : "ghost"} data-testid="proxy-mode-manual"
                    onClick={() => setMode("MANUAL")}><PenLine className="h-3.5 w-3.5" /> Enter by hand</Button>
                </div>
              )}
            </div>
            {mode === "DEVICE" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" loading={locating} data-testid="proxy-locate" onClick={() => void locate()}>
                  <Crosshair className="h-4 w-4" /> Use my current location
                </Button>
                {device && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-success" data-testid="proxy-device-reading">
                    {device.latitude.toFixed(5)}, {device.longitude.toFixed(5)}{device.accuracy_m ? ` · ±${Math.round(device.accuracy_m)} m` : ""}
                  </motion.span>
                )}
                {locError && <span className="text-xs text-danger">{locError}</span>}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Latitude" required><Input data-testid="proxy-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="12.9716" /></Field>
                <Field label="Longitude" required><Input data-testid="proxy-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="77.5946" /></Field>
                <Field label="Address or place" className="sm:col-span-2">
                  <Input data-testid="proxy-address" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Client office, MG Road" />
                </Field>
              </div>
            )}
          </section>
        )}
        <Field label="Reason" required={settings.reason_required} hint={`${reason.length}/500`}>
          <Textarea data-testid="proxy-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="For example: phone battery died, at a client site without network" />
        </Field>
      </div>
    </Modal>
  );
}
