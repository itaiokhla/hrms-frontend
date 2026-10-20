"use client";

import { Building2, Briefcase, Lock, LogOut, Palette, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader, StatCard, TabPanel, Tabs } from "@/components/ui/layout";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { platformCall } from "@/lib/platform";

interface Me { email: string; full_name: string; partner: { id: number; name: string } }
interface Client {
  id: number;
  name: string;
  status: string;
  subscription_status: string;
  plan: string;
  created_at: string;
  active_users: number;
  active_employees: number;
}
type Value = string | boolean | number | null | { id: number };
interface Profile { version: number; fields: Record<string, Value>; locked_fields: string[]; row_version: number }
interface BrandResponse { brand: Profile | null; brand_draft: Profile | null }

const TEXT = [
  { key: "product_name", label: "Product name" },
  { key: "tagline", label: "Tagline" },
  { key: "primary_color", label: "Primary colour (#RRGGBB)" },
  { key: "support_url", label: "Support URL" },
];
const LOCKABLE = [
  { key: "product_name", label: "Product name" },
  { key: "show_powered_by", label: "“Powered by” line" },
];

const call = <T,>(fn: () => Promise<T>) => platformCall(fn);

export default function PartnerConsole() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [brand, setBrand] = useState<BrandResponse | null>(null);
  const [tab, setTab] = useState("clients");

  const load = useCallback(async () => {
    try {
      setClients((await call(() => api.get<{ items: Client[] }>("/partner/companies"))).items);
      setBrand(await call(() => api.get<BrandResponse>("/partner/brand")));
    } catch {
      router.replace("/partner/login");
    }
  }, [router]);

  useEffect(() => {
    call(() => api.get<Me>("/partner/me")).then(setMe).catch(() => router.replace("/partner/login"));
  }, [router]);
  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return null;
  const employees = (clients ?? []).reduce((sum, c) => sum + c.active_employees, 0);
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-sidebar px-6 text-sidebar-foreground">
        <Briefcase className="h-5 w-5 text-accent" />
        <span className="font-display font-semibold text-sidebar-foreground" data-testid="partner-name">{me.partner.name}</span>
        <span className="hidden text-sm text-sidebar-muted sm:inline">Partner console</span>
        <span className="flex-1" />
        <span className="hidden text-sm text-sidebar-muted sm:inline">{me.email}</span>
        <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-white/10"
          onClick={async () => { await api.post("/partner/auth/logout"); router.replace("/partner/login"); }}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
        <PageHeader title="Your clients" description="Companies you resell, with aggregate counts only. Employee, payroll and attendance records stay with each company." />
        <Tabs tabs={[
          { value: "clients", label: <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> Clients</span> },
          { value: "brand", label: <span className="flex items-center gap-1.5"><Palette className="h-4 w-4" /> Partner brand</span> },
        ]} value={tab} onValueChange={setTab}>
          <TabPanel value="clients">
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <StatCard label="Client companies" value={clients?.length ?? 0} icon={<Building2 />} />
              <StatCard label="Active employees across clients" value={employees} delay={0.05} />
            </div>
            <Card className="overflow-hidden">
              {clients && clients.length === 0 ? (
                <EmptyState title="No client companies yet" description="The platform operator assigns companies to your partnership." />
              ) : (
                <DataTable rows={clients ?? undefined} loading={!clients} rowKey={(c) => c.id} columns={[
                  { key: "n", header: "Company", cell: (c) => <span className="font-medium">{c.name}</span> },
                  { key: "p", header: "Plan", cell: (c) => <span className="capitalize">{c.plan}</span> },
                  { key: "s", header: "Subscription", cell: (c) => <Badge tone={c.subscription_status === "active" ? "success" : "neutral"}>{c.subscription_status}</Badge> },
                  { key: "w", header: "Workspace", cell: (c) => c.status },
                  { key: "u", header: "Active users", cell: (c) => c.active_users, hideOnMobile: true },
                  { key: "e", header: "Active employees", cell: (c) => c.active_employees, hideOnMobile: true },
                  { key: "d", header: "Since", cell: (c) => fmtDate(c.created_at), hideOnMobile: true },
                ]} />
              )}
            </Card>
          </TabPanel>
          <TabPanel value="brand">
            {brand && <BrandEditor key={`${brand.brand?.version ?? 0}-${brand.brand_draft?.row_version ?? 0}`} data={brand} onSaved={load} />}
          </TabPanel>
        </Tabs>
      </main>
    </div>
  );
}

function BrandEditor({ data, onSaved }: { data: BrandResponse; onSaved: () => void }) {
  const base = data.brand_draft ?? data.brand;
  const [fields, setFields] = useState<Record<string, Value>>(base?.fields ?? {});
  const [locks, setLocks] = useState<string[]>(base?.locked_fields ?? []);
  const [busy, setBusy] = useState(false);
  const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");

  const save = async (publish: boolean) => {
    setBusy(true);
    try {
      const changes: Record<string, Value> = {};
      TEXT.forEach(({ key }) => { changes[key] = text(key) || null; });
      changes.show_powered_by = fields.show_powered_by !== false;
      await platformCall(() => api.put("/partner/brand/draft", { changes, locked_fields: locks, row_version: data.brand_draft?.row_version }));
      if (publish) {
        await platformCall(() => api.post("/partner/brand/publish"));
        toast.success("Partner brand published");
      } else {
        toast.success("Draft saved");
      }
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Partner brand" description={data.brand ? `Published version ${data.brand.version}. Your client companies inherit these values; locked fields cannot be changed by them.` : "Not published yet: your clients use the platform brand."} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {TEXT.map(({ key, label }) => (
          <Field key={key} label={label}>
            <Input value={text(key)} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} data-testid={`partner-brand-${key}`} />
          </Field>
        ))}
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
          Show “Powered by” line
          <Switch checked={fields.show_powered_by !== false} onChange={(v) => setFields({ ...fields, show_powered_by: v })} label="Show Powered by line" />
        </div>
      </div>
      <div className="border-t border-border p-5">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Lock className="h-4 w-4" /> Locked for client companies</p>
        <div className="flex flex-wrap gap-3">
          {LOCKABLE.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              <Switch checked={locks.includes(key)} onChange={(v) => setLocks(v ? [...locks, key] : locks.filter((k) => k !== key))} label={`Lock ${label}`} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-5">
        <Button variant="secondary" loading={busy} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} onClick={() => save(true)}><Rocket className="h-4 w-4" /> Publish</Button>
      </div>
    </Card>
  );
}
