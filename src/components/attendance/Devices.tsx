"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ban, Copy, KeyRound, Link2, MonitorSmartphone, Pause, Play, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useBranches } from "@/components/rosters/RosterPeriods";
import { FilterBar, type FilterChip } from "@/components/shared/FilterBar";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, type Column } from "@/components/ui/layout";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { CaptureApiError, captureApi, type Device, type DeviceWithClaim, type IngestDevice } from "./captureApi";
import { DEVICE_STATUS } from "./captureModel";
import { HealthPill, ImportDrawer, IngestDeviceDetail, KIND_LABEL, MappingsPanel } from "./devices/IngestDevices";
import { useCan } from "@/components/access/Can";
import { Segmented } from "@/components/ui/segmented";
import { attendanceV2 } from "@/lib/attendance-routes";

function DeviceStatus({ status }: { status: string }) {
  const s = DEVICE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

function useSiteNames() {
  const { data } = useApi(() => captureApi.sites({ status: "ACTIVE", limit: 200 }).catch(() => null), []);
  return useMemo(() => {
    const items = data?.items ?? [];
    return { items, name: (id: number | null | undefined) => (id ? items.find((s) => s.id === id)?.name ?? `Site #${id}` : "—") };
  }, [data]);
}

/** The one-time claim code card: "Enter this code on the tablet" (04-attendance/01 §5.1 step 1). */
export function ClaimCode({ device }: { device: DeviceWithClaim }) {
  if (!device.claim_code) return null;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/60 p-4" data-testid="device-claim">
      <p className="text-sm font-semibold">Enter this code on the tablet</p>
      <p className="text-xs text-muted-foreground">
        On the kiosk, open <span className="font-mono">/kiosk/pair</span>, type the device code <span className="font-mono font-semibold">{device.code}</span> and
        this claim code. It is shown once and works for 24 hours{device.claim_code_expires_at ? ` (until ${fmtDateTime(device.claim_code_expires_at)})` : ""}.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-xl bg-surface px-4 py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em]"
          data-testid="device-claim-code">{device.claim_code}</code>
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(device.claim_code ?? ""); toast.success("Copied"); }}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">You won&apos;t see this code again. If it is lost, issue a new one.</p>
    </motion.div>
  );
}

/**
 * `/attendance/devices` (09-ui-ux/02 §9.1; KIOSK only in AS-M2): the registry with status and pairing. `[Register
 * device]` creates a kiosk and shows its claim code once; a row opens the device Sheet with New claim code, Suspend,
 * Resume (re-pair with a fresh code: a revoked token is never revived, K-3) and Retire.
 */
