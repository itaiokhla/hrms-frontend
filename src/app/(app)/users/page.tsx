"use client";

import { motion } from "framer-motion";
import { Check, Copy, Lock, LogOut, Mail, ShieldCheck, ShieldOff, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { ScopeTargets } from "@/components/shared/ScopeTargets";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, Pagination, PageHeader, SearchInput } from "@/components/ui/layout";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fromNow } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P, SCOPE_LABELS, type Scope } from "@/lib/permissions.generated";
import type { Page, Role, UserDetail, UserRow } from "@/lib/types";

export default function UsersPage() {
  return (
    <RequireAccess check={(me) => can(me, P.USER_READ)}>
      <Users_ />
    </RequireAccess>
  );
}

function Users_() {
  const { me } = useCan();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const query = useDebounced(q);
  const { data, loading, reload } = useApi(
    () => api.get<Page<UserRow>>("/users", { params: { q: query || undefined, status: status || undefined, skip, limit: 25 } }),
    [query, status, skip],
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Login accounts for your company. People are invited by link; administrators never set or see passwords."
        actions={can(me, P.USER_INVITE) && <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite user</Button>}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setSkip(0); }} placeholder="Search name or email" className="flex-1" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} className="sm:w-44" aria-label="Status">
            <option value="">All statuses</option><option value="active">Active</option><option value="invited">Invited</option>
            <option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
          </Select>
        </div>
        <DataTable rows={data?.items} loading={loading} rowKey={(u) => u.id} onRowClick={(u) => setSelected(u.id)}
          empty={<EmptyState icon={<Users />} title="No users found" />}
          columns={[
            { key: "u", header: "User", cell: (u) => (
              <div className="flex items-center gap-3">
                <Avatar name={u.full_name} size={34} />
                <div className="min-w-0"><p className="truncate font-medium">{u.full_name}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div>
              </div>
            ) },
            { key: "r", header: "Roles", cell: (u) => (
              <div className="flex flex-wrap gap-1">
                {u.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
                {u.roles.map((r) => <Badge key={r.id} tone={r.is_protected ? "primary" : "neutral"}>{r.is_protected && <Lock className="h-3 w-3" />}{r.name}</Badge>)}
              </div>
            ) },
            { key: "e", header: "Employee", hideOnMobile: true, cell: (u) => u.employee ? u.employee.full_name : <span className="text-muted-foreground">Not linked</span> },
            { key: "l", header: "Last sign-in", hideOnMobile: true, cell: (u) => (u.last_login_at ? fromNow(u.last_login_at) : "Never") },
            { key: "s", header: "Status", cell: (u) => <StatusBadge status={u.status} /> },
          ]} />
        {data && <Pagination total={data.total} skip={skip} limit={25} onChange={setSkip} />}
      </Card>
      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} onDone={() => void reload()} />
      <UserDrawer userId={selected} onClose={() => setSelected(null)} onChanged={() => void reload()} />
    </div>
  );
}

function RolePicker({ roles, selected, onChange, disabledIds = [] }: { roles: Role[]; selected: number[]; onChange: (ids: number[]) => void; disabledIds?: number[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => {
        const checked = selected.includes(r.id);
        const disabled = !r.can_assign || disabledIds.includes(r.id);
        return (
          <label key={r.id} className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
            checked ? "border-primary/40 bg-primary-soft/50" : "border-border hover:bg-surface-muted",
            disabled && "cursor-not-allowed opacity-50",
          )} title={disabled ? "You can't grant this role" : undefined}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled}
              onChange={() => onChange(checked ? selected.filter((id) => id !== r.id) : [...selected, r.id])} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">{r.is_protected && <Lock className="h-3 w-3 text-primary" />}{r.name}</span>
              {r.description && <span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function InviteModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { data: roles } = useApi(() => api.get<Role[]>("/roles"), [], { enabled: open });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ invite_url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => { setEmail(""); setName(""); setEmployee(null); setRoleIds([]); setResult(null); setCopied(false); };

  const submit = async () => {
    setSaving(true);
    try {
      const r = await api.post<{ invite_url: string; emailed: boolean }>("/users/invite", { email, full_name: name, employee_id: employee?.id ?? null, role_ids: roleIds });
      setResult(r);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }} size="lg"
      title={result ? "Invitation ready" : "Invite user"}
      description={result ? undefined : "They'll join your company automatically — no company selection needed."}
      footer={result ? <Button onClick={() => { onOpenChange(false); reset(); }}>Done</Button> : (
        <><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={saving} disabled={!email || name.length < 2} onClick={submit}><Mail className="h-4 w-4" /> Send invitation</Button></>
      )}>
      {result ? (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-success-soft p-4 text-sm text-success">
            <Check className="h-5 w-5" />
            {result.emailed ? `We emailed an invitation to ${email}.` : "Email isn't configured, so share this link with the person securely."}
          </div>
          <Field label="Invitation link" htmlFor="invite-link" hint="Single use. Expires in 72 hours.">
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={result.invite_url} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" aria-label={copied ? "Link copied" : "Copy invitation link"}
                onClick={async () => { await navigator.clipboard.writeText(result.invite_url); setCopied(true); }}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </Field>
        </motion.div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Full name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          <Field label="Employee record" hint="Link the login to an existing employee so self-service and reporting lines work.">
            <EmployeePicker value={employee} onChange={(e) => { setEmployee(e); if (e && !name) setName(e.full_name); }} />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium">Roles</p>
            {roles ? <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} /> : <Skeleton className="h-24" />}
          </div>
        </div>
      )}
    </Modal>
  );
}

