"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Building, ChevronRight, MapPin, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canAny } from "@/lib/access";
import { cn } from "@/lib/cn";
import { P } from "@/lib/permissions.generated";

interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  subdivision_code?: string;
  postal_code?: string;
  country_code?: string;
}
interface BranchRow {
  id: number;
  legal_entity_id: number;
  code: string;
  name: string;
  address: Address;
  country_code: string;
  subdivision_code: string | null;
  timezone: string;
  status: "ACTIVE" | "INACTIVE";
  employee_count: number;
}
interface EntityRow {
  id: number;
  code: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  country_name: string;
  country_confirmed: boolean;
  registered_address: Address;
  registration_lines: { label: string; value: string }[];
  base_currency: string;
  fiscal_year_start: string;
  timezone: string;
  is_default: boolean;
  status: "ACTIVE" | "INACTIVE";
  employee_count: number;
  capability: string;
  branches: BranchRow[];
}
interface Tree {
  company: { name: string; currency: string };
  legal_entities: EntityRow[];
  departments: { id: number; name: string; parent_department_id: number | null; is_active: boolean }[];
  unconfirmed_entities: string[];
}
interface Catalog {
  countries: { code: string; name: string }[];
  currencies: { code: string; name: string }[];
}

function flag(code: string) {
  return code.length === 2 ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
}

export default function OrganizationStructurePage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ORG_READ, P.ORG_MANAGE_ENTITIES, P.ORG_MANAGE_BRANCHES])}>
      <Structure />
    </RequireAccess>
  );
}

