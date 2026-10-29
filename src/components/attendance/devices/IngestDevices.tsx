"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, CheckCircle2, Copy, FileUp, KeyRound, Link2, ListChecks, RefreshCcw, ShieldAlert, Terminal, Upload, Wand2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import toast from "react-hot-toast";

import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, Tabs } from "@/components/ui/layout";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { withStepUp } from "@/lib/payroll/api";

import {
  captureApi, type DeviceCommand, type DeviceConnection, type DeviceMapping, type FirstContact, type IngestDevice, type PunchImport,
} from "../captureApi";
import type { Tone } from "../captureModel";

/* ------------------------------------------------------------------ shared bits */

export const HEALTH: Record<string, { label: string; tone: Tone; hint: string }> = {
  ONLINE: { label: "Online", tone: "success", hint: "Seen in the last 30 minutes" },
  STALE: { label: "Stale", tone: "warning", hint: "Not seen for 30–90 minutes" },
  OFFLINE: { label: "Offline", tone: "danger", hint: "Not seen for over 90 minutes; days stay provisional until it syncs" },
  CLOCK_SKEW: { label: "Clock skew", tone: "warning", hint: "The device clock is more than 2 minutes off; queue Sync time" },
  UNKNOWN: { label: "Never seen", tone: "neutral", hint: "The device has not connected since activation" },
};

export const KIND_LABEL: Record<string, string> = { KIOSK: "Kiosk", TERMINAL: "Biometric terminal", AGENT: "Agent" };

