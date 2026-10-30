"use client";

import { ArrowLeft, CalendarOff, Hand, Tag, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DetailGate, NotFoundState, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, type Column } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { toApiError } from "@/lib/api";
import { isIdSegment } from "@/lib/attendance-routes";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import {
  OPEN_SHIFT_STATUS_LABEL, STATUS_LABEL, reasonText, shiftRequestsApi, type OpenShift, type OpenShiftClaim,
} from "@/lib/shiftRequests";

import { RequestActions, openShiftSource, openShiftTimes, useOpenShiftClaim } from "./ShiftRequestLists";

const BACK = "/attendance/open-shifts";
const BACK_LABEL = "Back to Open shifts";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_TONE: Record<OpenShift["status"], Tone> = { OPEN: "info", FILLED: "success", CANCELLED: "neutral", EXPIRED: "neutral" };

/** Worst check of a claim (§5.4 severities): text and tone, never colour alone. */
const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  PASS: { label: "No issues", tone: "success" },
  INFO: { label: "Info only", tone: "info" },
  WARN: { label: "Warnings", tone: "warning" },
  REQUIRE_REASON: { label: "Needs a reason", tone: "warning" },
  BLOCK: { label: "Blocked", tone: "danger" },
};

const hours = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

/** The claims in claim order with the §6.5 ranking inputs; Approve / Reject per claim (no automatic choice, D-AS-68). */
function ClaimsTable({ claims, onChanged }: { claims: OpenShiftClaim[]; onChanged: () => void }) {
  const columns: Column<OpenShiftClaim>[] = [
    { key: "claimant", header: "Claimant", primary: true, cell: (r) => <span className="font-medium">{r.requester_name ?? "—"}</span> },
    { key: "claimed", header: "Claimed", hideOnMobile: true, cell: (r) => fmtDateTime(r.submitted_at) },
    { key: "status", header: "Status", cell: (r) => <Badge tone={STATUS_LABEL[r.status].tone} dot>{STATUS_LABEL[r.status].label}</Badge> },
    { key: "hours", header: "Hours that week", cell: (r) => (r.ranking
      ? <span>{hours(r.ranking.week_hours_before)} <span aria-hidden>→</span><span className="sr-only">to</span> {hours(r.ranking.week_hours_after)}</span>
      : "—") },
    { key: "severity", header: "Worst check", cell: (r) => {
      const s = r.ranking ? SEVERITY[r.ranking.worst_severity] ?? { label: reasonText(r.ranking.worst_severity), tone: "neutral" as Tone } : null;
      return s ? <Badge tone={s.tone}>{s.label}</Badge> : "—";
    } },
    { key: "tags", header: "Skills", hideOnMobile: true, cell: (r) => (r.ranking?.tags.length ? r.ranking.tags.join(", ") : "—") },
    { key: "priority", header: "Priority group", cell: (r) => (r.ranking ? (r.ranking.in_priority_group ? "Yes" : "No") : "—") },
    { key: "actions", header: <span className="sr-only">Actions</span>, cell: (r) => <RequestActions r={r} onChanged={onChanged} /> },
  ];
  return (
    <DataTable columns={columns} rows={claims} rowKey={(r) => r.id} caption="Claims"
      empty={<EmptyState icon={<Users />} title="No claims yet" description="Claims appear here in the order people make them." />} />
  );
}

