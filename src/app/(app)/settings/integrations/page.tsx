"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity, KeyRound, Pause, Play, Plug, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { StayInSync } from "@/components/settings/StayInSync";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { can } from "@/lib/access";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CHANNEL_KIND_LABEL, integrationsApi, type Channel, type ChannelKind } from "@/lib/integrations";
import { P } from "@/lib/permissions.generated";

/** Settings › Integrations (G-24): Slack / Teams incoming webhooks, signed webhooks and the WhatsApp provider slot,
 * with their event subscriptions, a test send and the delivery log; plus this user's browser notifications. */
export default function IntegrationsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.INTEGRATIONS_MANAGE)}>
      <PayrollPage>
        <Channels />
      </PayrollPage>
    </RequireAccess>
  );
}

async function run(action: () => Promise<unknown>, done: string, after?: () => void) {
  try {
    await action();
    toast.success(done);
    after?.();
  } catch (e) {
    toast.error(toApiError(e).message);
  }
}

function Channels() {
  const { data, error, reload } = useApi(() => integrationsApi.channels(), []);
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const [log, setLog] = useState<Channel | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const confirm = useConfirm();
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-96" />;
  const labels = new Map(data.event_types.map((e) => [e.code, e.label]));
  return (
    <div className="max-w-5xl space-y-4" data-testid="integrations">
      <PageHeader title="Integrations" description="Send approvals, schedule changes and payroll events to Slack, Microsoft Teams or your own systems."
        actions={<Button data-testid="channel-new" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add channel</Button>} />
      {data.items.length === 0 ? (
        <Card><EmptyState icon={<Plug />} title="No channels yet" description="Add a Slack or Teams incoming webhook, or a signed webhook for your own systems." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2" data-testid="channel-list">
          <AnimatePresence initial={false}>
            {data.items.map((c, i) => (
              <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 6) * 0.03 }}>
                <Card className="space-y-3 p-4" data-testid={`channel-${c.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{CHANNEL_KIND_LABEL[c.kind]}{c.url_hint ? ` · ${c.url_hint}` : ""}</p></div>
                    <Badge tone={!c.provider_ready ? "warning" : c.active ? (c.last_error ? "danger" : "success") : "neutral"} dot>
                      <span data-testid="channel-state">{!c.provider_ready ? "Provider pending" : !c.active ? "Paused" : c.last_error ? "Failing" : "Active"}</span></Badge>
                  </div>
                  <p className="flex flex-wrap gap-1">{c.events.length === 0 ? <span className="text-xs text-muted-foreground">No events chosen</span> :
                    c.events.map((e) => <Badge key={e}>{labels.get(e) ?? e}</Badge>)}</p>
                  {c.last_error && <p className="text-xs text-danger">Last error: {c.last_error}</p>}
                  {c.last_success_at && <p className="text-xs text-muted-foreground">Last delivered {fmtDateTime(c.last_success_at)}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" data-testid={`channel-test-${c.id}`}
                      onClick={() => void integrationsApi.test(c.id).then((r) => {
                        if (r.status === "SENT") toast.success("Test message delivered");
                        else toast.error(r.error ?? `Not delivered (${r.status.toLowerCase()})`);
                        void reload();
                      }).catch((e) => toast.error(toApiError(e).message))}><Send className="h-4 w-4" /> Test</Button>
                    <Button size="sm" variant="ghost" data-testid={`channel-edit-${c.id}`} onClick={() => setEditing(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" data-testid={`channel-log-${c.id}`} onClick={() => setLog(c)}><Activity className="h-4 w-4" /> Log</Button>
                    <Button size="sm" variant="ghost" data-testid={`channel-pause-${c.id}`}
                      onClick={() => void run(() => integrationsApi.update(c.id, { active: !c.active, row_version: c.row_version }), c.active ? "Paused" : "Resumed", reload)}>
                      {c.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {c.active ? "Pause" : "Resume"}</Button>
                    {c.kind === "WEBHOOK" && <Button size="sm" variant="ghost" data-testid={`channel-secret-${c.id}`}
                      onClick={() => void integrationsApi.secret(c.id).then((s) => setSecret(s.secret)).catch((e) => toast.error(toApiError(e).message))}>
                      <KeyRound className="h-4 w-4" /> Signing secret</Button>}
                    <Button size="sm" variant="danger-ghost" aria-label={`Remove ${c.name}`} data-testid={`channel-delete-${c.id}`}
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${c.name}?`, message: "Its delivery log is removed too.", confirmLabel: "Remove", tone: "danger" }))
                          void run(() => integrationsApi.remove(c.id), "Channel removed", reload);
                      }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">On this browser</h2>
        <StayInSync calendar={false} />
      </div>
      {editing && <ChannelForm channel={editing === "new" ? null : editing} events={data.event_types}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      <DeliveryLog channel={log} onClose={() => setLog(null)} />
      <Modal open={secret !== null} onOpenChange={(o) => !o && setSecret(null)} title="Signing secret"
        description="Your receiver checks X-HRMS-Signature = sha256=HMAC-SHA256(secret, timestamp + '.' + body), with X-HRMS-Timestamp.">
        <code className="block break-all rounded-xl bg-muted p-3 text-xs" data-testid="channel-secret-value">{secret}</code>
      </Modal>
    </div>
  );
}