export function DevicesWorkspace({ eyebrow = "Attendance" }: { eyebrow?: string } = {}) {
  const branches = useBranches();
  const sites = useSiteNames();
  const { me } = useCan();
  const v2 = !!me && attendanceV2(me);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [skip, setSkip] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const limit = 25;
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search); setSkip(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { q, status, kind, skip, limit };
  const { data, error, loading, reload } = useApi(() => captureApi.devices(params), [JSON.stringify(params)]);
  // Health chips are computed at read: refresh the console every minute (01 §7.2).
  useEffect(() => {
    const timer = setInterval(() => void reload(), 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const chips: FilterChip[] = [
    ...(status ? [{ key: "status", label: "Status", values: [DEVICE_STATUS[status]?.label ?? status] }] : []),
    ...(kind ? [{ key: "kind", label: "Kind", values: [KIND_LABEL[kind] ?? kind] }] : []),
  ];
  const openDevice = data?.items.find((d) => d.id === openId);

  const columns: Column<Device & Partial<IngestDevice>>[] = [
    { key: "code", header: "Code", primary: true, hideable: false,
      cell: (d) => <span className="font-mono font-semibold" data-testid={`device-row-${d.code}`} data-device-id={d.id}>{d.code}</span> },
    { key: "name", header: "Name", cell: (d) => d.name },
    { key: "kind", header: "Kind", hideOnMobile: true, cell: (d) => KIND_LABEL[d.kind] ?? d.kind },
    { key: "site", header: "Site / branch", cell: (d) => (d.site_id ? sites.name(d.site_id) : branches.name(d.branch_id)) },
    { key: "status", header: "Status", cell: (d) => <DeviceStatus status={d.status} /> },
    { key: "health", header: "Health", cell: (d) => (d.kind === "KIOSK" ? (d.paired ? "Paired" : "Not paired")
      : d.status === "ACTIVE" ? <HealthPill health={d.health} /> : "—") },
    { key: "seen", header: "Last seen", hideOnMobile: true, cell: (d) => (d.last_seen_at ? fmtDateTime(d.last_seen_at) : "—") },
  ];

  return (
    <div>
      <PageHeader eyebrow={eyebrow} title="Devices"
        description="Kiosks, biometric terminals and agents that record punches: register and activate them, map device PINs to people, import punch files."
        actions={(
          <div className="flex flex-wrap gap-2">
            {v2 && <Button variant="secondary" data-testid="open-device-mappings" onClick={() => setMapping(true)}><Link2 className="h-4 w-4" aria-hidden /> Map people</Button>}
            {v2 && <Button variant="secondary" data-testid="open-import" onClick={() => setImporting(true)}><Upload className="h-4 w-4" aria-hidden /> Import punches</Button>}
            <Button data-testid="open-register-device" onClick={() => setRegistering(true)}><Plus className="h-4 w-4" aria-hidden /> Register device</Button>
          </div>
        )} />
      <Card>
        <FilterBar resultCount={data?.total}
          search={{ value: search, onChange: setSearch, placeholder: "Search devices…", label: "Search devices by code or name" }}
          chips={chips} onRemoveChip={(key) => { if (key === "kind") setKind(""); else setStatus(""); setSkip(0); }}
          onClearAll={() => { setStatus(""); setKind(""); setSearch(""); setSkip(0); }}>
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} data-testid="devices-filter-status">
              <option value="">All</option>
              {Object.entries(DEVICE_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Kind" className="w-48">
            <Select value={kind} onChange={(e) => { setKind(e.target.value); setSkip(0); }} data-testid="devices-filter-kind">
              <option value="">All</option>
              {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        </FilterBar>
        {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : (
          <div data-testid="devices-table">
            <DataTable rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(d) => d.id} cardBelowMd
              caption="Devices" columns={columns} onRowClick={(d) => setOpenId(d.id)}
              empty={<EmptyState icon={<MonitorSmartphone />} title={q || status ? "No device matches these filters" : "No devices yet"}
                description="Register a kiosk, then pair the tablet at its entrance with the claim code."
                action={<Button onClick={() => setRegistering(true)}><Plus className="h-4 w-4" aria-hidden /> Register device</Button>} />} />
            {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
          </div>
        )}
      </Card>
      <RegisterDevice open={registering} onOpenChange={setRegistering} branches={branches.items} sites={sites.items}
        onCreated={() => void reload()} allowIngest={v2} />
      <Sheet open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)} title="Device"
        description={openDevice && openDevice.kind !== "KIOSK" ? "Health, people, commands and rejected lines" : "Status, pairing and actions"}>
        {openId !== null && (openDevice && openDevice.kind !== "KIOSK"
          ? <IngestDeviceDetail id={openId} onChanged={() => void reload()} />
          : <DeviceDetail id={openId} siteName={sites.name} branchName={branches.name} onChanged={() => void reload()} />)}
      </Sheet>
      <Sheet open={mapping} onOpenChange={setMapping} title="Map device PINs to people" description="Tenant-wide mappings apply to every terminal and to CSV imports.">
        {mapping && <MappingsPanel device={null} onChanged={() => void reload()} />}
      </Sheet>
      <ImportDrawer open={importing} onOpenChange={setImporting} />
    </div>
  );
}

type Kind = "KIOSK" | "TERMINAL" | "AGENT";

function RegisterDevice({ open, onOpenChange, branches, sites, onCreated, allowIngest }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: { id: number; label: string }[];
  sites: { id: number; name: string; branch_id: number | null }[];
  onCreated: () => void;
  allowIngest: boolean;
}) {
  const [kind, setKind] = useState<Kind>("KIOSK");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [site, setSite] = useState("");
  const [serial, setSerial] = useState("");
  const [vendor, setVendor] = useState("ZKTECO");
  const [direction, setDirection] = useState("FIRST_LAST");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DeviceWithClaim | null>(null);
  const key = useMemo(() => newIdempotencyKey(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setKind("KIOSK"); setCode(""); setName(""); setBranch(""); setSite(""); setSerial(""); setVendor("ZKTECO");
      setDirection("FIRST_LAST"); setError(null); setCreated(null);
    }
  }, [open]);
  useEffect(() => { setVendor(kind === "AGENT" ? "SUPREMA" : "ZKTECO"); }, [kind]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = await captureApi.createDevice({
        code: code.trim().toUpperCase(), name: name.trim(), branch_id: branch ? Number(branch) : null, site_id: site ? Number(site) : null,
        kind, ...(kind === "KIOSK" ? {} : { vendor, direction_mode: direction, serial_number: serial.trim().toUpperCase() || null }),
      }, key);
      setCreated(device);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={created ? `${KIND_LABEL[created.kind] ?? "Device"} ${created.code} registered` : "Register a device"}
      description={created ? undefined : kind === "KIOSK" ? "A browser kiosk at an entrance. Kiosk punches are recorded at the kiosk's site."
        : kind === "TERMINAL" ? "A ZKTeco / eSSL terminal that pushes punches over the internet (ADMS). Activate it after it first connects."
          : "A small program on your network that reads Suprema, Hikvision or other devices and sends signed batches."}
      footer={created ? <Button onClick={() => onOpenChange(false)} data-testid="device-register-done">Done</Button> : undefined}>
      {created ? (created.kind === "KIOSK" ? <ClaimCode device={created} /> : <ActivationClaim device={created} />) : (
        <form onSubmit={submit} className="space-y-4" data-testid="device-form">
          {allowIngest && (
            <div data-testid="device-kind">
              <Segmented label="Kind" value={kind} onChange={setKind}
                options={[{ value: "KIOSK", label: "Kiosk" }, { value: "TERMINAL", label: "Biometric terminal" }, { value: "AGENT", label: "Agent" }]} />
            </div>
          )}
          <Field label="Device code" required hint="Letters, digits, dot, dash; e.g. KIOSK-BLR-L2 or DEV-PUNE-GATE-A.">
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono uppercase" maxLength={40} data-testid="device-code" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="device-name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch">
              <Select value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="device-branch">
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </Field>
            <Field label="Site" hint="Punches from this device are stored at this site.">
              <Select value={site} onChange={(e) => setSite(e.target.value)} data-testid="device-site">
                <option value="">No site</option>
                {sites.filter((s) => !branch || s.branch_id === Number(branch)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          <AnimatePresence initial={false}>
            {kind !== "KIOSK" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="grid gap-4 overflow-hidden sm:grid-cols-2">
                {kind === "TERMINAL" && (
                  <Field label="Serial number" required hint="On the label or in Menu › System info.">
                    <Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono uppercase" maxLength={64} data-testid="device-serial" />
                  </Field>
                )}
                <Field label="Make">
                  <Select value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="device-vendor">
                    {(kind === "TERMINAL" ? ["ZKTECO", "ESSL", "OTHER"] : ["SUPREMA", "HIKVISION", "MATRIX", "ZKTECO", "ESSL", "MANTRA", "REALTIME", "OTHER"])
                      .map((v) => <option key={v} value={v}>{v === "ZKTECO" ? "ZKTeco" : v === "ESSL" ? "eSSL" : v.charAt(0) + v.slice(1).toLowerCase()}</option>)}
                  </Select>
                </Field>
                <Field label="In / out from" hint="First and last scan of the day, or the IN/OUT key pressed on the device.">
                  <Select value={direction} onChange={(e) => setDirection(e.target.value)} data-testid="device-direction">
                    <option value="FIRST_LAST">First and last scan</option>
                    <option value="DEVICE_STATE">IN / OUT key on the device</option>
                  </Select>
                </Field>
              </motion.div>
            )}
          </AnimatePresence>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!code.trim() || !name.trim() || (kind === "TERMINAL" && !serial.trim())} data-testid="device-save">Register</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** The claim code of a TERMINAL / AGENT: kept for the Activate step (shown once). */
function ActivationClaim({ device }: { device: DeviceWithClaim }) {
  if (!device.claim_code) return null;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/60 p-4" data-testid="device-claim">
      <p className="text-sm font-semibold">Keep this claim code for activation</p>
      <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
        {device.kind === "TERMINAL" ? (<>
          <li>On the terminal, set the cloud server address to this HRMS and turn on push.</li>
          <li>Wait until it connects (it shows up in the Activate dialog), then open the device and choose Activate.</li>
        </>) : (<li>Open the device and choose Activate; you get the agent id and secret once.</li>)}
      </ol>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-xl bg-surface px-4 py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em]"
          data-testid="device-claim-code">{device.claim_code}</code>
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(device.claim_code ?? ""); toast.success("Copied"); }}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Valid 24 hours and shown once. If it is lost, issue a new one from the device.</p>
    </motion.div>
  );
}

/** Device details and transitions (Sheet body and the `/attendance/devices/{device_id}` page). */
export function DeviceDetail({ id, siteName, branchName, onChanged }: {
  id: number | string;
  siteName: (id: number | null | undefined) => string;
  branchName: (id: number | null | undefined) => string;
  onChanged?: () => void;
}) {
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useApi(() => captureApi.device(id), [id]);
  const [claim, setClaim] = useState<DeviceWithClaim | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <ErrorState message={error.status === 404 ? "This device doesn't exist or you can't see it." : error.message} />;
  if (loading || !data) return <Skeleton className="h-64" />;

  const run = async (action: "reissue" | "suspend" | "resume" | "retire") => {
    if (action === "retire" || action === "suspend") {
      const ok = await confirm({
        title: action === "retire" ? `Retire ${data.code}?` : `Suspend ${data.code}?`,
        message: action === "retire" ? "The kiosk stops working for good." : "The kiosk stops at once; resuming needs a new pairing.",
        confirmLabel: action === "retire" ? "Retire" : "Suspend", tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const result = action === "reissue" ? await captureApi.reissueClaim(data.id) : await captureApi.deviceAction(data.id, action, data.row_version);
      setData(result);
      setClaim(result.claim_code ? result : null);
      onChanged?.();
      toast.success({ reissue: "New claim code issued", resume: "Device ready to pair again", suspend: "Device suspended",
        retire: "Device retired" }[action]);
    } catch (e) {
      toast.error((e as Error).message);
      if ((e as CaptureApiError).code === "ROW_VERSION_CONFLICT") void reload();
    } finally {
      setBusy(null);
    }
  };

  const can = (a: string) => data.allowed_actions.includes(a);
  return (
    <div className="space-y-5" data-testid="device-detail" data-status={data.status} data-device-code={data.code}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-lg font-semibold">{data.code}</p>
          <p className="text-sm text-muted-foreground">{data.name}</p>
        </div>
        <DeviceStatus status={data.status} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Site</dt><dd className="font-medium">{siteName(data.site_id)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Branch</dt><dd className="font-medium">{branchName(data.branch_id)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Time zone</dt><dd className="font-medium">{data.timezone ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Paired</dt><dd className="font-medium">{data.paired ? `Yes, until ${fmtDateTime(data.token_expires_at)}` : "No"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Activated</dt><dd className="font-medium">{data.activated_at ? fmtDateTime(data.activated_at) : "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Last seen</dt><dd className="font-medium">{data.last_seen_at ? fmtDateTime(data.last_seen_at) : "—"}</dd></div>
      </dl>
      <AnimatePresence>{claim && <ClaimCode device={claim} />}</AnimatePresence>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {can("reissue-claim-code") && (
          <Button onClick={() => run("reissue")} loading={busy === "reissue"} data-testid="device-action-reissue">
            <KeyRound className="h-4 w-4" aria-hidden /> New claim code
          </Button>
        )}
        {can("resume") && (
          <Button onClick={() => run("resume")} loading={busy === "resume"} data-testid="device-action-resume">
            <Play className="h-4 w-4" aria-hidden /> Resume (pair again)
          </Button>
        )}
        {can("suspend") && (
          <Button variant="secondary" onClick={() => run("suspend")} loading={busy === "suspend"} data-testid="device-action-suspend">
            <Pause className="h-4 w-4" aria-hidden /> Suspend
          </Button>
        )}
        {can("retire") && (
          <Button variant="danger-ghost" onClick={() => run("retire")} loading={busy === "retire"} data-testid="device-action-retire">
            <Ban className="h-4 w-4" aria-hidden /> Retire
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Kiosk screen: <Link href="/kiosk/device" className="font-mono text-primary hover:underline">/kiosk/device</Link> · pairing:
        {" "}<Link href="/kiosk/pair" className="font-mono text-primary hover:underline">/kiosk/pair</Link>
      </p>
    </div>
  );
}
