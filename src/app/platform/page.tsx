"use client";

import { Building2, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, PageHeader, SearchInput, StatCard } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { api, errorMessage, http, toApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

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
}

/** Retry once after refreshing the platform session (separate from company sessions). */
async function platformGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  try {
    return await api.get<T>(url, { params });
  } catch (e) {
    if (toApiError(e).status !== 401) throw e;
    await http.post("/platform/auth/refresh");
    return api.get<T>(url, { params });
  }
}

export default function PlatformConsole() {
  const router = useRouter();
  const [admin, setAdmin] = useState<{ email: string; full_name: string } | null>(null);
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [q, setQ] = useState("");
  const query = useDebounced(q);

  const load = useCallback(async () => {
    try {
      setRows((await platformGet<{ items: CompanyRow[] }>("/platform/companies", { q: query || undefined, limit: 200 })).items);
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

  const update = async (company: CompanyRow, patch: Partial<CompanyRow>) => {
    try {
      await api.patch(`/platform/companies/${company.id}`, patch);
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
        <span className="font-display font-semibold text-white">Platform console</span>
        <span className="flex-1" />
        <span className="hidden text-sm text-sidebar-muted sm:inline">{admin.email}</span>
        <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-white/10"
          onClick={async () => { await api.post("/platform/auth/logout"); router.replace("/platform/login"); }}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </header>
      <main className="mx-auto max-w-[1300px] px-4 py-8 sm:px-8">
        <PageHeader title="Tenants" description="Manage company lifecycle and subscriptions. Tenant HR data is never accessible from this console." />
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Companies" value={rows?.length ?? 0} icon={<Building2 />} />
          <StatCard label="Active subscriptions" value={rows?.filter((r) => r.subscription_status === "active").length ?? 0} tone="success" delay={0.05} />
          <StatCard label="Suspended" value={rows?.filter((r) => r.status !== "active").length ?? 0} tone="danger" delay={0.1} />
        </div>
        <Card>
          <div className="border-b border-border p-4"><SearchInput value={q} onChange={setQ} placeholder="Search companies" className="sm:w-80" /></div>
          <DataTable rows={rows ?? undefined} loading={!rows} rowKey={(r) => r.id}
            columns={[
              { key: "n", header: "Company", cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.slug} · since {fmtDate(r.created_at)}</p></div> },
              { key: "u", header: "Users", cell: (r) => `${r.active_user_count}/${r.user_count}`, hideOnMobile: true },
              { key: "e", header: "Employees", cell: (r) => r.employee_count, hideOnMobile: true },
              { key: "sub", header: "Subscription", cell: (r) => (
                <Select value={r.subscription_status} onChange={(e) => update(r, { subscription_status: e.target.value as CompanyRow["subscription_status"] })} className="h-9 w-36" aria-label="Subscription">
                  <option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option>
                </Select>
              ) },
              { key: "s", header: "Workspace", cell: (r) => (
                <Select value={r.status} onChange={(e) => update(r, { status: e.target.value as CompanyRow["status"] })} className="h-9 w-32" aria-label="Status">
                  <option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option>
                </Select>
              ) },
            ]} />
        </Card>
      </main>
    </div>
  );
}
