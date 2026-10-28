"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Archive, ArrowLeft, Copy, MapPinned, Network, Pencil, Plus, QrCode, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useBranches } from "@/components/rosters/RosterPeriods";
import { FilterBar, type FilterChip } from "@/components/shared/FilterBar";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, type Column } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { CaptureApiError, captureApi, type NetworkTest, type Site } from "./captureApi";
import { SITE_KIND_LABEL, geometryText } from "./captureModel";
import { SiteForm } from "./SiteForm";
import { SiteMap } from "./SiteMap";

function StatusChip({ status }: { status: string }) {
  return <Badge tone={status === "ACTIVE" ? "success" : "neutral"} dot>{status === "ACTIVE" ? "Active" : "Archived"}</Badge>;
}

/**
 * `/attendance/sites` (09-ui-ux/02 §9.2): "Where may people punch, and how is it checked?" Columns Code, Name, Kind,
 * Branch, Geometry, IP ranges, QR, Outdoor, Effective, Status. `[New site]` opens `SiteForm` in a Modal; a row opens
 * the site page.
 */
export function SitesWorkspace() {
  const router = useRouter();
  const branches = useBranches();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [branch, setBranch] = useState("");
  const [skip, setSkip] = useState(0);
  const [creating, setCreating] = useState(false);
  const limit = 25;
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search); setSkip(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { q, status, branch_id: branch ? Number(branch) : undefined, skip, limit };
  const { data, error, loading, reload } = useApi(() => captureApi.sites(params), [JSON.stringify(params)]);

  const chips: FilterChip[] = [
    ...(status ? [{ key: "status", label: "Status", values: [status === "ACTIVE" ? "Active" : "Archived"] }] : []),
    ...(branch ? [{ key: "branch", label: "Branch", values: [branches.name(Number(branch))] }] : []),
  ];
  const columns: Column<Site>[] = [
    { key: "code", header: "Code", primary: true, hideable: false,
      cell: (s) => <span className="font-mono font-semibold" data-testid={`site-row-${s.code}`} data-site-id={s.id}>{s.code}</span> },
    { key: "name", header: "Name", cell: (s) => s.name },
    { key: "kind", header: "Kind", hideOnMobile: true, cell: (s) => SITE_KIND_LABEL[s.kind] ?? s.kind },
    { key: "branch", header: "Branch", hideOnMobile: true, cell: (s) => branches.name(s.branch_id) },
    { key: "geometry", header: "Geometry", cell: (s) => geometryText(s) },
    { key: "ip", header: "IP ranges", className: "tabular-nums", hideOnMobile: true, cell: (s) => s.ip_ranges.length || "—" },
    { key: "qr", header: "QR", hideOnMobile: true, cell: (s) => (s.qr_configured ? <Badge tone="info">On</Badge> : "Off") },
    { key: "outdoor", header: "Outdoor", hideOnMobile: true, cell: (s) => (s.outdoor ? "Yes" : "No") },
    { key: "effective", header: "Effective", hideOnMobile: true,
      cell: (s) => `${fmtDate(s.effective_from)}${s.effective_to ? ` – ${fmtDate(s.effective_to)}` : ""}` },
    { key: "status", header: "Status", cell: (s) => <StatusChip status={s.status} /> },
  ];

  return (
    <div>
      <PageHeader eyebrow="Attendance" title="Sites"
        description="Where people may punch, and how each punch is checked: an area on the map, the office network, or a QR poster."
        actions={<Button data-testid="open-new-site" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New site</Button>} />
      <Card>
        <FilterBar resultCount={data?.total}
          search={{ value: search, onChange: setSearch, placeholder: "Search sites…", label: "Search sites by code or name" }}
          chips={chips} onRemoveChip={(key) => { if (key === "status") setStatus(""); else setBranch(""); setSkip(0); }}
          onClearAll={() => { setStatus(""); setBranch(""); setSearch(""); setSkip(0); }}>
          <Field label="Status" className="w-36">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} data-testid="sites-filter-status">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
          {branches.items.length > 1 && (
            <Field label="Branch" className="w-48">
              <Select value={branch} onChange={(e) => { setBranch(e.target.value); setSkip(0); }} data-testid="sites-filter-branch">
                <option value="">All branches</option>
                {branches.items.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </Field>
          )}
        </FilterBar>
        {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : (
          <div data-testid="sites-table">
            <DataTable rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(s) => s.id} cardBelowMd
              caption="Sites" columns={columns} rowHref={(s) => `/attendance/sites/${s.id}`}
              onRowClick={(s) => router.push(`/attendance/sites/${s.id}`)}
              empty={<EmptyState icon={<MapPinned />} title={q || status || branch ? "No site matches these filters" : "No sites yet"}
                description="Add your offices, plants and project sites so punches can be checked against them."
                action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New site</Button>} />} />
            {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
          </div>
        )}
      </Card>
      <Modal open={creating} onOpenChange={setCreating} title="New site" size="xl"
        description="Draw the area people punch in, add the office network if you check it, then save.">
        <SiteForm site={null} onCancel={() => setCreating(false)}
          onSaved={(site) => { setCreating(false); void reload(); router.push(`/attendance/sites/${site.id}`); }} />
      </Modal>
    </div>
  );
}

/**
 * `/attendance/sites/{site_id}` (page twin of the `site` overlay): the drawing, the checks it supports, Edit,
 * Rotate QR… (the new poster payload is shown once), Network test and Archive.
 */