function ChannelForm({ channel, events, onClose, onSaved }: {
  channel: Channel | null; events: { code: string; label: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? "SLACK");
  const [name, setName] = useState(channel?.name ?? "");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(channel?.events ?? ["shift_request.submitted", "attendance_request.submitted"]);
  const [rotate, setRotate] = useState(false);
  const [saving, setSaving] = useState(false);
  const needsUrl = !channel && kind !== "WHATSAPP";
  const save = async () => {
    setSaving(true);
    await run(() => (channel
      ? integrationsApi.update(channel.id, { name: name.trim(), events: chosen, ...(url.trim() ? { url: url.trim() } : {}),
        rotate_secret: rotate, row_version: channel.row_version })
      : integrationsApi.create({ kind, name: name.trim(), url: url.trim() || null, events: chosen })),
    channel ? "Channel saved" : "Channel added", onSaved);
    setSaving(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title={channel ? `Edit ${channel.name}` : "Add a channel"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="channel-save" loading={saving} disabled={name.trim().length < 2 || (needsUrl && !url.trim())} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="channel-form">
        <Field label="Type"><Select data-testid="channel-kind" value={kind} disabled={!!channel} onChange={(e) => setKind(e.target.value as ChannelKind)}>
          {(Object.keys(CHANNEL_KIND_LABEL) as ChannelKind[]).map((k) => <option key={k} value={k}>{CHANNEL_KIND_LABEL[k]}</option>)}</Select></Field>
        <Field label="Name"><Input data-testid="channel-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="#ops-approvals" /></Field>
        {kind !== "WHATSAPP" ? (
          <Field label={channel ? "New webhook URL (leave empty to keep)" : "Webhook URL"} className="sm:col-span-2"
            hint={kind === "SLACK" ? "Slack › Apps › Incoming Webhooks" : kind === "TEAMS" ? "Teams channel › Connectors › Incoming Webhook" : "Your HTTPS endpoint; requests are signed."}>
            <Input data-testid="channel-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        ) : <p className="text-sm text-warning sm:col-span-2">WhatsApp needs a provider account; messages are recorded as skipped until one is connected.</p>}
        <fieldset className="space-y-1 sm:col-span-2" data-testid="channel-events">
          <legend className="mb-1 text-sm font-medium">Events</legend>
          {events.map((e) => (
            <label key={e.code} className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`channel-event-${e.code}`}
              checked={chosen.includes(e.code)} onChange={(ev) => setChosen(ev.target.checked ? [...chosen, e.code] : chosen.filter((x) => x !== e.code))} />{e.label}</label>
          ))}
        </fieldset>
        {channel?.kind === "WEBHOOK" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> Create a new signing secret</label>}
      </div>
    </Modal>
  );
}

function DeliveryLog({ channel, onClose }: { channel: Channel | null; onClose: () => void }) {
  const { data, error } = useApi(() => (channel ? integrationsApi.deliveries(channel.id) : Promise.resolve(null)), [channel?.id]);
  const tone = { SENT: "success", FAILED: "danger", QUEUED: "info", SKIPPED: "neutral" } as const;
  return (
    <Sheet open={channel !== null} onOpenChange={(o) => !o && onClose()} title={channel ? `Deliveries · ${channel.name}` : "Deliveries"}>
      {error ? <ErrorState message={error.message} /> : !data ? <Skeleton className="h-40" /> : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="delivery-log">{data.items.map((d) => (
          <li key={d.id} className="space-y-0.5 py-2 text-sm">
            <p className="flex items-center gap-2"><Badge tone={tone[d.status]} dot>{d.status.toLowerCase()}</Badge><span className="font-medium">{d.title}</span></p>
            <p className="text-xs text-muted-foreground">{d.event_type} · {fmtDateTime(d.sent_at ?? d.created_at)} · {d.attempts} attempt(s){d.last_error ? ` · ${d.last_error}` : ""}</p>
          </li>))}</ul>
      )}
    </Sheet>
  );
}