function Structure() {
  const { me } = useCan();
  const [tree, setTree] = useState<Tree | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [entityForm, setEntityForm] = useState<Partial<EntityRow> | null>(null);
  const [branchForm, setBranchForm] = useState<Partial<BranchRow> | null>(null);
  const canEntities = can(me, P.ORG_MANAGE_ENTITIES);
  const canBranches = can(me, P.ORG_MANAGE_BRANCHES);

  const load = useCallback(async () => {
    try {
      if (can(me, P.ORG_READ)) {
        setTree(await api.get<Tree>("/org/tree"));
      } else {
        const [entities, branches] = await Promise.all([
          api.get<EntityRow[]>("/legal-entities"),
          api.get<BranchRow[]>("/branches"),
        ]);
        setTree({
          company: { name: me?.company.name ?? "", currency: me?.company.currency ?? "" },
          legal_entities: entities.map((e) => ({ ...e, branches: branches.filter((b) => b.legal_entity_id === e.id) })),
          departments: [],
          unconfirmed_entities: entities.filter((e) => !e.country_confirmed).map((e) => e.code),
        });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [me]);
  useEffect(() => {
    void load();
    api.get<Catalog>("/org/catalog").then(setCatalog).catch(() => undefined);
  }, [load]);

  const entity = useMemo(
    () => tree?.legal_entities.find((e) => e.id === selected) ?? tree?.legal_entities[0] ?? null,
    [tree, selected],
  );

  if (!tree) return <Skeleton className="h-96 rounded-3xl" />;
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Legal entities & branches"
        description="Who employs your people (legal entities: country, currency, employer details on payslips) and where they work (branches)."
        actions={
          <>
            {canEntities && (
              <Button size="sm" onClick={() => setEntityForm({ country_code: "", base_currency: tree.company.currency, timezone: "UTC", fiscal_year_start: "01-01" })} data-testid="add-entity">
                <Plus className="h-4 w-4" /> Legal entity
              </Button>
            )}
            {canBranches && (
              <Button size="sm" variant="secondary" onClick={() => setBranchForm({ legal_entity_id: entity?.id })} data-testid="add-branch">
                <Plus className="h-4 w-4" /> Branch
              </Button>
            )}
          </>
        }
      />
      {tree.unconfirmed_entities.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Confirm your legal entity</p>
            <p>The country of {tree.unconfirmed_entities.join(", ")} was guessed from your currency and timezone. Open it, check the country and save.</p>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-3">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tree.company.name}</p>
          <ul className="space-y-1">
            {tree.legal_entities.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelected(e.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    entity?.id === e.id ? "bg-primary-soft text-primary" : "hover:bg-surface-muted",
                  )}
                  data-entity={e.code}
                >
                  <ChevronRight className={cn("h-4 w-4 transition-transform", entity?.id === e.id && "rotate-90")} />
                  <span className="text-base" aria-hidden>{flag(e.country_code)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.legal_name}</span>
                  <Badge>{e.base_currency}</Badge>
                  <span className="text-xs text-muted-foreground">{e.employee_count}</span>
                </button>
                <AnimatePresence initial={false}>
                  {entity?.id === e.id && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="ml-8 overflow-hidden border-l border-border pl-3"
                    >
                      {e.branches.map((b) => (
                        <li key={b.id} className="flex items-center gap-2 py-1.5 text-sm" data-branch={b.code}>
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate">{b.name}</span>
                          {b.subdivision_code && <span className="text-xs text-muted-foreground">{b.subdivision_code}</span>}
                          <span className="text-xs text-muted-foreground">{b.employee_count}</span>
                        </li>
                      ))}
                      {e.branches.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">No branches yet</li>}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
          {tree.departments.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Departments (company-wide)</p>
              <p className="px-2 text-sm text-muted-foreground">{tree.departments.filter((d) => !d.parent_department_id).map((d) => d.name).join(" · ")}</p>
            </div>
          )}
        </Card>

        {entity ? (
          <Card>
            <CardHeader
              title={<span className="flex flex-wrap items-center gap-2">{flag(entity.country_code)} {entity.legal_name} <StatusBadge status={entity.status === "ACTIVE" ? "active" : "deactivated"} label={entity.status === "ACTIVE" ? "Active" : "Inactive"} /></span>}
              description={`${entity.code} · ${entity.country_name} · ${entity.base_currency} · fiscal year starts ${entity.fiscal_year_start}`}
              action={canEntities && <Button size="sm" variant="secondary" onClick={() => setEntityForm(entity)} data-testid="edit-entity">Edit</Button>}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registered address</p>
                <p className="mt-1 text-sm">
                  {[entity.registered_address.line1, entity.registered_address.line2, entity.registered_address.city,
                    entity.registered_address.subdivision_code, entity.registered_address.postal_code].filter(Boolean).join(", ") || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registrations (printed on payslips)</p>
                <ul className="mt-1 text-sm">
                  {entity.registration_lines.length ? entity.registration_lines.map((r) => <li key={r.label}>{r.label}: {r.value}</li>) : <li>—</li>}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payroll capability</p>
                <p className="mt-1 text-sm">
                  Configuration only. Statutory calculations for {entity.country_name} are not verified; payroll runs use your
                  own salary structures.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timezone</p>
                <p className="mt-1 text-sm">{entity.timezone}</p>
              </div>
            </div>
            <div className="border-t border-border/70">
              <CardHeader title="Branches" description="Work locations of this legal entity." className="border-0" />
              {entity.branches.length === 0 ? (
                <EmptyState title="No branches" icon={<Building />} />
              ) : (
                <ul className="divide-y divide-border/70">
                  {entity.branches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <span>
                        <span className="font-medium">{b.name}</span> <Badge>{b.code}</Badge>{" "}
                        {b.subdivision_code && <Badge tone="info">{b.subdivision_code}</Badge>}
                        <span className="block text-xs text-muted-foreground">{b.timezone} · {b.employee_count} people</span>
                      </span>
                      {canBranches && <Button size="sm" variant="ghost" onClick={() => setBranchForm(b)}>Edit</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : (
          <EmptyState title="No legal entities" />
        )}
      </div>

      <EntityModal form={entityForm} catalog={catalog} onClose={() => setEntityForm(null)} onSaved={() => { setEntityForm(null); void load(); }} />
      <BranchModal form={branchForm} entities={tree.legal_entities} onClose={() => setBranchForm(null)} onSaved={() => { setBranchForm(null); void load(); }} />
    </div>
  );
}

function EntityModal({ form, catalog, onClose, onSaved }: {
  form: Partial<EntityRow> | null; catalog: Catalog | null; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState<Partial<EntityRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(form ?? {});
    setError(null);
  }, [form]);
  const address = value.registered_address ?? {};
  const lines = value.registration_lines ?? [];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: value.code, legal_name: value.legal_name, trade_name: value.trade_name ?? null, country_code: value.country_code,
        base_currency: value.base_currency, timezone: value.timezone, fiscal_year_start: value.fiscal_year_start,
        registered_address: address, registration_lines: lines.filter((l) => l.label && l.value),
      };
      if (value.id) await api.patch(`/legal-entities/${value.id}`, body);
      else await api.post("/legal-entities", body);
      toast.success("Legal entity saved");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!form} onOpenChange={(o) => !o && onClose()} size="lg" title={value.id ? `Edit ${value.legal_name}` : "Add legal entity"}
      description="The country decides which payroll rules could apply. It cannot change after payroll is approved."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} data-testid="save-entity">Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required><Input value={value.code ?? ""} maxLength={20} onChange={(e) => setValue({ ...value, code: e.target.value })} placeholder="IN01" /></Field>
        <Field label="Legal name" required><Input value={value.legal_name ?? ""} onChange={(e) => setValue({ ...value, legal_name: e.target.value })} /></Field>
        <Field label="Trade name"><Input value={value.trade_name ?? ""} onChange={(e) => setValue({ ...value, trade_name: e.target.value })} /></Field>
        <Field label="Country" required>
          <Select value={value.country_code ?? ""} onChange={(e) => setValue({ ...value, country_code: e.target.value })} data-testid="entity-country">
            <option value="">Choose…</option>
            {catalog?.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Base currency" required>
          <Select value={value.base_currency ?? ""} onChange={(e) => setValue({ ...value, base_currency: e.target.value })} data-testid="entity-currency">
            {catalog?.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </Select>
        </Field>
        <Field label="Timezone" required hint="IANA name, e.g. Asia/Kolkata"><Input value={value.timezone ?? ""} onChange={(e) => setValue({ ...value, timezone: e.target.value })} /></Field>
        <Field label="Fiscal year starts" hint="MM-DD, e.g. 04-01"><Input value={value.fiscal_year_start ?? ""} maxLength={5} onChange={(e) => setValue({ ...value, fiscal_year_start: e.target.value })} /></Field>
        <Field label="Address line 1"><Input value={address.line1 ?? ""} onChange={(e) => setValue({ ...value, registered_address: { ...address, line1: e.target.value } })} /></Field>
        <Field label="City"><Input value={address.city ?? ""} onChange={(e) => setValue({ ...value, registered_address: { ...address, city: e.target.value } })} /></Field>
        <Field label="State / region code" hint="ISO 3166-2, e.g. IN-KA"><Input value={address.subdivision_code ?? ""} onChange={(e) => setValue({ ...value, registered_address: { ...address, subdivision_code: e.target.value } })} /></Field>
        <Field label="Postal code"><Input value={address.postal_code ?? ""} onChange={(e) => setValue({ ...value, registered_address: { ...address, postal_code: e.target.value } })} /></Field>
      </div>
      <div className="mt-5">
        <p className="mb-2 text-[13px] font-medium">Registration lines printed on payslips</p>
        {[...lines, { label: "", value: "" }].slice(0, 6).map((line, index) => (
          <div key={index} className="mb-2 grid grid-cols-[140px_1fr] gap-2">
            <Input placeholder="Label (e.g. CIN)" value={line.label} onChange={(e) => {
              const next = [...lines];
              next[index] = { ...line, label: e.target.value };
              setValue({ ...value, registration_lines: next });
            }} />
            <Input placeholder="Value" value={line.value} onChange={(e) => {
              const next = [...lines];
              next[index] = { ...line, value: e.target.value };
              setValue({ ...value, registration_lines: next });
            }} />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}

function BranchModal({ form, entities, onClose, onSaved }: {
  form: Partial<BranchRow> | null; entities: EntityRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState<Partial<BranchRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subdivisions, setSubdivisions] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    setValue(form ?? {});
    setError(null);
  }, [form]);
  const entity = entities.find((e) => e.id === value.legal_entity_id);
  useEffect(() => {
    if (!entity) return;
    api.get<{ code: string; name: string }[]>("/org/subdivisions", { params: { country: entity.country_code } })
      .then(setSubdivisions).catch(() => setSubdivisions([]));
  }, [entity]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { legal_entity_id: value.legal_entity_id, code: value.code, name: value.name,
        subdivision_code: value.subdivision_code || null, timezone: value.timezone || entity?.timezone };
      if (value.id) await api.patch(`/branches/${value.id}`, body);
      else await api.post("/branches", body);
      toast.success("Branch saved");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!form} onOpenChange={(o) => !o && onClose()} title={value.id ? `Edit ${value.name}` : "Add branch"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} data-testid="save-branch">Save</Button></>}>
      <div className="space-y-4">
        <Field label="Legal entity" required>
          <Select value={value.legal_entity_id ?? ""} onChange={(e) => setValue({ ...value, legal_entity_id: Number(e.target.value) || undefined })}>
            <option value="">Choose…</option>
            {entities.filter((e) => e.status === "ACTIVE").map((e) => <option key={e.id} value={e.id}>{e.legal_name} ({e.code})</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input value={value.name ?? ""} onChange={(e) => setValue({ ...value, name: e.target.value })} data-testid="branch-name" /></Field>
          <Field label="Code" required><Input value={value.code ?? ""} maxLength={20} onChange={(e) => setValue({ ...value, code: e.target.value })} data-testid="branch-code" /></Field>
        </div>
        <Field label="State / region" hint="Drives location-specific rules such as holidays.">
          <Select value={value.subdivision_code ?? ""} onChange={(e) => setValue({ ...value, subdivision_code: e.target.value || null })}>
            <option value="">Not set</option>
            {subdivisions.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
          </Select>
        </Field>
        <Field label="Timezone" hint={entity ? `Defaults to ${entity.timezone}` : undefined}>
          <Input value={value.timezone ?? ""} placeholder={entity?.timezone} onChange={(e) => setValue({ ...value, timezone: e.target.value })} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
