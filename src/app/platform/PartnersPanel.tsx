"use client";

import { Lock, Plus, Rocket, Unlock, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { platformCall } from "@/lib/platform";

type Value = string | boolean | number | null | { id: number; url?: string };
interface Profile {
  id: number;
  version: number;
  status: string;
  fields: Record<string, Value>;
  locked_fields: string[];
  row_version: number;
  powered_by_label: string | null;
}
interface Partner {
  id: number;
  name: string;
  slug: string;
  status: string;
  billing_mode: string;
  tenant_entitlements: Record<string, boolean>;
  tenants: { id: number; name: string; status: string; plan: string; active_employees: number }[];
  brand: Profile | null;
  brand_draft: Profile | null;
}
interface PartnersResponse {
  partners: Partner[];
  entitlements: Record<string, string>;
  plans: string[];
  brand_fields: Record<string, string>;
}

const TEXT_FIELDS = ["product_name", "short_name", "tagline", "legal_footer", "support_email", "support_url", "email_sender_name"];
const LOCKABLE = ["product_name", "short_name", "show_powered_by", "primary_color", "accent_color", "font", "sidebar_style", "mark", "logo_light"];

export function PartnersPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<PartnersResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await platformCall(() => api.get<PartnersResponse>("/platform/partners")));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)} data-testid="create-partner"><Plus className="h-4 w-4" /> Partner</Button>
      </div>
      {data.partners.length === 0 && <EmptyState title="No partners yet" description="Partners resell the product under their own brand. They never see tenant HR data." />}
      {data.partners.map((p) => (
        <PartnerCard key={p.id} partner={p} meta={data} onChanged={async () => { await load(); onChanged(); }} />
      ))}
      <Modal open={creating} onOpenChange={setCreating} title="New partner" footer={<>
        <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
        <Button onClick={async () => {
          try {
            await platformCall(() => api.post("/platform/partners", { name }));
            toast.success("Partner created");
            setCreating(false);
            setName("");
            await load();
            onChanged();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} disabled={name.trim().length < 2}>Create</Button></>}>
        <Field label="Partner name" required><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="partner-name" /></Field>
      </Modal>
    </div>
  );
}