export function SiteDetailView({ id }: { id: string }) {
  const branches = useBranches();
  const confirm = useConfirm();
  const { data: site, error, loading, reload, setData } = useApi(() => captureApi.site(id), [id]);
  const [editing, setEditing] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkTest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) {
    return error.status === 404
      ? <Card className="mx-auto mt-10 max-w-lg"><EmptyState title="This site doesn't exist or you can't see it."
          action={<Link href="/attendance/sites" className="text-sm font-medium text-primary">Back to sites</Link>} /></Card>
      : <ErrorState message={error.message} onRetry={() => void reload()} />;
  }
  if (loading || !site) return <Skeleton className="h-96 w-full rounded-2xl" />;

  const rotate = async () => {
    const ok = await confirm({ title: "Rotate the QR poster?", message: "A new poster is created. The old poster stops working at once.",
      confirmLabel: "Rotate", tone: "danger" });
    if (!ok) return;
    setBusy("qr");
    try {
      const result = await captureApi.rotateQr(site.id, site.row_version);
      setPoster(result.qr_payload);
      setData(result);
      toast.success("New QR poster ready");
    } catch (e) {
      toast.error((e as Error).message);
      if ((e as CaptureApiError).code === "ROW_VERSION_CONFLICT") void reload();
    } finally {
      setBusy(null);
    }
  };
  const archive = async () => {
    const ok = await confirm({ title: `Archive ${site.code}?`, message: "Punches are no longer checked against this site.",
      confirmLabel: "Archive", tone: "danger" });
    if (!ok) return;
    setBusy("archive");
    try {
      setData(await captureApi.archiveSite(site.id, site.row_version));
      toast.success(`Site ${site.code} archived`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const testNetwork = async () => {
    setBusy("network");
    try {
      setNetwork(await captureApi.networkTest({ site_id: site.id }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="site-detail" data-site-id={site.id}>
      <Link href="/attendance/sites" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Sites
      </Link>
      <PageHeader eyebrow={`Site ${site.code}`} title={site.name}
        description={`${SITE_KIND_LABEL[site.kind] ?? site.kind} · ${branches.name(site.branch_id)} · ${geometryText(site)}`}
        actions={site.status === "ACTIVE" && <>
          <Button variant="secondary" onClick={testNetwork} loading={busy === "network"} data-testid="site-network-test">
            <Network className="h-4 w-4" aria-hidden /> Network test
          </Button>
          <Button variant="secondary" onClick={rotate} loading={busy === "qr"} data-testid="site-rotate-qr">
            <QrCode className="h-4 w-4" aria-hidden /> Rotate QR…
          </Button>
          <Button onClick={() => setEditing((v) => !v)} data-testid="site-edit"><Pencil className="h-4 w-4" aria-hidden /> {editing ? "Close editor" : "Edit"}</Button>
        </>} />

      <AnimatePresence>
        {poster && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-4 border-info/40 p-4" data-testid="site-qr-poster">
              <p className="mb-1 text-sm font-semibold">New poster payload — shown once</p>
              <p className="mb-2 text-xs text-muted-foreground">Print it as a QR code at the entrance. You won&apos;t see this again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs" data-testid="site-qr-payload">{poster}</code>
                <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(poster); toast.success("Copied"); }}>
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {editing ? (
        <Card className="p-5">
          <SiteForm site={site} onCancel={() => setEditing(false)} onSaved={(saved) => { setData(saved); setEditing(false); }} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Card>
            <CardHeader title="Details" action={<StatusChip status={site.status} />} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <Item label="Kind" value={SITE_KIND_LABEL[site.kind] ?? site.kind} />
              <Item label="Branch" value={branches.name(site.branch_id)} />
              <Item label="Area" value={geometryText(site)} />
              <Item label="Outdoor" value={site.outdoor ? "Yes" : "No"} />
              <Item label="Office network" value={site.ip_ranges.length ? site.ip_ranges.join(", ") : "Not checked"} mono />
              <Item label="QR poster" value={site.qr_configured ? "Configured" : "Not set up"} />
              <Item label="Effective" value={`${fmtDate(site.effective_from)}${site.effective_to ? ` – ${fmtDate(site.effective_to)}` : " onwards"}`} />
              <Item label="Version" value={`#${site.row_version}`} />
            </dl>
            {site.warnings.length > 0 && (
              <ul className="space-y-1 border-t border-border px-5 py-3 text-xs text-warning">{site.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
            <AnimatePresence>
              {network && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden border-t border-border" data-testid="site-network-result" data-match={network.matches.length > 0}>
                  <div className="space-y-1 px-5 py-4 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
                      We see you at <span className="font-mono">{network.client_ip}</span>
                      {network.is_private ? " (a private address)" : ""}
                    </p>
                    <p className={network.matches.length ? "text-success" : "text-warning"}>
                      {network.matches.length ? `Matches ${network.matches.map((m) => m.ranges.join(", ")).join("; ")}` : "No range of this site matches this address."}
                    </p>
                    {network.ipv6_hint && <p className="text-xs text-muted-foreground">{network.ipv6_hint}</p>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {site.status === "ACTIVE" && (
              <div className="flex justify-end border-t border-border px-5 py-3">
                <Button variant="danger-ghost" size="sm" onClick={archive} loading={busy === "archive"} data-testid="site-archive">
                  <Archive className="h-4 w-4" aria-hidden /> Archive site
                </Button>
              </div>
            )}
          </Card>
          <SiteMap site={site} />
        </div>
      )}
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{value}</dd>
    </div>
  );
}
