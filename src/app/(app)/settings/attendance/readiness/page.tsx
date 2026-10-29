"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle, BadgeCheck, CheckCircle2, CircleDashed, Factory, Globe2, Info, Loader2, PlayCircle, ShieldCheck, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { canAny } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { readinessApi, type AcceptanceRun, type CheckItem, type FairWorkweek, type PackEntity } from "@/lib/readiness";
import { useTabParam } from "@/lib/useTabParam";

const TABS = ["checklist", "packs", "bundles", "fww"] as const;
type Tab = (typeof TABS)[number];

/** Settings › Attendance › Readiness & country rules (G-22 / G-23): the cut-over checklist and acceptance run with
 * maker-checker sign-off, each legal entity's country working-time pack, industry starter bundles and the US Fair
 * Workweek predictability-pay estimate. */
export default function ReadinessPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_MANAGE_POLICY, P.SHIFT_MANAGE])}>
      <PayrollPage>
        <Readiness />
      </PayrollPage>
    </RequireAccess>
  );
}

function Readiness() {
  const [tab, setTab] = useTabParam<Tab>(TABS, "checklist");
  return (
    <div className="max-w-5xl space-y-4" data-testid="readiness">
      <PageHeader title="Readiness & country rules" description="Check the attendance set-up before go-live, adopt your countries' working-time rules and start from industry templates." />
      <Tabs tabs={[{ value: "checklist", label: "Go-live checklist" }, { value: "packs", label: "Country rules" },
        { value: "bundles", label: "Industry templates" }, { value: "fww", label: "Fair Workweek" }]} value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabPanel value="checklist">{tab === "checklist" && <Checklist />}</TabPanel>
        <TabPanel value="packs">{tab === "packs" && <Packs />}</TabPanel>
        <TabPanel value="bundles">{tab === "bundles" && <Bundles />}</TabPanel>
        <TabPanel value="fww">{tab === "fww" && <FairWorkweekTab />}</TabPanel>
      </Tabs>
    </div>
  );
}

const ICON = {
  PASS: <CheckCircle2 className="h-5 w-5 text-success" />, WARN: <AlertTriangle className="h-5 w-5 text-warning" />,
  FAIL: <XCircle className="h-5 w-5 text-danger" />, INFO: <Info className="h-5 w-5 text-info" />,
};

function Items({ items }: { items: CheckItem[] }) {
  return (
    <ul className="divide-y divide-border">{items.map((i, n) => (
      <motion.li key={i.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(n, 14) * 0.03 }}
        className="flex items-start gap-3 px-4 py-3" data-testid={`check-${i.key}`} data-status={i.status}>
        {ICON[i.status]}
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{i.label}</p><p className="text-xs text-muted-foreground">{i.detail}</p></div>
        {i.link && i.status !== "PASS" && <Link href={i.link} className="text-xs font-medium text-primary hover:underline">Fix</Link>}
      </motion.li>))}</ul>
  );
}

