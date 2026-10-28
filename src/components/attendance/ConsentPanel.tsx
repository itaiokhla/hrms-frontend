"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Archive, CheckCircle2, Eye, FileText, Fingerprint, History, MapPin, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { captureApi, type PrivacyConsentRow, type PrivacyPanel } from "./captureApi";
import {
  CHANNEL_LABEL, CONSENT_STATUS, GEOFENCE_LABEL, LEGAL_BASIS_LABEL, LOCATION_LABEL, SOURCE_LABEL,
} from "./captureModel";

const fade = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } };

/**
 * The transparency panel `/me/attendance/privacy` (07 §12, SR-AS-14; 09-ui-ux/02 §14): what is collected and when,
 * how long it is kept, who can see it, my consents with Grant / Withdraw (biometric withdrawal switches me to punching
 * without face), policy documents with Acknowledge, the consent history and who viewed my evidence. Own data only.
 */
export function ConsentPanel() {
  const { data, error, loading, reload, setData } = useApi(() => captureApi.privacy(), []);
  const [confirm, setConfirm] = useState<{ row: PrivacyConsentRow; status: "GRANTED" | "WITHDRAWN" | "DECLINED" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <Card><ErrorState message={error.message} onRetry={() => void reload()} /></Card>;
  if (loading || !data) {
    return <div className="space-y-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>;
  }

  const change = async () => {
    if (!confirm) return;
    setBusy(confirm.row.purpose);
    try {
      await captureApi.setMyConsent({ purpose: confirm.row.purpose, status: confirm.status, notice_version: confirm.row.notice_version });
      toast.success(confirm.status === "GRANTED" ? `${confirm.row.label}: consent given` : `${confirm.row.label}: consent withdrawn`);
      setConfirm(null);
      const next = await captureApi.privacy();
      setData(next);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const acknowledge = async (id: number) => {
    setBusy(`doc-${id}`);
    try {
      await captureApi.acknowledge(id);
      toast.success("Acknowledged");
      setData(await captureApi.privacy());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const relevant = data.consents.filter((c) => c.needed || c.status !== null);
  const others = data.consents.filter((c) => !c.needed && c.status === null);

  return (
    <MotionSafe>
      <div className="space-y-6" data-testid="privacy-panel" data-employee-id={data.employee_id}>
        <PageHeader eyebrow="Me" title="Privacy & consents"
          description={`What your company records when you punch, how long it is kept and who can see it — as of ${fmtDate(data.as_of, "d MMM yyyy")}.`} />

        <motion.div {...fade}>
          <Collection panel={data} />
        </motion.div>

        <motion.div {...fade} transition={{ ...fade.transition, delay: 0.05 }}>
          <Card data-testid="privacy-consents">
            <CardHeader title="Your consents" description="Consents you can give or withdraw at any time. Withdrawing never removes past records." />
            <ul className="divide-y divide-border">
              {relevant.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No consent is asked of you today.</li>}
              {relevant.map((c) => <ConsentRow key={c.purpose} row={c} busy={busy === c.purpose} onChange={(status) => setConfirm({ row: c, status })} />)}
            </ul>
            {others.length > 0 && (
              <details className="border-t border-border px-5 py-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Other purposes ({others.length})</summary>
                <ul className="mt-2 divide-y divide-border">
                  {others.map((c) => <ConsentRow key={c.purpose} row={c} busy={busy === c.purpose} onChange={(status) => setConfirm({ row: c, status })} />)}
                </ul>
              </details>
            )}
          </Card>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          <motion.div {...fade} transition={{ ...fade.transition, delay: 0.1 }}>
            <Card className="h-full" data-testid="privacy-retention">
              <CardHeader title={<span className="flex items-center gap-2"><Archive className="h-4 w-4 text-primary" aria-hidden /> How long it is kept</span>} />
              <ul className="space-y-2 p-5 text-sm">
                {data.retention.map((r) => (
                  <li key={r.class} className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2" data-testid={`retention-${r.class}`}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> {r.label}
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
          <motion.div {...fade} transition={{ ...fade.transition, delay: 0.15 }}>
            <Card className="h-full" data-testid="privacy-viewers">
              <CardHeader title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" aria-hidden /> Who can see it</span>} />
              <ul className="space-y-3 p-5 text-sm">
                {data.viewers.map((v) => (
                  <li key={v.who}><p className="font-medium">{v.who}</p><p className="text-muted-foreground">{v.sees}</p></li>
                ))}
              </ul>
              {data.contact && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Questions: {data.contact}</p>}
            </Card>
          </motion.div>
        </div>

        <motion.div {...fade} transition={{ ...fade.transition, delay: 0.2 }}>
          <Card data-testid="privacy-documents">
            <CardHeader title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" aria-hidden /> Notices</span>}
              description="The notices that describe these purposes." />
            {data.documents.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No notice is published yet.</p> : (
              <ul className="divide-y divide-border">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`privacy-document-${d.code}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{d.title} <span className="text-xs text-muted-foreground">v{d.version}</span></p>
                      {d.summary && <p className="text-sm text-muted-foreground">{d.summary}</p>}
                    </div>
                    {d.acknowledged_at ? (
                      <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden /> Acknowledged {fmtDate(d.acknowledged_at)}</Badge>
                    ) : d.requires_acknowledgement ? (
                      <Button size="sm" onClick={() => acknowledge(d.id)} loading={busy === `doc-${d.id}`} data-testid={`privacy-acknowledge-${d.id}`}>Acknowledge</Button>
                    ) : <Badge tone="neutral">For your information</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card data-testid="privacy-history">
            <CardHeader title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-primary" aria-hidden /> Consent history</span>} />
            {data.history.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
              <ol className="space-y-2 p-5 text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2">
                    <div>
                      <p className="font-medium">{h.purpose_label}</p>
                      <p className="text-xs text-muted-foreground">from {fmtDate(h.valid_from)} · {CHANNEL_LABEL[h.channel] ?? h.channel} · notice {h.notice_version}</p>
                    </div>
                    <StatusChip status={h.status} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card data-testid="privacy-evidence-views">
            <CardHeader title={<span className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" aria-hidden /> Who viewed my evidence</span>}
              description="Views of your exact location or punch evidence in the last 12 months." />
            {data.evidence_views.length === 0 ? <EmptyState title="No one has viewed it." className="py-8" /> : (
              <ul className="space-y-2 p-5 text-sm">
                {data.evidence_views.map((v, i) => (
                  <li key={`${v.at}-${i}`} className="flex justify-between gap-3"><span>{v.viewer}{v.what ? ` · ${v.what}` : ""}</span><span className="text-muted-foreground">{fmtDateTime(v.at)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Modal open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}
          title={confirm?.status === "GRANTED" ? `Give consent: ${confirm.row.label}` : `Withdraw consent: ${confirm?.row.label ?? ""}`}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm?.status === "GRANTED" ? "primary" : "danger"} onClick={change} loading={busy !== null}
              data-testid="consent-confirm">
              {confirm?.status === "GRANTED" ? "Give consent" : "Withdraw"}
            </Button>
          </>}>
          {confirm && (
            <div className="space-y-3 text-sm" data-testid="consent-dialog" data-purpose={confirm.row.purpose}>
              <p>Legal basis: {LEGAL_BASIS_LABEL[confirm.row.legal_basis] ?? confirm.row.legal_basis}. Notice {confirm.row.notice_version ?? "—"}.</p>
              {confirm.status !== "GRANTED" && confirm.row.withdraw_effect && (
                <p className="rounded-xl bg-warning-soft px-3 py-2 text-warning">{confirm.row.withdraw_effect}</p>
              )}
              {confirm.status === "GRANTED" && <p className="text-muted-foreground">You can withdraw it here at any time.</p>}
            </div>
          )}
        </Modal>
      </div>
    </MotionSafe>
  );
}

function StatusChip({ status }: { status: string | null }) {
  if (!status) return <Badge tone="neutral">Not given</Badge>;
  const s = CONSENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

function ConsentRow({ row, busy, onChange }: {
  row: PrivacyConsentRow;
  busy: boolean;
  onChange: (status: "GRANTED" | "WITHDRAWN" | "DECLINED") => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`consent-${row.purpose}`} data-status={row.status ?? "NONE"}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          {row.label}
          {row.needed && <Badge tone="info">Used by your company</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {LEGAL_BASIS_LABEL[row.legal_basis] ?? row.legal_basis}
          {row.valid_from ? ` · since ${fmtDate(row.valid_from)}` : ""}{row.valid_to ? ` until ${fmtDate(row.valid_to)}` : ""}
          {row.notice_version ? ` · notice ${row.notice_version}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusChip status={row.status} />
        <AnimatePresence mode="wait" initial={false}>
          {row.can_withdraw ? (
            <motion.span key="w" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button size="sm" variant="danger-ghost" loading={busy} onClick={() => onChange("WITHDRAWN")} data-testid={`consent-withdraw-${row.purpose}`}>Withdraw</Button>
            </motion.span>
          ) : row.can_grant && (row.legal_basis === "CONSENT" || row.needed) ? (
            <motion.span key="g" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button size="sm" variant="subtle" loading={busy} onClick={() => onChange("GRANTED")} data-testid={`consent-grant-${row.purpose}`}>Give consent</Button>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </li>
  );
}

function Collection({ panel }: { panel: PrivacyPanel }) {
  const c = panel.collection;
  const items = [
    { icon: MapPin, title: "Location at punch", value: LOCATION_LABEL[c.location_at_punch] ?? c.location_at_punch,
      note: c.note },
    { icon: ShieldCheck, title: "Site checks", value: [c.site_checks.geofence !== "OFF" ? `Area: ${GEOFENCE_LABEL[c.site_checks.geofence] ?? c.site_checks.geofence}` : null,
      c.site_checks.network !== "OFF" ? `Network: ${c.site_checks.network.toLowerCase()}` : null, c.site_checks.qr !== "OFF" ? "QR poster" : null]
      .filter(Boolean).join(" · ") || "None", note: "Your manager sees only whether you were at your site, never where you were." },
    { icon: Fingerprint, title: "Face match", value: c.face_match.on ? (c.face_match.applies_to_me ? "On for you" : "Off for you") : "Not used",
      note: c.face_match.note ?? (c.face_match.on ? "Compared with your own enrolled face only." : null) },
    { icon: FileText, title: "Where you can punch", value: c.sources.map((s) => SOURCE_LABEL[s] ?? s).join(", ") || "—",
      note: c.punch_photo ? "A photo is taken with each punch." : "No photo is taken." },
  ];
  return (
    <Card data-testid="privacy-collection">
      <CardHeader title="What is recorded" description="Only when you punch, unless your company tracks location during shifts." />
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.title} className="flex gap-3 rounded-2xl border border-border p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><it.icon className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{it.title}</p>
              <p className="font-medium">{it.value}</p>
              {it.note && <p className="mt-0.5 text-xs text-muted-foreground">{it.note}</p>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