export function HealthPill({ health }: { health: string | null | undefined }) {
  const h = HEALTH[health ?? "UNKNOWN"] ?? HEALTH.UNKNOWN;
  return (
    <span title={h.hint} data-testid="device-health" data-health={health ?? "UNKNOWN"}>
      <Badge tone={h.tone} dot>{h.label}</Badge>
    </span>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  toast.success("Copied");
}

const errorMessage = (e: unknown) => (e as Error).message;

/** The per-device secret, shown once after activation or rotation (SP-AS-010). */
export function SecretCard({ connection, kind }: { connection: DeviceConnection; kind: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/60 p-4" data-testid="device-secret-card">
      <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" aria-hidden /> Copy the secret into the device now</p>
      <p className="text-xs text-muted-foreground">{connection.instructions}</p>
      <dl className="grid gap-2 text-sm">
        {kind === "AGENT" ? (
          <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Agent id (X-Device-Id)</dt>
            <dd className="flex items-center gap-2 font-mono" data-testid="device-agent-id">{connection.agent_id}
              <button type="button" aria-label="Copy agent id" onClick={() => copy(connection.agent_id ?? "")}><Copy className="h-3.5 w-3.5" /></button></dd></div>
        ) : (
          <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Serial</dt>
            <dd className="font-mono">{connection.serial_number}</dd></div>
        )}
        <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Server path</dt>
          <dd className="font-mono">{connection.server_path}</dd></div>
      </dl>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-xl bg-surface px-3 py-2.5 font-mono text-sm" data-testid="device-secret">{connection.secret}</code>
        <Button variant="secondary" size="sm" onClick={() => copy(connection.secret)}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">You won&apos;t see this secret again. If it is lost, rotate it.</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ activation */

/** Activate a TERMINAL / AGENT: claim code, proof of possession (terminal), step-up; then the secret once. */
export function ActivateDevice({ device, open, onOpenChange, onActivated }: {
  device: IngestDevice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivated: () => void;
}) {
  const [claim, setClaim] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<DeviceConnection | null>(null);
  const [contact, setContact] = useState<FirstContact | null>(null);
  const terminal = device.kind === "TERMINAL";

  const loadContact = useCallback(() => {
    if (terminal) captureApi.firstContact(device.id).then(setContact).catch(() => setContact(null));
  }, [device.id, terminal]);

  useEffect(() => {
    if (open) {
      setClaim(""); setSerial(""); setError(null); setConnection(null);
      loadContact();
    }
  }, [open, loadContact]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await withStepUp(() => captureApi.activateDevice(device.id, { claim_code: claim.trim(), serial_number: terminal ? serial.trim() : undefined }));
      setConnection(result.connection);
      onActivated();
      toast.success(`${device.code} activated`);
    } catch (e) {
      setError(errorMessage(e));
      loadContact();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={connection ? `${device.code} is active` : `Activate ${device.code}`}
      description={connection ? undefined : terminal ? "Point the terminal's cloud server setting at this HRMS first. It appears here once it connects." : "Activate the agent, then configure it with the id and secret shown once."}
      footer={connection ? <Button onClick={() => onOpenChange(false)} data-testid="device-activate-done">Done</Button> : undefined}>
      {connection ? <SecretCard connection={connection} kind={device.kind} /> : (
        <div className="space-y-4" data-testid="device-activate-form">
          {terminal && (
            <div className={`rounded-2xl border p-3 text-sm ${contact?.seen ? "border-success/40 bg-success-soft/50" : "border-warning/40 bg-warning-soft/50"}`} data-testid="device-first-contact" data-seen={contact?.seen ? "yes" : "no"}>
              {contact?.seen ? (
                <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  <span>First contact {fmtDateTime(contact.first_seen_at ?? null)}, last {fmtDateTime(contact.last_seen_at ?? null)} from network {contact.ip_hash ?? "—"} ({contact.payload_count ?? 0} records waiting). Check this is your terminal.</span></p>
              ) : (
                <p className="flex items-start gap-2"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>Waiting for serial <span className="font-mono">{device.serial_number}</span> to connect. Set the server address and turn on cloud push on the terminal, then refresh.
                    <button type="button" className="ms-2 font-medium text-primary hover:underline" onClick={loadContact}>Refresh</button></span></p>
              )}
            </div>
          )}
          <Field label="Claim code" required hint="Shown once when the device was registered (valid 24 hours).">
            <Input value={claim} onChange={(e) => setClaim(e.target.value)} className="font-mono uppercase tracking-widest" maxLength={20} data-testid="device-activate-claim" />
          </Field>
          {terminal && (
            <Field label="Serial number on the terminal" required hint="Type it from the label or Menu › System info to confirm it is this device.">
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono uppercase" maxLength={64} data-testid="device-activate-serial" />
            </Field>
          )}
          {error && <p role="alert" className="text-sm font-medium text-danger" data-testid="device-activate-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={!claim.trim() || (terminal && !serial.trim())} data-testid="device-activate-submit">
              <Link2 className="h-4 w-4" aria-hidden /> Activate
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ detail of a TERMINAL / AGENT */

export function IngestDeviceDetail({ id, onChanged }: { id: number; onChanged?: () => void }) {
  const confirm = useConfirm();
  const summary = useApi(() => captureApi.deviceSummary(id), [id]);
  const [tab, setTab] = useState("overview");
  const [activating, setActivating] = useState(false);
  const [secret, setSecret] = useState<DeviceConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (summary.error) return <ErrorState message={summary.error.status === 404 ? "This device doesn't exist or you can't see it." : summary.error.message} />;
  if (!summary.data) return <Skeleton className="h-64" />;
  const { device } = summary.data;
  const can = (a: string) => device.allowed_actions.includes(a);
  const refresh = () => { void summary.reload(); onChanged?.(); };

  const run = async (action: "suspend" | "resume" | "retire" | "rotate") => {
    if (action !== "resume") {
      const ok = await confirm({
        title: { suspend: `Suspend ${device.code}?`, retire: `Retire ${device.code}?`, rotate: `Rotate the secret of ${device.code}?` }[action],
        message: { suspend: "Uploads are refused (403) until you resume; punches stay buffered on the device.",
          retire: "The serial is released and the device stops for good. Mappings and punches are kept.",
          rotate: "The old secret stops at once; the device is refused until you enter the new one." }[action],
        confirmLabel: { suspend: "Suspend", retire: "Retire", rotate: "Rotate" }[action], tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      if (action === "rotate") {
        const result = await withStepUp(() => captureApi.rotateSecret(device.id));
        setSecret(result.connection);
      } else {
        await captureApi.deviceAction(device.id, action, device.row_version);
      }
      toast.success({ suspend: "Device suspended", resume: "Device resumed", retire: "Device retired", rotate: "New secret issued" }[action]);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "mappings", label: "People", badge: summary.data.unmapped_user_ids || undefined },
    ...(device.integration === "PUSH" ? [{ value: "commands", label: "Commands" }] : []),
    { value: "rejects", label: "Rejected lines", badge: summary.data.open_rejects || undefined },
  ];

  return (
    <div className="space-y-5" data-testid="device-detail" data-status={device.status} data-device-code={device.code} data-kind={device.kind}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-lg font-semibold">{device.code}</p>
          <p className="text-sm text-muted-foreground">{device.name} · {KIND_LABEL[device.kind] ?? device.kind} · {device.vendor}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone={device.status === "ACTIVE" ? "success" : device.status === "PENDING_ACTIVATION" ? "warning" : device.status === "SUSPENDED" ? "danger" : "neutral"} dot>
            {device.status === "PENDING_ACTIVATION" ? "Waiting for activation" : device.status.charAt(0) + device.status.slice(1).toLowerCase()}
          </Badge>
          {device.status === "ACTIVE" && <HealthPill health={device.health} />}
        </div>
      </div>
      <AnimatePresence>{secret && <SecretCard connection={secret} kind={device.kind} />}</AnimatePresence>
      <div className="flex flex-wrap gap-2">
        {can("activate") && <Button onClick={() => setActivating(true)} data-testid="device-action-activate"><Link2 className="h-4 w-4" aria-hidden /> Activate</Button>}
        {can("rotate-secret") && <Button variant="secondary" onClick={() => run("rotate")} loading={busy === "rotate"} data-testid="device-action-rotate"><KeyRound className="h-4 w-4" aria-hidden /> Rotate secret</Button>}
        {can("resume") && <Button onClick={() => run("resume")} loading={busy === "resume"} data-testid="device-action-resume">Resume</Button>}
        {can("suspend") && <Button variant="secondary" onClick={() => run("suspend")} loading={busy === "suspend"} data-testid="device-action-suspend">Suspend</Button>}
        {can("retire") && <Button variant="danger-ghost" onClick={() => run("retire")} loading={busy === "retire"} data-testid="device-action-retire">Retire</Button>}
      </div>
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        {tab === "overview" && <Overview device={device} summary={summary.data} />}
        {tab === "mappings" && <MappingsPanel device={device} onChanged={refresh} />}
        {tab === "commands" && <CommandsPanel device={device} />}
        {tab === "rejects" && <RejectsPanel device={device} onChanged={refresh} />}
      </Tabs>
      <ActivateDevice device={device} open={activating} onOpenChange={setActivating} onActivated={refresh} />
    </div>
  );
}

function Overview({ device, summary }: { device: IngestDevice; summary: { punches: number; rejected_today: number; recent: import("../captureApi").DevicePunchRow[] } }) {
  const items: [string, string][] = [
    ["Serial / agent id", device.serial_number ?? "—"],
    ["Time zone", device.timezone ?? "—"],
    ["Direction", `${device.direction_mode.replace("_", " ").toLowerCase()} · ${device.device_role.replace("_", " ").toLowerCase()}`],
    ["Last seen", device.last_seen_at ? fmtDateTime(device.last_seen_at) : "Never"],
    ["Synced up to", device.watermark_at ? fmtDateTime(device.watermark_at) : "—"],
    ["Last punch", device.last_punch_at ? fmtDateTime(device.last_punch_at) : "—"],
    ["Back-fill from", device.backfill_from ?? "—"],
    ["Punches received", String(summary.punches)],
    ["Rejected lines today", String(summary.rejected_today)],
    ["Endpoint", device.endpoint],
  ];
  return (
    <div className="space-y-4" data-testid="device-overview">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-all font-medium">{v}</dd></div>)}
      </dl>
      {device.last_clock_skew_seconds ? (
        <p className="flex items-center gap-2 rounded-xl bg-warning-soft/60 p-3 text-sm"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          The clock was {Math.abs(device.last_clock_skew_seconds)} s off at the last real-time upload. Queue “Sync time”.</p>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-semibold">Recent punches</p>
        {summary.recent.length === 0 ? <p className="text-sm text-muted-foreground">No punches yet.</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border text-sm" data-testid="device-recent-punches">
            {summary.recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>{fmtDateTime(p.occurred_at)} · {p.employee ? p.employee.name : <span className="text-warning">Unmapped · PIN {p.device_user_id}</span>}</span>
                <span className="flex gap-1">
                  <Badge tone="neutral">{p.direction === "UNKNOWN" ? "—" : p.direction}</Badge>
                  <Badge tone={p.disposition === "USED" ? "success" : p.disposition === "PENDING" ? "warning" : "neutral"}>{p.disposition.replace("_", " ").toLowerCase()}</Badge>
                  {p.evidence_flags.map((f) => <Badge key={f} tone="danger">{f.replace("_", " ").toLowerCase()}</Badge>)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ mappings */

export function MappingsPanel({ device, onChanged }: { device: IngestDevice | null; onChanged?: () => void }) {
  const deviceId = device?.id ?? null;
  const { data, error, loading, reload } = useApi(() => captureApi.mappings({ device_id: deviceId, limit: 200 }), [deviceId]);
  const [pin, setPin] = useState("");
  const [person, setPerson] = useState<PickedEmployee | null>(null);
  const [scope, setScope] = useState<"device" | "all">(device ? "device" : "all");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ would_create?: number; skipped: { employee_code: string; reason: string }[] } | null>(null);

  const save = async (userId: string, employee: PickedEmployee | null, effectiveFrom = from) => {
    if (!employee || !userId.trim()) return;
    setBusy(`map-${userId}`);
    try {
      const result = await captureApi.saveMappings([{ device_id: scope === "device" ? deviceId : null, device_user_id: userId.trim(), employee_id: employee.id, effective_from: effectiveFrom }]);
      toast.success(result.mapped_dates ? `Mapped; ${result.mapped_dates} day(s) re-paired` : "Mapping saved");
      setPin(""); setPerson(null);
      void reload();
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const autoMatch = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "auto");
    try {
      const result = await captureApi.autoMatch({ device_id: scope === "device" ? deviceId : null, effective_from: from, dry_run: dryRun });
      if (dryRun) setPreview(result);
      else {
        setPreview(null);
        toast.success(`${result.created ?? 0} mapping(s) created${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
        void reload();
        onChanged?.();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <div className="space-y-5" data-testid="device-mappings">
      <div className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
        <Field label="Applies to">
          <Select value={scope} onChange={(e) => setScope(e.target.value as "device" | "all")} data-testid="mapping-scope" disabled={!device}>
            {device && <option value="device">This device only</option>}
            <option value="all">Every device</option>
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="mapping-from" /></Field>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={() => autoMatch(true)} loading={busy === "preview"} data-testid="mapping-auto-preview">
            <Wand2 className="h-4 w-4" aria-hidden /> Map by employee code
          </Button>
          <AnimatePresence>
            {preview && (
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-2 text-sm" data-testid="mapping-auto-result">
                <span>{preview.would_create ?? 0} to create{preview.skipped.length ? `, ${preview.skipped.length} skipped` : ""}</span>
                <Button size="sm" onClick={() => autoMatch(false)} loading={busy === "auto"} disabled={!preview.would_create} data-testid="mapping-auto-confirm">Create</Button>
                <button type="button" aria-label="Close" onClick={() => setPreview(null)}><X className="h-4 w-4" /></button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {!!data?.unmapped.length && (
        <div className="space-y-2" data-testid="unmapped-list">
          <p className="text-sm font-semibold">Unmapped people on the device</p>
          {data.unmapped.map((u) => <UnmappedRow key={`${u.device_id}-${u.device_user_id}`} user={u} busy={busy === `map-${u.device_user_id}`}
            onMap={(employee) => save(u.device_user_id, employee, (u.first_at ?? from).slice(0, 10) < from ? (u.first_at ?? from).slice(0, 10) : from)} />)}
        </div>
      )}
      <div className="grid gap-3 rounded-2xl border border-dashed border-border p-4 sm:grid-cols-[8rem_1fr_auto]">
        <Field label="Device user id (PIN)"><Input value={pin} onChange={(e) => setPin(e.target.value)} className="font-mono" maxLength={32} data-testid="mapping-pin" /></Field>
        <Field label="Employee"><EmployeePicker value={person} onChange={setPerson} /></Field>
        <div className="flex items-end"><Button onClick={() => save(pin, person)} disabled={!pin.trim() || !person} loading={busy === `map-${pin.trim()}`} data-testid="mapping-add">Add</Button></div>
      </div>
      {loading && !data ? <Skeleton className="h-32" /> : data && data.items.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="No mappings yet" description="Map each person's device PIN to the employee, or map everyone by employee code." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm" data-testid="mapping-list">
          {data?.items.map((m) => <MappingRow key={m.id} mapping={m} onEnded={() => void reload()} />)}
        </ul>
      )}
    </div>
  );
}

function UnmappedRow({ user, busy, onMap }: { user: { device_user_id: string; count: number; last_at: string | null }; busy: boolean; onMap: (e: PickedEmployee | null) => void }) {
  const [person, setPerson] = useState<PickedEmployee | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft/40 p-3" data-testid={`unmapped-${user.device_user_id}`}>
      <span className="font-mono font-semibold">PIN {user.device_user_id}</span>
      <span className="text-xs text-muted-foreground">{user.count} punch(es), last {fmtDateTime(user.last_at)}</span>
      <div className="min-w-[14rem] flex-1"><EmployeePicker value={person} onChange={setPerson} placeholder="Map to employee…" /></div>
      <Button size="sm" onClick={() => onMap(person)} disabled={!person} loading={busy} data-testid={`unmapped-map-${user.device_user_id}`}>Map</Button>
    </div>
  );
}

function MappingRow({ mapping, onEnded }: { mapping: DeviceMapping; onEnded: () => void }) {
  const [busy, setBusy] = useState(false);
  const end = async () => {
    setBusy(true);
    try {
      await captureApi.endMapping(mapping.id, new Date().toISOString().slice(0, 10), mapping.row_version);
      toast.success("Mapping ended");
      onEnded();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`mapping-${mapping.device_user_id}`}>
      <span><span className="font-mono font-semibold">{mapping.device_user_label}</span> → {mapping.employee?.name ?? `#${mapping.employee_id}`}
        <span className="ms-2 text-xs text-muted-foreground">{mapping.device_id ? "this device" : "every device"} · from {mapping.effective_from}{mapping.effective_to ? ` to ${mapping.effective_to}` : ""}</span></span>
      <span className="flex items-center gap-2">
        {mapping.sync_state !== "NOT_APPLICABLE" && <Badge tone={mapping.sync_state === "SYNCED" ? "success" : mapping.sync_state === "FAILED" ? "danger" : "warning"}>{mapping.sync_state.toLowerCase()}</Badge>}
        {!mapping.effective_to && <Button size="sm" variant="ghost" onClick={end} loading={busy}>End</Button>}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ commands */

const COMMANDS: { value: string; label: string }[] = [
  { value: "SYNC_TIME", label: "Sync time" },
  { value: "QUERY_USERS", label: "Read user list" },
  { value: "REFRESH_SETTINGS", label: "Refresh settings" },
  { value: "RESEND_LOGS", label: "Resend logs" },
];

function CommandsPanel({ device }: { device: IngestDevice }) {
  const { data, reload } = useApi(() => captureApi.deviceCommands(device.id), [device.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const queue = async (command: string) => {
    setBusy(command);
    try {
      await captureApi.queueCommand(device.id, command);
      toast.success("Queued; the terminal picks it up at its next poll");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (c: DeviceCommand) => {
    try {
      await captureApi.cancelCommand(device.id, c.id, c.row_version);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-4" data-testid="device-commands">
      <div className="flex flex-wrap gap-2">
        {COMMANDS.map((c) => <Button key={c.value} variant="secondary" size="sm" onClick={() => queue(c.value)} loading={busy === c.value}
          disabled={device.status !== "ACTIVE"} data-testid={`command-${c.value}`}><Terminal className="h-3.5 w-3.5" aria-hidden /> {c.label}</Button>)}
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border text-sm">
        {(data?.items ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`command-row-${c.id}`}>
            <span>{COMMANDS.find((x) => x.value === c.command)?.label ?? c.command} <span className="text-xs text-muted-foreground">· {fmtDateTime(c.created_at)}</span></span>
            <span className="flex items-center gap-2">
              <Badge tone={c.status === "ACKED" ? "success" : c.status === "FAILED" || c.status === "EXPIRED" ? "danger" : c.status === "QUEUED" ? "warning" : "neutral"}>{c.status.toLowerCase()}</Badge>
              {c.status === "QUEUED" && <Button size="sm" variant="ghost" onClick={() => cancel(c)}>Cancel</Button>}
            </span>
          </li>
        ))}
        {data && data.items.length === 0 && <li className="px-3 py-4 text-muted-foreground">No commands yet.</li>}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ rejects */

function RejectsPanel({ device, onChanged }: { device: IngestDevice; onChanged: () => void }) {
  const { data, reload } = useApi(() => captureApi.deviceRejects(device.id), [device.id]);
  const [raw, setRaw] = useState<Record<number, string | null>>({});
  const reveal = async (id: number) => {
    try {
      const r = await withStepUp(() => captureApi.revealReject(device.id, id));
      setRaw((m) => ({ ...m, [id]: r.raw_line }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const dismiss = async (id: number) => {
    try {
      await captureApi.dismissReject(device.id, id);
      void reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (data && data.items.length === 0) return <EmptyState icon={<CheckCircle2 />} title="No rejected lines" description="Every line the device sent could be read." />;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm" data-testid="device-rejects">
      {(data?.items ?? []).map((r) => (
        <li key={r.id} className="space-y-1 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span><Badge tone="danger">{r.reason.replace(/_/g, " ").toLowerCase()}</Badge> <span className="ms-1 text-xs text-muted-foreground">line {r.line_no} · {fmtDateTime(r.created_at)}</span></span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => reveal(r.id)}><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Show line</Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(r.id)}>Dismiss</Button>
            </span>
          </div>
          {raw[r.id] !== undefined && <code className="block break-all rounded-lg bg-surface-muted px-2 py-1 font-mono text-xs">{raw[r.id] ?? "—"}</code>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ CSV importer */

const ISSUE_LABEL: Record<string, string> = {
  UNMAPPED: "Unknown person", INVALID_TIME: "Invalid date or time", MISSING_PERSON: "No employee code or PIN",
  DUPLICATE_EXISTING: "Already recorded", DUPLICATE_IN_FILE: "Repeated in the file", AMBIGUOUS_LOCAL_TIME: "Repeated DST hour",
  NONEXISTENT_LOCAL_TIME: "Skipped DST hour", OUTSIDE_EMPLOYMENT: "Outside employment", INVALID_DIRECTION: "Unknown direction",
  INVALID_TIMEZONE: "Unknown time zone",
};

/** Drag-and-drop CSV punch import with a dry-run preview (01 §8.6). */
export function ImportDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PunchImport | null>(null);
  const [busy, setBusy] = useState<"dry" | "commit" | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setFile(null); setResult(null); } }, [open]);

  const check = async (picked: File) => {
    setFile(picked);
    setBusy("dry");
    try {
      setResult(await captureApi.importPunches(picked, true));
    } catch (e) {
      toast.error(errorMessage(e));
      setResult(null);
    } finally {
      setBusy(null);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag(false);
    const picked = event.dataTransfer.files?.[0];
    if (picked) void check(picked);
  };
  const commit = async () => {
    if (!result) return;
    setBusy("commit");
    try {
      const done = await captureApi.commitImport(result.id);
      setResult(done);
      toast.success(`${done.totals.inserted ?? 0} punch(es) imported`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const problems = useMemo(() => (result?.rows ?? []).filter((r) => r.issues.length), [result]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Import punches" description="CSV columns: employee_code or device_user_id, date, time, direction (IN/OUT, optional), timezone (optional).">
      <div className="space-y-5" data-testid="import-drawer">
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") input.current?.click(); }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-primary bg-primary-soft/50" : "border-border hover:border-primary/60"}`}
          data-testid="import-dropzone">
          <motion.span animate={{ y: drag ? -4 : 0 }}><Upload className="h-8 w-8 text-primary" aria-hidden /></motion.span>
          <p className="font-medium">{file ? file.name : "Drop a CSV file here or click to choose"}</p>
          <p className="text-xs text-muted-foreground">Up to 5 MB. Nothing is saved until you import.</p>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = ""; }} />
        </div>
        <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href="/api/v1/attendance/imports/template"><FileUp className="h-3.5 w-3.5" aria-hidden /> Download the template</a>
        {busy === "dry" && <Skeleton className="h-24" />}
        {result && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" data-testid="import-result" data-status={result.status}>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[["Rows", result.totals.rows], ["Valid", result.totals.valid], ["Unknown person", result.totals.unmapped], ["Duplicates", result.totals.duplicates]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-surface-muted p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            {problems.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-xl border border-border" data-testid="import-issues">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start">Row</th><th className="px-3 py-2 text-start">Person</th><th className="px-3 py-2 text-start">When</th><th className="px-3 py-2 text-start">Issues</th></tr></thead>
                  <tbody>
                    {problems.map((r) => (
                      <tr key={r.row} className="border-t border-border" data-testid={`import-row-${r.row}`}>
                        <td className="px-3 py-2">{r.row}</td>
                        <td className="px-3 py-2">{r.employee?.name ?? r.employee_code ?? (r.device_user_id ? `PIN ${r.device_user_id}` : "—")}</td>
                        <td className="px-3 py-2">{r.date} {r.time}</td>
                        <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{r.issues.map((i) => <Badge key={i} tone={i === "INVALID_TIME" || i === "MISSING_PERSON" ? "danger" : "warning"}>{ISSUE_LABEL[i] ?? i}</Badge>)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.status === "COMMITTED" ? (
              <p className="flex items-center gap-2 text-sm font-medium text-success" data-testid="import-done"><CheckCircle2 className="h-4 w-4" aria-hidden /> Imported {result.totals.inserted ?? 0} punch(es). Unknown people wait in the device mappings.</p>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => file && check(file)} disabled={!file}><RefreshCcw className="h-4 w-4" aria-hidden /> Check again</Button>
                <Button onClick={commit} loading={busy === "commit"} disabled={!result.totals.valid} data-testid="import-commit">Import {result.totals.valid} row(s)</Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </Sheet>
  );
}