function Checklist() {
  const { data, error, reload } = useApi(() => readinessApi.readiness(), []);
  const [runId, setRunId] = useState<number | null>(null);
  const [runData, setRunData] = useState<AcceptanceRun | null>(null);
  const [signing, setSigning] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await readinessApi.acceptance(runId);
        if (stop) return;
        setRunData(r);
        if (["QUEUED", "RUNNING"].includes(r.status)) setTimeout(() => void poll(), 1500);
        else void reload();
      } catch (e) {
        toast.error(toApiError(e).message);
      }
    };
    void poll();
    return () => { stop = true; };
  }, [runId, reload]);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-96" />;
  const last = runData ?? data.last_acceptance;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4" data-testid="readiness-summary">
        <div className="flex-1">
          <p className="font-medium">{s?.ready ? "Ready for go-live" : "Not ready yet"}</p>
          <p className="text-xs text-muted-foreground">{s?.PASS} passed · {s?.WARN} warnings · {s?.FAIL} blocking · {s?.INFO} optional</p>
        </div>
        <Button data-testid="acceptance-start" onClick={() => void readinessApi.startAcceptance().then((r) => { setRunData(null); setRunId(r.job_id); toast.success("Acceptance run started"); })
          .catch((e) => toast.error(toApiError(e).message))}><PlayCircle className="h-4 w-4" /> Run acceptance</Button>
      </Card>
      <Card className="p-0" data-testid="readiness-items"><Items items={data.items} /></Card>
      {last && (
        <Card className="space-y-3 p-4" data-testid="acceptance-run">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 font-medium">Acceptance run #{last.job_id} · {fmtDateTime(last.created_at)}</p>
            {["QUEUED", "RUNNING"].includes(last.status) ? <Badge tone="info"><Loader2 className="h-3 w-3 animate-spin" /> running</Badge> :
              <Badge tone={last.status === "SUCCEEDED" ? (last.summary?.ready ? "success" : "warning") : "danger"} dot>
                <span data-testid="acceptance-status">{last.status === "SUCCEEDED" ? (last.summary?.ready ? "passed" : "has blocking items") : last.status.toLowerCase()}</span></Badge>}
            {last.signed_off_at && <Badge tone="success"><BadgeCheck className="h-3 w-3" /> Signed off {fmtDateTime(last.signed_off_at)}</Badge>}
          </div>
          {last.probes.length > 0 && (
            <ul className="grid gap-1 text-xs sm:grid-cols-2" data-testid="acceptance-probes">{last.probes.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">{p.status === "PASS" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />}{p.detail}</li>))}</ul>
          )}
          {last.status === "SUCCEEDED" && !last.signed_off_at && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="success" data-testid="acceptance-sign" disabled={!last.summary?.ready} onClick={() => setSigning(true)}><ShieldCheck className="h-4 w-4" /> Sign off</Button>
              <span className="text-xs text-muted-foreground">{last.summary?.ready ? "Another administrator than the one who started the run signs it off." : "Fix the blocking items and run again."}</span>
            </div>
          )}
        </Card>
      )}
      <Modal open={signing} onOpenChange={setSigning} title="Sign off the acceptance run"
        footer={<><Button variant="secondary" onClick={() => setSigning(false)}>Cancel</Button>
          <Button data-testid="acceptance-sign-confirm" onClick={() => last && void readinessApi.signOff(last.job_id, note).then((r) => {
            setRunData(r); setSigning(false); toast.success("Signed off"); void reload();
          }).catch((e) => toast.error(toApiError(e).message))}>Sign off</Button></>}>
        <Field label="Note (optional)"><Textarea data-testid="acceptance-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function Packs() {
  const { data, error, reload } = useApi(() => readinessApi.packs(), []);
  const [target, setTarget] = useState<PackEntity | null>(null);
  const [reason, setReason] = useState("");
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-3" data-testid="packs">
      <p className="text-xs text-muted-foreground">Pack version {data.version}. Values are statutory floors for guidance, not legal advice; your
        own policies may be stricter, never looser. Unverified packs warn, they never block.</p>
      {data.items.map((e) => (
        <Card key={e.legal_entity_id} className="space-y-3 p-4" data-testid={`pack-${e.legal_entity_id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" />
            <p className="flex-1 font-medium">{e.name} <span className="text-muted-foreground">· {e.country}</span></p>
            {e.has_pack ? (
              <>
                <Badge tone={e.verified ? "success" : "warning"}>{e.verified ? "Verified" : "Not verified"}</Badge>
                <Badge tone={e.adopted ? "success" : "neutral"} dot><span data-testid="pack-adopted">{e.adopted ? "Applied" : "Guidance only"}</span></Badge>
                <Button size="sm" variant={e.adopted ? "secondary" : "primary"} data-testid={`pack-toggle-${e.legal_entity_id}`} onClick={() => setTarget(e)}>
                  {e.adopted ? "Stop applying" : "Apply rules"}</Button>
              </>
            ) : <Badge>No pack for this country</Badge>}
          </div>
          {e.pack && (
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <Fact label="Week" value={e.pack.weekly_max_hours ? `${e.pack.weekly_max_hours} h max` : "No cap"} />
              <Fact label="Day today" value={e.daily_max_today ? `${e.daily_max_today} h max` : "No daily cap"} />
              <Fact label="Days per week" value={e.pack.max_days_per_week ? `${e.pack.max_days_per_week}` : "—"} />
              <Fact label="Breaks" value={e.pack.breaks.length ? e.pack.breaks.map((b) => `${b.minutes} min after ${b.after_minutes / 60} h`).join(", ") : "None required"} />
              <Fact label="Overtime" value={`×${e.pack.overtime.multiplier}${e.pack.overtime.weekly_threshold_hours ? ` over ${e.pack.overtime.weekly_threshold_hours} h/week` : ""}${e.pack.overtime.requires_consent ? ", consent" : ""}`} />
              <Fact label="Schedule notice" value={e.pack.scheduling.notice_hours ? `${e.pack.scheduling.notice_hours / 24} days${e.pack.scheduling.late_addition_consent ? ", consent for late additions" : ""}` : "—"} />
              {(e.pack.reduced_hours_windows ?? []).map((w) => <Fact key={w.code} label={w.code.replace("_", " ")} value={`${fmtDate(w.from)} – ${fmtDate(w.to)}: ${w.daily_max_hours} h/day`} />)}
              <p className="text-xs text-muted-foreground sm:col-span-3">Sources: {e.pack.sources.join("; ")}</p>
            </div>
          )}
        </Card>
      ))}
      <Modal open={target !== null} onOpenChange={(o) => !o && setTarget(null)} title={target?.adopted ? "Stop applying country rules" : "Apply country rules"}
        description="Applying changes how schedules are checked and how days are evaluated from today. The change is audited."
        footer={<><Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
          <Button data-testid="pack-confirm" disabled={reason.trim().length < 3}
            onClick={() => target && void readinessApi.adopt(target.legal_entity_id, !target.adopted, reason.trim()).then(() => {
              toast.success(target.adopted ? "Country rules are guidance only now" : "Country rules applied");
              setTarget(null); setReason(""); void reload();
            }).catch((e) => toast.error(toApiError(e).message))}>Confirm</Button></>}>
        <Field label="Reason"><Input data-testid="pack-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Go-live for the US stores" /></Field>
      </Modal>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/50 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>;
}

function Bundles() {
  const { data, error, reload } = useApi(() => readinessApi.bundles(), []);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="bundles">
      {data.items.map((b, i) => (
        <motion.div key={b.code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
          <Card className="flex h-full flex-col gap-2 p-4" data-testid={`bundle-${b.code}`}>
            <p className="flex items-center gap-2 font-medium"><Factory className="h-4 w-4 text-primary" /> {b.name}<Badge className="ml-auto">{b.country}</Badge></p>
            <p className="flex-1 text-sm text-muted-foreground">{b.description}</p>
            <p className="text-xs text-muted-foreground">Creates draft attendance rules and a draft schedules policy; nothing changes until you review and activate them.</p>
            <div>{b.applied ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Drafts created</Badge> : (
              <Button size="sm" data-testid={`bundle-apply-${b.code}`} loading={busy === b.code}
                onClick={() => { setBusy(b.code); void readinessApi.applyBundle(b.code).then(() => { toast.success("Draft policies created"); void reload(); })
                  .catch((e) => toast.error(toApiError(e).message)).finally(() => setBusy(null)); }}>
                <CircleDashed className="h-4 w-4" /> Create drafts</Button>)}</div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function FairWorkweekTab() {
  const packs = useApi(() => readinessApi.packs(), []);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [entity, setEntity] = useState(0);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [result, setResult] = useState<FairWorkweek | null>(null);
  const withNotice = (packs.data?.items ?? []).filter((e) => e.pack?.scheduling.notice_hours);
  useEffect(() => { if (!entity && withNotice.length) setEntity(withNotice[0].legal_entity_id); }, [entity, withNotice]);
  if (packs.error) return <ErrorState message={packs.error.message} onRetry={packs.reload} />;
  if (!packs.data) return <Skeleton className="h-40" />;
  if (!withNotice.length) return <Card className="p-4 text-sm text-muted-foreground">No legal entity is in a country with schedule-notice rules (e.g. the United States).</Card>;
  return (
    <div className="space-y-3" data-testid="fww">
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <Field label="Legal entity"><Select data-testid="fww-entity" value={entity} onChange={(e) => setEntity(Number(e.target.value))}>
          {withNotice.map((e) => <option key={e.legal_entity_id} value={e.legal_entity_id}>{e.name}</option>)}</Select></Field>
        <Field label="From"><Input type="date" data-testid="fww-from" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" data-testid="fww-to" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex items-end"><Button data-testid="fww-run" onClick={() => void readinessApi.fairWorkweek(entity, from, to).then(setResult).catch((e) => toast.error(toApiError(e).message))}>Estimate</Button></div>
      </Card>
      {result && (
        <Card className="space-y-3 p-4" data-testid="fww-result">
          <p className="font-medium">Predictability pay owed: <span data-testid="fww-total">{result.total_hours}</span> hours
            {!result.adopted && <Badge tone="warning" className="ml-2">Rules not applied yet</Badge>}</p>
          <p className="text-xs text-muted-foreground">Employer changes within {result.notice_hours ? result.notice_hours / 24 : 0} days of the shift: 1 hour each; cancellations within 24 hours: 4 hours. Changes employees asked for owe nothing.</p>
          {result.items.length > 0 && (
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>Employee</th><th>Shift</th><th>Change</th><th>Notice</th><th className="text-right">Hours</th></tr></thead>
              <tbody>{result.items.map((it, n) => (
                <tr key={n} className="border-t border-border/60"><td className="py-1">{it.employee_name}</td><td>{fmtDate(it.shift_date)}</td>
                  <td>{it.kind === "CANCELLATION_24H" ? "Cancelled < 24 h" : it.change_kind.toLowerCase()}</td><td>{it.notice_hours} h</td><td className="text-right">{it.hours}</td></tr>))}</tbody></table>
          )}
        </Card>
      )}
    </div>
  );
}