function UserDrawer({ userId, onClose, onChanged }: { userId: number | null; onClose: () => void; onChanged: () => void }) {
  const { me } = useCan();
  const confirm = useConfirm();
  const open = userId !== null;
  const { data: user, reload } = useApi(() => api.get<UserDetail>(`/users/${userId}`), [userId], { enabled: open });
  const { data: roles } = useApi(() => api.get<Role[]>("/roles"), [], { enabled: open });
  const [roleIds, setRoleIds] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const isSelf = me?.user.id === userId;
  const currentRoles = roleIds ?? user?.roles.map((r) => r.id) ?? [];

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setRoleIds(null);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: "active" | "suspended" | "deactivated") => {
    const ok = await confirm({
      title: status === "active" ? "Reactivate account?" : status === "suspended" ? "Suspend account?" : "Deactivate account?",
      message: status === "active" ? "They'll be able to sign in again." : "They're signed out everywhere immediately. Their HR records are not affected.",
      confirmLabel: status === "active" ? "Reactivate" : status === "suspended" ? "Suspend" : "Deactivate",
      tone: status === "active" ? "primary" : "danger",
    });
    if (ok) void act(() => api.put(`/users/${userId}/status`, { status }), "Account updated");
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { onClose(); setRoleIds(null); } }} title={user?.full_name ?? "User"} description={user?.email} width="max-w-2xl">
      {!user ? <Skeleton className="h-48" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user.status} />
            {user.mfa_enabled ? <Badge tone="success"><ShieldCheck className="h-3 w-3" /> 2FA on</Badge> : <Badge><ShieldOff className="h-3 w-3" /> 2FA off</Badge>}
            <Badge>{user.active_sessions} active session{user.active_sessions === 1 ? "" : "s"}</Badge>
            {user.employee && <Badge tone="primary">{user.employee.full_name} · {user.employee.employee_code}</Badge>}
          </div>

          {!isSelf && (
            <div className="flex flex-wrap gap-2">
              {user.status === "invited" && can(me, P.USER_INVITE) && (
                <Button size="sm" variant="secondary" loading={busy} onClick={() => act(async () => {
                  const r = await api.post<{ invite_url: string; emailed: boolean }>(`/users/${userId}/resend-invite`);
                  if (!r.emailed) await navigator.clipboard.writeText(r.invite_url).catch(() => undefined);
                }, "New invitation created (link copied if email is off)")}>
                  <Mail className="h-4 w-4" /> Resend invite
                </Button>
              )}
              {can(me, P.USER_DEACTIVATE) && (
                <>
                  {user.status === "active" && <Button size="sm" variant="secondary" onClick={() => setStatus("suspended")}><UserX className="h-4 w-4" /> Suspend</Button>}
                  {(user.status === "suspended" || user.status === "deactivated") && <Button size="sm" variant="subtle" onClick={() => setStatus("active")}><UserCheck className="h-4 w-4" /> Reactivate</Button>}
                  {user.status !== "deactivated" && <Button size="sm" variant="danger-ghost" onClick={() => setStatus("deactivated")}>Deactivate</Button>}
                  {user.active_sessions > 0 && (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => act(() => api.post(`/users/${userId}/revoke-sessions`), "Signed out everywhere")}>
                      <LogOut className="h-4 w-4" /> Sign out everywhere
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {can(me, P.USER_ASSIGN_ROLE) && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Roles</p>
                {roleIds && !isSelf && (
                  <Button size="sm" loading={busy} onClick={() => act(() => api.put(`/users/${userId}/roles`, { role_ids: roleIds }), "Roles updated — effective on their next request")}>Save roles</Button>
                )}
              </div>
              {isSelf ? <p className="text-sm text-muted-foreground">You can't change your own roles.</p> :
                roles ? <RolePicker roles={roles} selected={currentRoles} onChange={setRoleIds} /> : <Skeleton className="h-24" />}
            </section>
          )}

          <ScopeTargets key={`${userId}-${user.roles.map((r) => r.id).join(",")}`} userId={user.id}
            editable={can(me, P.USER_ASSIGN_ROLE) && !isSelf} />

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Effective access</p>
            <p className="mb-3 text-xs text-muted-foreground">Computed by the same engine the API uses to authorize every request.</p>
            {user.access.is_company_admin && <div className="mb-3 rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary">Company Administrator — full access to this company.</div>}
            <div className="space-y-3">
              {Object.entries(user.access.capabilities).map(([module, caps]) => (
                <div key={module} className="rounded-2xl border border-border p-4">
                  <p className="mb-2 text-sm font-semibold">{module}</p>
                  <ul className="space-y-1.5">
                    {caps.map((c) => (
                      <li key={c.permission} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">{c.sensitivity !== "standard" && <Lock className="h-3 w-3 text-warning" />}{c.label}</span>
                        <span className="flex flex-wrap gap-1">{c.scopes.map((s) => <Badge key={s} tone={s === "COMPANY" ? "primary" : "neutral"}>{SCOPE_LABELS[s as Scope]}</Badge>)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {Object.keys(user.access.capabilities).length === 0 && <p className="text-sm text-muted-foreground">No permissions. This user can sign in but can't see any data.</p>}
            </div>
            {user.access.restricted.length > 0 && (
              <div className="mt-4 rounded-2xl border border-dashed border-border p-4">
                <p className="mb-2 text-sm font-semibold">Restricted</p>
                <div className="flex flex-wrap gap-1.5">{user.access.restricted.map((r) => <Badge key={r.permission}>{r.label}</Badge>)}</div>
              </div>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
