"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lock, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { P, PERMISSION_META, SCOPES, SCOPE_LABELS, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Role } from "@/lib/types";

const SHORT: Record<Scope, string> = {
  SELF: "Self",
  DIRECT_REPORTS: "Direct",
  REPORTING_TREE: "Tree",
  DEPARTMENT: "Dept",
  ASSIGNED_GROUP: "Assigned",
  COMPANY: "Company",
};

export default function RolesPage() {
  return (
    <RequireAccess check={(me) => can(me, P.ROLE_READ)}>
      <Roles />
    </RequireAccess>
  );
}

function Roles() {
  const { me } = useCan();
  const confirm = useConfirm();
  const { data: roles, reload } = useApi(() => api.get<Role[]>("/roles"), []);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const selected = roles?.find((r) => r.id === selectedId) ?? roles?.[0];

  useEffect(() => {
    if (selected) {
      setGrants(new Set(selected.grants.map((g) => `${g.permission}|${g.scope}`)));
      setDirty(false);
    }
  }, [selected?.id, selected?.grants.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const modules = useMemo(() => {
    const groups: Record<string, PermissionCode[]> = {};
    (Object.keys(PERMISSION_META) as PermissionCode[]).forEach((code) => {
      (groups[PERMISSION_META[code].module] ||= []).push(code);
    });
    return Object.entries(groups);
  }, []);

  const editable = !!selected?.can_edit && can(me, P.ROLE_UPDATE);
  const toggle = (code: PermissionCode, scope: Scope) => {
    const key = `${code}|${scope}`;
    const next = new Set(grants);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setGrants(next);
    setDirty(true);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/roles/${selected.id}`, {
        grants: [...grants].map((k) => {
          const [permission, scope] = k.split("|");
          return { permission, scope };
        }),
      });
      toast.success("Role saved. Members get the new access on their next request.");
      await reload();
      setDirty(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!(await confirm({ title: `Delete ${selected.name}?`, message: "Roles with members can't be deleted. This can't be undone.", confirmLabel: "Delete role", tone: "danger" }))) return;
    try {
      await api.delete(`/roles/${selected.id}`);
      toast.success("Role deleted");
      setSelectedId(null);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Roles & access"
        description="Roles combine permissions with a data scope. You can only grant permissions you hold yourself."
        actions={can(me, P.ROLE_CREATE) && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New role</Button>}
      />
      {!roles ? <Skeleton className="h-96 rounded-2xl" /> : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            {roles.map((r, i) => (
              <motion.button key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                onClick={async () => { if (!dirty || (await confirm({ title: "Discard unsaved changes?", message: "Your edits to this role haven't been saved.", confirmLabel: "Discard", tone: "danger" }))) setSelectedId(r.id); }}
                className={cn("w-full rounded-2xl border p-4 text-left transition-all",
                  selected?.id === r.id ? "border-primary/40 bg-primary-soft/60 shadow-sm" : "border-border bg-surface hover:border-primary/20")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-semibold">{r.is_protected && <Lock className="h-3.5 w-3.5 text-primary" />}{r.name}</p>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{r.member_count}</span>
                </div>
                {r.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                <div className="mt-2 flex gap-1">
                  {r.is_system_role && <Badge>Default</Badge>}
                  {r.is_full_access && <Badge tone="primary">Full access</Badge>}
                </div>
              </motion.button>
            ))}
          </div>

          {selected && (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-primary" />{selected.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.is_full_access ? "Holds every permission at company scope. This role is protected." :
                      !selected.can_edit ? "Read-only: protected, or a role you hold yourself." : `${grants.size} grants`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {can(me, P.ROLE_DELETE) && !selected.is_protected && selected.member_count === 0 && (
                    <Button variant="danger-ghost" size="sm" onClick={remove}><Trash2 className="h-4 w-4" /> Delete</Button>
                  )}
                  <AnimatePresence>
                    {dirty && (
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <Button size="sm" loading={saving} onClick={save}>Save changes</Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              {selected.is_full_access ? (
                <EmptyState icon={<Lock />} title="Full access" description="Company Administrators can do everything inside this company, including granting this role. Platform operators are separate and never part of a company." />
              ) : (
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-5 py-3 text-left font-medium">Permission</th>
                        {SCOPES.map((s) => <th key={s} className="px-2 py-3 text-center font-medium" title={SCOPE_LABELS[s]}>{SHORT[s]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map(([module, codes]) => (
                        <ModuleRows key={module} module={module} codes={codes} grants={grants} editable={editable} toggle={toggle} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
      <CreateRole open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => { void reload(); setSelectedId(id); }} />
    </div>
  );
}

function ModuleRows({ module, codes, grants, editable, toggle }: {
  module: string; codes: PermissionCode[]; grants: Set<string>; editable: boolean; toggle: (c: PermissionCode, s: Scope) => void;
}) {
  return (
    <>
      <tr className="bg-surface-muted/70"><td colSpan={SCOPES.length + 1} className="px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{module}</td></tr>
      {codes.map((code) => {
        const meta = PERMISSION_META[code];
        return (
          <tr key={code} className="border-b border-border/60 last:border-0">
            <td className="px-5 py-2.5">
              <p className="flex items-center gap-1.5 font-medium">{meta.sensitivity !== "standard" && <Lock className="h-3 w-3 text-warning" />}{meta.label}</p>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </td>
            {SCOPES.map((scope) => {
              const allowed = meta.scopes.includes(scope);
              const on = grants.has(`${code}|${scope}`);
              return (
                <td key={scope} className="px-2 py-2.5 text-center">
                  {allowed ? (
                    <button type="button" disabled={!editable} onClick={() => toggle(code, scope)}
                      aria-pressed={on} aria-label={`${meta.label}: ${SCOPE_LABELS[scope]}`}
                      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-all",
                        on ? "border-primary bg-primary text-primary-foreground shadow-glow" : "border-border bg-surface hover:border-primary/50",
                        !editable && "cursor-default")}>
                      <AnimatePresence>
                        {on && <motion.svg key="tick" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 8.5l3 3 7-7" /></motion.svg>}
                      </AnimatePresence>
                    </button>
                  ) : <span className="text-muted-foreground/30">·</span>}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

function CreateRole({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const role = await api.post<Role>("/roles", { name, description: description || null, grants: [] });
      toast.success("Role created. Choose its permissions next.");
      onOpenChange(false);
      setName("");
      setDescription("");
      onCreated(role.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New role"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={name.length < 2} onClick={submit}>Create role</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team Lead" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
