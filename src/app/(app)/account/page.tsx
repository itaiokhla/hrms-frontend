"use client";

import { KeyRound, Laptop, LogOut, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { fromNow } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Employee } from "@/lib/types";
import { useSession } from "@/store/session";

export default function AccountPage() {
  const { me } = useCan();
  const [tab, setTab] = useState(me?.employee ? "profile" : "security");
  const tabs = [...(me?.employee ? [{ value: "profile", label: "Profile" }] : []), { value: "security", label: "Security" }];
  return (
    <div>
      <PageHeader title="My account" description={`${me?.user.email} · ${me?.company.name}`} />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
        {me?.employee && <TabPanel value="profile"><Profile /></TabPanel>}
        <TabPanel value="security"><Security /></TabPanel>
      </Tabs>
    </div>
  );
}

function Profile() {
  const { me } = useCan();
  const reloadSession = useSession((s) => s.load);
  const { data, reload } = useApi(() => api.get<Employee>("/employees/me"), []);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const editable = can(me, P.PROFILE_UPDATE);

  useEffect(() => {
    if (data) setForm({ phone: data.phone ?? "", address: data.address ?? "", city: data.city ?? "", state: data.state ?? "", postal_code: data.postal_code ?? "", country: data.country ?? "" });
  }, [data]);

  if (!data) return <Skeleton className="h-72 rounded-2xl" />;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/employees/me", Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null])));
      toast.success("Profile updated");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (f: File) => {
    const body = new FormData();
    body.append("file", f);
    try {
      await api.post("/employees/me/photo", body);
      toast.success("Photo updated");
      setPhotoVersion((v) => v + 1);
      void reloadSession({ silent: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <Card className="flex flex-col items-center p-6 text-center">
        <Avatar name={data.full_name} src={data.has_photo || photoVersion ? `/api/v1/employees/${data.id}/photo?v=${photoVersion}` : null} size={96} />
        <p className="mt-4 text-lg font-semibold">{data.full_name}</p>
        <p className="text-sm text-muted-foreground">{data.position || "No title"}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {data.department && <Badge tone="primary">{data.department}</Badge>}
          <Badge>{data.employee_code}</Badge>
        </div>
        {data.manager_name && <p className="mt-4 text-xs text-muted-foreground">Reports to <span className="font-medium text-foreground">{data.manager_name}</span></p>}
        {editable && (
          <>
            <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button variant="secondary" size="sm" className="mt-5" onClick={() => file.current?.click()}><UserRound className="h-4 w-4" /> Change photo</Button>
          </>
        )}
      </Card>
      <Card>
        <CardHeader title="Contact details" description="Job details are managed by HR." action={editable && <Button size="sm" loading={saving} onClick={save}>Save</Button>} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {([["phone", "Phone"], ["address", "Address"], ["city", "City"], ["state", "State"], ["postal_code", "Postal code"], ["country", "Country"]] as const).map(([k, label]) => (
            <Field key={k} label={label}><Input disabled={!editable} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
          ))}
        </div>
      </Card>
    </div>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  created_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

function Security() {
  const { me } = useCan();
  const loadSession = useSession((s) => s.load);
  const { data: sessions, reload } = useApi(() => api.get<SessionRow[]>("/auth/sessions"), []);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [mfa, setMfa] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  const changePassword = async () => {
    setSaving(true);
    try {
      await api.put("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Password changed. Other devices were signed out.");
      setCurrent("");
      setNext("");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const startMfa = async () => {
    try {
      setMfa(await api.post<{ secret: string; otpauth_uri: string }>("/auth/mfa/setup"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const enableMfa = async () => {
    try {
      await api.post("/auth/mfa/enable", { code });
      toast.success("Two-factor authentication is on");
      setMfa(null);
      setCode("");
      void loadSession({ silent: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const disableMfa = async () => {
    try {
      await api.post("/auth/mfa/disable", { password: disablePassword, code });
      toast.success("Two-factor authentication is off");
      setDisableOpen(false);
      setCode("");
      setDisablePassword("");
      void loadSession({ silent: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const revoke = async (id: string) => {
    try {
      await api.delete(`/auth/sessions/${id}`);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Password</span>} />
        <div className="space-y-4 p-5">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password" hint="8+ characters with a letter and a number"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button loading={saving} disabled={!current || next.length < 8} onClick={changePassword}>Change password</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Two-factor authentication</span>}
          description={me?.is_company_admin ? "Strongly recommended for administrators." : "Adds a one-time code from your phone to sign-in."} />
        <div className="space-y-4 p-5">
          {me?.user.mfa_enabled ? (
            <>
              <Badge tone="success"><ShieldCheck className="h-3 w-3" /> Enabled</Badge>
              <Button variant="danger-ghost" onClick={() => setDisableOpen(true)}>Turn off</Button>
            </>
          ) : mfa ? (
            <>
              <p className="text-sm text-muted-foreground">Add this key to Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</p>
              <code className="block break-all rounded-xl bg-muted px-4 py-3 text-sm font-semibold tracking-wider">{mfa.secret}</code>
              <a href={mfa.otpauth_uri} className="text-sm font-medium text-primary hover:underline">Open in authenticator app</a>
              <Field label="Verification code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
              <Button disabled={code.length !== 6} onClick={enableMfa}>Enable</Button>
            </>
          ) : (
            <Button onClick={startMfa}><Smartphone className="h-4 w-4" /> Set up two-factor</Button>
          )}
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Active sessions" description="Sign out devices you don't recognise." />
        <ul className="divide-y divide-border/60">
          {!sessions && <li className="p-5"><Skeleton className="h-12" /></li>}
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3">
              <Laptop className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.user_agent ? s.user_agent.slice(0, 80) : "Unknown device"}</p>
                <p className="text-xs text-muted-foreground">{s.ip_address ?? "—"} · last active {fromNow(s.last_seen_at ?? s.created_at)}</p>
              </div>
              {s.current ? <Badge tone="success">This device</Badge> : (
                <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}><LogOut className="h-4 w-4" /> Sign out</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={disableOpen} onOpenChange={setDisableOpen} title="Turn off two-factor?"
        footer={<><Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" onClick={disableMfa}>Turn off</Button></>}>
        <div className="space-y-4">
          <Field label="Password"><Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} /></Field>
          <Field label="Current code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
      </Modal>
    </div>
  );
}