function PartnerCard({ partner, meta, onChanged }: { partner: Partner; meta: PartnersResponse; onChanged: () => Promise<void> }) {
  const base = partner.brand_draft ?? partner.brand;
  const [fields, setFields] = useState<Record<string, Value>>(base?.fields ?? {});
  const [locks, setLocks] = useState<string[]>(base?.locked_fields ?? []);
  const [label, setLabel] = useState(base?.powered_by_label ?? "");
  const [ents, setEnts] = useState<Record<string, boolean>>(partner.tenant_entitlements);
  const [busy, setBusy] = useState(false);
  const markInput = useRef<HTMLInputElement>(null);

  const saveDraft = async (extra: Record<string, Value> = {}) => {
    const changes: Record<string, Value> = {};
    TEXT_FIELDS.concat(["primary_color", "show_powered_by"]).forEach((f) => {
      if (f in fields) changes[f] = fields[f] === "" ? null : fields[f];
    });
    Object.assign(changes, extra);
    await platformCall(() => api.put(`/platform/brands/partners/${partner.id}`, {
      changes, locked_fields: locks, powered_by_label: label || null,
    }));
  };

  return (
    <Card data-partner={partner.slug}>
      <CardHeader
        title={<span className="flex items-center gap-2">{partner.name} <Badge>{partner.status}</Badge>
          {partner.brand && <Badge tone="success">Brand v{partner.brand.version} live</Badge>}
          {partner.brand_draft && <Badge tone="warning">Draft</Badge>}</span>}
        description={`${partner.tenants.length} tenant(s) · ${partner.billing_mode.replace(/_/g, " ").toLowerCase()} · aggregate counts only, no HR data`}
      />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Brand for all its tenants</p>
          {TEXT_FIELDS.map((f) => (
            <div key={f} className="flex items-end gap-2">
              <Field label={meta.brand_fields[f] ?? f} className="flex-1">
                <Input value={(fields[f] as string) ?? ""} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} data-partner-field={f} />
              </Field>
              {LOCKABLE.includes(f) && <LockToggle field={f} locks={locks} setLocks={setLocks} />}
            </div>
          ))}
          <div className="flex items-end gap-2">
            <Field label="Primary colour" className="flex-1">
              <Input value={(fields.primary_color as string) ?? ""} placeholder="#0F766E" maxLength={7}
                onChange={(e) => setFields({ ...fields, primary_color: e.target.value })} className="font-mono uppercase" data-partner-field="primary_color" />
            </Field>
            <LockToggle field="primary_color" locks={locks} setLocks={setLocks} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <span className="text-sm font-medium">Show “Powered by”</span>
            <span className="flex items-center gap-2">
              <Switch checked={fields.show_powered_by !== false} onChange={(v) => setFields({ ...fields, show_powered_by: v })} label="Show powered by" />
              <LockToggle field="show_powered_by" locks={locks} setLocks={setLocks} />
            </span>
          </div>
          <Field label="Powered-by label (partner credit)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Powered by …" /></Field>
          <input ref={markInput} type="file" accept="image/png,image/webp" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const form = new FormData();
            form.append("kind", "mark");
            form.append("file", file);
            try {
              const asset = await platformCall(() => api.post<{ id: number }>(`/platform/brands/partners/${partner.id}/assets`, form));
              await saveDraft({ mark: asset.id });
              toast.success("Partner mark added to the draft");
              await onChanged();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => markInput.current?.click()}><Upload className="h-4 w-4" /> Square mark</Button>
            <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
              setBusy(true);
              try {
                await saveDraft();
                toast.success("Partner brand draft saved");
                await onChanged();
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }} data-testid={`save-partner-${partner.slug}`}>Save draft</Button>
            <Button size="sm" loading={busy} onClick={async () => {
              setBusy(true);
              try {
                await saveDraft();
                await platformCall(() => api.post(`/platform/brands/partners/${partner.id}/publish`));
                toast.success("Partner brand published to all its tenants");
                await onChanged();
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }} data-testid={`publish-partner-${partner.slug}`}><Rocket className="h-4 w-4" /> Publish</Button>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold">What its tenants may use</p>
            <div className="space-y-2">
              {Object.entries(meta.entitlements).map(([key, text]) => (
                <label key={key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                  {text}
                  <Switch checked={!!ents[key]} onChange={(v) => setEnts({ ...ents, [key]: v })} label={text} />
                </label>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2" onClick={async () => {
              try {
                await platformCall(() => api.patch(`/platform/partners/${partner.id}`, { tenant_entitlements: ents }));
                toast.success("Entitlements saved");
                await onChanged();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}>Save entitlements</Button>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Tenants</p>
            <ul className="space-y-1 text-sm">
              {partner.tenants.map((t) => (
                <li key={t.id} className="flex justify-between rounded-lg bg-surface-muted px-3 py-1.5">
                  <span>{t.name}</span><span className="text-muted-foreground">{t.active_employees} active · {t.plan}</span>
                </li>
              ))}
              {partner.tenants.length === 0 && <li className="text-muted-foreground">Assign tenants from the Tenants tab.</li>}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

function LockToggle({ field, locks, setLocks }: { field: string; locks: string[]; setLocks: (v: string[]) => void }) {
  const on = locks.includes(field);
  return (
    <button type="button" aria-pressed={on} aria-label={`${on ? "Unlock" : "Lock"} ${field}`} data-lock={field}
      onClick={() => setLocks(on ? locks.filter((f) => f !== field) : [...locks, field])}
      className={`mb-1 flex h-9 w-9 items-center justify-center rounded-xl border ${on ? "border-warning bg-warning-soft text-warning" : "border-border text-muted-foreground"}`}>
      {on ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
    </button>
  );
}

export function PlatformBrandPanel() {
  const [fields, setFields] = useState<Record<string, string>>({ product_name: "", tagline: "", powered_by_label: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Platform brand" description="The default for every tenant without its own brand, and the brand of unknown or platform addresses. The console itself is never white-labelled." />
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Product name"><Input value={fields.product_name} placeholder="Intertech HRMS" onChange={(e) => setFields({ ...fields, product_name: e.target.value })} /></Field>
        <Field label="Tagline"><Input value={fields.tagline} onChange={(e) => setFields({ ...fields, tagline: e.target.value })} /></Field>
        <Field label="Powered-by label"><Input value={fields.powered_by_label} placeholder="Powered by Intertech HRMS" onChange={(e) => setFields({ ...fields, powered_by_label: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2 border-t border-border px-5 py-4">
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const changes: Record<string, string | null> = {};
            if (fields.product_name) changes.product_name = fields.product_name;
            if (fields.tagline) changes.tagline = fields.tagline;
            await platformCall(() => api.put("/platform/brands/platform/0", { changes, powered_by_label: fields.powered_by_label || null }));
            await platformCall(() => api.post("/platform/brands/platform/0/publish"));
            toast.success("Platform brand published");
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}><Rocket className="h-4 w-4" /> Save and publish</Button>
      </div>
    </Card>
  );
}
