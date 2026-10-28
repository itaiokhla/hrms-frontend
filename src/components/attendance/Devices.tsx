"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ban, Copy, KeyRound, MonitorSmartphone, Pause, Play, Plus } from "lucide-react";
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

import { CaptureApiError, captureApi, type Device, type DeviceWithClaim } from "./captureApi";
import { DEVICE_STATUS } from "./captureModel";

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
export function DevicesWorkspace() {
  const branches = useBranches();
  const sites = useSiteNames();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const limit = 25;
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search); setSkip(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { q, status, skip, limit };
  const { data, error, loading, reload } = useApi(() => captureApi.devices(params), [JSON.stringify(params)]);
  const chips: FilterChip[] = status ? [{ key: "status", label: "Status", values: [DEVICE_STATUS[status]?.label ?? status] }] : [];

  const columns: Column<Device>[] = [
    { key: "code", header: "Code", primary: true, hideable: false,
      cell: (d) => <span className="font-mono font-semibold" data-testid={`device-row-${d.code}`} data-device-id={d.id}>{d.code}</span> },
    { key: "name", header: "Name", cell: (d) => d.name },
    { key: "kind", header: "Kind", hideOnMobile: true, cell: () => "Kiosk" },
    { key: "site", header: "Site / branch", cell: (d) => (d.site_id ? sites.name(d.site_id) : branches.name(d.branch_id)) },
    { key: "status", header: "Status", cell: (d) => <DeviceStatus status={d.status} /> },
    { key: "paired", header: "Paired", hideOnMobile: true, cell: (d) => (d.paired ? "Yes" : "No") },
    { key: "seen", header: "Last seen", hideOnMobile: true, cell: (d) => (d.last_seen_at ? fmtDateTime(d.last_seen_at) : "—") },
  ];

  return (
    <div>
      <PageHeader eyebrow="Attendance" title="Devices"
        description="Kiosks that people punch on: register one, pair the tablet with its claim code, suspend or retire it."
        actions={<Button data-testid="open-register-device" onClick={() => setRegistering(true)}><Plus className="h-4 w-4" aria-hidden /> Register device</Button>} />
      <Card>
        <FilterBar resultCount={data?.total}
          search={{ value: search, onChange: setSearch, placeholder: "Search devices…", label: "Search devices by code or name" }}
          chips={chips} onRemoveChip={() => { setStatus(""); setSkip(0); }} onClearAll={() => { setStatus(""); setSearch(""); setSkip(0); }}>
          <Field label="Status" className="w-48">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} data-testid="devices-filter-status">
              <option value="">All</option>
              {Object.entries(DEVICE_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
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
        onCreated={() => void reload()} />
      <Sheet open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)} title="Device"
        description="Status, pairing and actions">
        {openId !== null && <DeviceDetail id={openId} siteName={sites.name} branchName={branches.name} onChanged={() => void reload()} />}
      </Sheet>
    </div>
  );
}

function RegisterDevice({ open, onOpenChange, branches, sites, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: { id: number; label: string }[];
  sites: { id: number; name: string; branch_id: number | null }[];
  onCreated: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DeviceWithClaim | null>(null);
  const key = useMemo(() => newIdempotencyKey(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setCode(""); setName(""); setBranch(""); setSite(""); setError(null); setCreated(null);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = await captureApi.createDevice({
        code: code.trim().toUpperCase(), name: name.trim(), branch_id: branch ? Number(branch) : null, site_id: site ? Number(site) : null,
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
    <Modal open={open} onOpenChange={onOpenChange} title={created ? `Kiosk ${created.code} registered` : "Register a kiosk"}
      description={created ? undefined : "A browser kiosk at an entrance. Kiosk punches are recorded at the kiosk's site."}
      footer={created ? <Button onClick={() => onOpenChange(false)} data-testid="device-register-done">Done</Button> : undefined}>
      {created ? <ClaimCode device={created} /> : (
        <form onSubmit={submit} className="space-y-4" data-testid="device-form">
          <Field label="Device code" required hint="Letters, digits, dot, dash; e.g. KIOSK-BLR-L2.">
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
            <Field label="Site" hint="Kiosk punches are stored at this site.">
              <Select value={site} onChange={(e) => setSite(e.target.value)} data-testid="device-site">
                <option value="">No site</option>
                {sites.filter((s) => !branch || s.branch_id === Number(branch)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!code.trim() || !name.trim()} data-testid="device-save">Register</Button>
          </div>
        </form>
      )}
    </Modal>
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