function OpenShiftView({ shift, branches, onChanged }: {
  shift: OpenShift; branches?: { id: number; name: string }[]; onChanged: () => void;
}) {
  const { me } = useCan();
  const confirm = useConfirm();
  const { claim, dialogs } = useOpenShiftClaim(onChanged);
  // Planners cancel (`roster:plan`, 03-shifts/03 §6.3); the API still checks that they cover the branch / team.
  const planner = can(me, P.ROSTER_PLAN);
  const viewer = shift.can_claim !== undefined || shift.my_claim !== undefined;
  const pending = (shift.claims ?? []).filter((c) => c.status.startsWith("PENDING")).length;
  const branch = branches?.find((b) => b.id === shift.branch_id)?.name ?? `Branch #${shift.branch_id}`;
  const status = OPEN_SHIFT_STATUS_LABEL[shift.status];

  const cancel = async () => {
    const ok = await confirm({
      title: "Cancel this open shift?",
      message: pending
        ? `${pending} pending ${pending === 1 ? "claim is" : "claims are"} closed. People already approved keep the shift.`
        : "Nobody can claim it any more. People already approved keep the shift.",
      confirmLabel: "Cancel open shift", cancelLabel: "Keep it", tone: "danger",
    });
    if (!ok) return;
    try {
      await shiftRequestsApi.cancelOpenShift(shift.id);
      toast.success("Cancelled");
      onChanged();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };

  return (
    <div className="space-y-6" data-testid="open-shift-detail">
      <Link href={BACK} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {BACK_LABEL}
      </Link>
      <WorkspaceHeader eyebrow="Open shifts" showHideAmounts={false}
        title={`Open shift · ${fmtDate(shift.shift_date)} · ${openShiftTimes(shift)}`}
        description={`${openShiftSource(shift)} · ${shift.approval_required ? "claims need approval" : "the first valid claim gets it"}`}
        actions={planner && shift.status === "OPEN" && (
          <Button variant="secondary" data-testid={`open-shift-cancel-${shift.id}`} onClick={() => void cancel()}>
            <CalendarOff className="h-4 w-4" aria-hidden /> Cancel open shift…
          </Button>
        )} />

      <Card className="p-5">
        <h2 className="mb-4 text-base font-semibold">Details</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Date">{fmtDate(shift.shift_date)}</Fact>
          <Fact label="Shift">{openShiftTimes(shift)}{shift.scheduled_minutes ? ` · ${hours(shift.scheduled_minutes / 60)} net` : ""}</Fact>
          <Fact label="Branch">{branch}</Fact>
          <Fact label="Places"><span data-testid="open-shift-filled">{shift.filled_count} of {shift.required_count} filled</span></Fact>
          <Fact label="Status">
            <Badge tone={STATUS_TONE[shift.status]} dot><span data-testid="open-shift-status">{status}</span></Badge>
          </Fact>
          <Fact label="Claims close">{fmtDateTime(shift.expires_at)}</Fact>
          {shift.priority_until && <Fact label="Priority window">Part-time staff first until {fmtDateTime(shift.priority_until)}</Fact>}
          <Fact label="Posted">{fmtDateTime(shift.posted_at)}</Fact>
          {shift.filled_at && <Fact label="Filled">{fmtDateTime(shift.filled_at)}</Fact>}
          <Fact label="Required skills" wide>
            {shift.required_tags.length > 0
              ? <span className="flex flex-wrap items-center gap-1"><Tag className="h-3 w-3" aria-hidden />{shift.required_tags.map((t) => <Badge key={t}>{t}</Badge>)}</span>
              : "None"}
          </Fact>
          {shift.note && <Fact label="Note" wide>{shift.note}</Fact>}
        </dl>
      </Card>

      {viewer && (
        <Card className="space-y-3 p-5" data-testid="open-shift-my-claim">
          <h2 className="text-base font-semibold">Your claim</h2>
          {shift.my_claim
            ? <p className="text-sm"><Badge tone={STATUS_LABEL[shift.my_claim.status].tone} dot>{STATUS_LABEL[shift.my_claim.status].label}</Badge></p>
            : <p className="text-sm text-muted-foreground">You have not claimed this shift.</p>}
          {!shift.can_claim && (shift.reasons ?? []).length > 0 && (
            <p className="text-sm text-muted-foreground">You can&apos;t take this shift: {(shift.reasons ?? []).map(reasonText).join(" · ")}.</p>
          )}
          {shift.can_claim && (shift.warnings ?? []).length > 0 && (
            <p className="text-sm text-warning">{(shift.warnings ?? []).map(reasonText).join(" · ")} — claiming confirms you understand.</p>
          )}
          {shift.can_claim && (
            <Button data-testid={`claim-${shift.id}`} onClick={() => claim(shift)}><Hand className="h-4 w-4" aria-hidden /> Claim shift</Button>
          )}
        </Card>
      )}

      {shift.claims && (
        <Card className="p-0" data-testid="open-shift-claims">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">Claims</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              In the order people claimed. Hours are each claimant&apos;s scheduled hours in the week of the shift, before and after it.
            </p>
          </div>
          <ClaimsTable claims={shift.claims} onChanged={onChanged} />
        </Card>
      )}
      {dialogs}
    </div>
  );
}

/**
 * `/attendance/open-shifts/{id}` (03-shifts/03 §12.3; 09-ui-ux/01 "Open shift · {date} · {shift}"): the facts, the
 * viewer's own claim with Claim (warnings and consent like the board), and — when the API returns them (planners and
 * approvers, §6.5) — the claims with their ranking inputs. Planners cancel. A non-numeric id renders NotFoundState
 * without a call; 403 / 404 render it too.
 */
export function OpenShiftDetail({ id, branches }: { id: string; branches?: { id: number; name: string }[] }) {
  const valid = isIdSegment(id);
  const { data, error, loading, reload } = useApi(() => (valid ? shiftRequestsApi.openShift(Number(id)) : Promise.resolve(null)), [id]);
  if (!valid) return <NotFoundState what="Open shift" backHref={BACK} backLabel={BACK_LABEL} />;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Open shift" backHref={BACK} backLabel={BACK_LABEL}>
      {data && <OpenShiftView shift={data} branches={branches} onChanged={() => void reload()} />}
    </DetailGate>
  );
}
