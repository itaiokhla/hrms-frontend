"use client";

import { Ban, Building2, Briefcase, LogOut, Palette, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { PartnersPanel, PlatformBrandPanel } from "@/app/platform/PartnersPanel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, PageHeader, SearchInput, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { platformCall } from "@/lib/platform";

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  subscription_status: "trialing" | "active" | "past_due" | "canceled";
  subscription_plan: string;
  trial_ends_at: string | null;
  created_at: string;
  user_count: number;
  active_user_count: number;
  employee_count: number;
  partner_id: number | null;
  brand_disabled: boolean;
  brand_disabled_reason: string | null;
  hosts: string[];
}
interface PartnerOption {
  id: number;
  name: string;
}

async function platformGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return platformCall(() => api.get<T>(url, { params }));
}

export default function PlatformConsole() {
  const router = useRouter();
  const [admin, setAdmin] = useState<{ email: string; full_name: string } | null>(null);
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [tab, setTab] = useState("tenants");
  const [q, setQ] = useState("");
  const [kill, setKill] = useState<CompanyRow | null>(null);
  const query = useDebounced(q);

  const load = useCallback(async () => {
    try {
      setRows((await platformGet<{ items: CompanyRow[] }>("/platform/companies", { q: query || undefined, limit: 200 })).items);
      setPartners((await platformGet<{ partners: PartnerOption[] }>("/platform/partners")).partners);
    } catch {
      router.replace("/platform/login");
    }
  }, [query, router]);

  useEffect(() => {
    platformGet<{ email: string; full_name: string }>("/platform/me").then(setAdmin).catch(() => router.replace("/platform/login"));
  }, [router]);
  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const update = async (company: CompanyRow, patch: Record<string, unknown>) => {
    try {
      await platformCall(() => api.patch(`/platform/companies/${company.id}`, patch));
      toast.success(`${company.name} updated`);
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!admin) return null;
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-sidebar px-6 text-sidebar-foreground">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <span className="font-display font-semibold text-sidebar-foreground">Platform console</span>
        <span className="flex-1" />
        <span className="hidden text-sm text-sidebar-muted sm:inline">{admin.email}</span>
        <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-white/10"
          onClick={async () => { await api.post("/platform/auth/logout"); router.replace("/platform/login"); }}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </header>
      <main className="mx-auto max-w-[1300px] px-4 py-8 sm:px-8">
        <PageHeader title="Platform" description="Tenant lifecycle, plans, partners and the platform brand. Tenant HR data is never accessible from this console." />
        <Tabs tabs={[
          { value: "tenants", label: <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> Tenants</span> },
          { value: "partners", label: <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" /> Partners</span> },
          { value: "brand", label: <span className="flex items-center gap-1.5"><Palette className="h-4 w-4" /> Platform brand</span> },
        ]} value={tab} onValueChange={setTab}>
          <TabPanel value="tenants">
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <StatCard label="Companies" value={rows?.length ?? 0} icon={<Building2 />} />
              <StatCard label="Active subscriptions" value={rows?.filter((r) => r.subscription_status === "active").length ?? 0} tone="success" delay={0.05} />
              <StatCard label="Suspended" value={rows?.filter((r) => r.status !== "active").length ?? 0} tone="danger" delay={0.1} />
            </div>
            <Card>
              <div className="border-b border-border p-4"><SearchInput value={q} onChange={setQ} placeholder="Search companies" className="sm:w-80" /></div>
              <DataTable rows={rows ?? undefined} loading={!rows} rowKey={(r) => r.id}
                columns={[
                  { key: "n", header: "Company", cell: (r) => (
                    <div data-company={r.slug}>
                      <p className="font-medium">{r.name} {r.brand_disabled && <Badge tone="danger">Brand disabled</Badge>}</p>
                      <p className="text-xs text-muted-foreground">{r.slug} · since {fmtDate(r.created_at)}</p>
                      {r.hosts.length > 0 && <p className="text-xs text-muted-foreground">{r.hosts.join(" · ")}</p>}
                    </div>
                  ) },
                  { key: "u", header: "Users", cell: (r) => `${r.active_user_count}/${r.user_count}`, hideOnMobile: true },
                  { key: "e", header: "Employees", cell: (r) => r.employee_count, hideOnMobile: true },
                  { key: "plan", header: "Plan", cell: (r) => (
                    <Select value={r.subscription_plan} onChange={(e) => update(r, { subscription_plan: e.target.value })} className="h-9 w-36" aria-label={`Plan of ${r.name}`}>
                      {["trial", "standard", "professional", "enterprise"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                    </Select>
                  ) },
                  { key: "partner", header: "Partner", hideOnMobile: true, cell: (r) => (
                    <Select value={r.partner_id ?? 0} onChange={(e) => update(r, { partner_id: Number(e.target.value) })} className="h-9 w-40" aria-label={`Partner of ${r.name}`}>
                      <option value={0}>Direct</option>
                      {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  ) },
                  { key: "sub", header: "Subscription", cell: (r) => (
                    <Select value={r.subscription_status} onChange={(e) => update(r, { subscription_status: e.target.value })} className="h-9 w-36" aria-label="Subscription">
                      <option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option>
                    </Select>
                  ) },
                  { key: "s", header: "Workspace", cell: (r) => (
                    <Select value={r.status} onChange={(e) => update(r, { status: e.target.value })} className="h-9 w-32" aria-label="Status">
                      <option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option>
                    </Select>
                  ) },
                  { key: "k", header: "", cell: (r) => (
                    <Button size="sm" variant={r.brand_disabled ? "subtle" : "danger-ghost"} onClick={() => setKill(r)} aria-label={`Brand kill switch for ${r.name}`}>
                      <Ban className="h-4 w-4" /> {r.brand_disabled ? "Restore brand" : "Disable brand"}
                    </Button>
                  ) },
                ]} />
            </Card>
          </TabPanel>
          <TabPanel value="partners"><PartnersPanel onChanged={load} /></TabPanel>
          <TabPanel value="brand"><PlatformBrandPanel /></TabPanel>
        </Tabs>
      </main>
      <KillSwitch company={kill} onClose={() => setKill(null)} onDone={() => { setKill(null); void load(); }} />
    </div>
  );
}

function KillSwitch({ company, onClose, onDone }: { company: CompanyRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(""), [company]);
  if (!company) return null;
  const disabling = !company.brand_disabled;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={disabling ? `Disable ${company.name}'s brand?` : `Restore ${company.name}'s brand?`}
      description={disabling ? "Abuse response: the workspace falls back to the platform brand and its custom domains are disabled. Audited." : "The tenant's published brand is used again. Disabled domains must be re-verified by the tenant."}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={disabling ? "danger" : "primary"} loading={busy} disabled={disabling && reason.trim().length < 3} onClick={async () => {
          setBusy(true);
          try {
            await platformCall(() => api.post(`/platform/companies/${company.id}/brand-kill-switch`, { disabled: disabling, reason: reason || null }));
            toast.success(disabling ? "Brand disabled" : "Brand restored");
            onDone();
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{disabling ? "Disable brand" : "Restore"}</Button></>}>
      {disabling && <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. impersonating a bank" /></Field>}
    </Modal>
  );
}
