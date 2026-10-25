"use client";

import { Archive, Eraser, FileLock2, Gavel, Lock, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCan } from "@/components/access/Can";
import { KpiCard } from "@/components/payroll/KpiCard";
import { useEmployeeDirectory } from "@/components/payroll/inputs/shared";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, TabPanel, Tabs } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import {
  LocalStatusChip,
  Notice,
  PageSkeleton,
  WorkspaceHeader,
  errorText,
  formatDate,
  formatDateTime,
  useDirtyFlags,
  useEntities,
} from "../documents/shared";
import { holdsApi } from "./api";
import { ComplianceNav } from "./Nav";
import { ErasureModal, PlaceHoldModal, ReleaseHoldModal, SweepModal } from "./Modals";
import { DOC_TYPE_LABEL, SCOPE_LABEL, type LegalHold, type SweepRow } from "./types";

type StatusFilter = "ACTIVE" | "RELEASED" | "ALL";

const TRIGGER_LABEL: Record<string, string> = { JOB: "Daily job", MANUAL: "Run by a person", ERASURE: "Erasure request" };

export function HoldStatusChip({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return <LocalStatusChip vocabulary="legal_hold" code={status} label={active ? "Active" : "Released"} tone={active ? "warning" : "neutral"} />;
}

/** Payroll › Compliance › Legal holds & retention (EC-SEC-16, 3.6 document retention). */
export function LegalHoldsPage() {
  const { me } = useCan();
  const manage = can(me, P.PAYROLL_LEGAL_HOLD_MANAGE);
  const [tab, setTab] = useState("holds");
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [version, setVersion] = useState(0);
  const dirty = useDirtyFlags();
  const place = useModalRoute("place-hold", { keys: [], dirty: dirty.of("place") });
  const release = useModalRoute("release-hold", { dirty: dirty.of("release") });
  const sweepRoute = useModalRoute("retention-sweep", { keys: [] });
  const erasure = useModalRoute("erasure-request", { keys: [], dirty: dirty.of("erasure") });
  const summary = useApi(() => holdsApi.summary(), [version]);
  const changed = () => setVersion((v) => v + 1);
  const s = summary.data;

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Legal holds & retention"
        showHideAmounts={false}
        description={
          s
            ? `Payslips and registers are kept for the retention period your company set, and never deleted while a legal hold covers them · as of ${formatDate(s.as_of)}`
            : "Payslips and registers are kept for the retention period your company set, and never deleted while a legal hold covers them."
        }
        actions={
          manage ? (
            <>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => erasure.openModal()}>
                <Eraser className="h-4 w-4" aria-hidden /> Erasure request
              </Button>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => sweepRoute.openModal()}>
                <Trash2 className="h-4 w-4" aria-hidden /> Run sweep
              </Button>
              <Button className="min-h-[44px]" onClick={() => place.openModal()}>
                <Gavel className="h-4 w-4" aria-hidden /> Place hold
              </Button>
            </>
          ) : undefined
        }
      />
      <ComplianceNav active="holds" />
      <Notice title="Retention is your company's own policy">
        The retention period comes from your company&apos;s payroll retention setting; it is not a statement of what any country&apos;s law requires. Only the stored PDF of a payslip or register is ever deleted after it. Finalized payroll records are kept.
      </Notice>

      {summary.error && !s ? (
        <ErrorState message={errorText(summary.error)} onRetry={() => void summary.reload()} />
      ) : summary.loading && !s ? (
        <PageSkeleton />
      ) : (
        s && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Active holds" count={s.active_holds} icon={<Gavel className="h-4 w-4" />} tone="warning" />
            <KpiCard label="Documents under hold" count={s.documents_under_hold} icon={<Lock className="h-4 w-4" />} tone="info" />
            <KpiCard
              label="Due for deletion"
              count={s.documents_due_deletable}
              icon={<Trash2 className="h-4 w-4" />}
              tone={s.documents_due_deletable ? "danger" : "success"}
              hint={s.documents_due_held ? `${s.documents_due_held} more held back by legal holds` : "Past retention and under no hold"}
            />
            <KpiCard label="Files deleted so far" count={s.documents_redacted} icon={<Archive className="h-4 w-4" />} tone="primary" />
          </div>
        )
      )}

      <Tabs
        tabs={[
          { value: "holds", label: "Holds" },
          { value: "sweeps", label: "Retention sweeps" },
        ]}
        value={tab}
        onValueChange={setTab}
      >
        <TabPanel value="holds">
          <HoldsTable status={status} onStatus={setStatus} version={version} manage={manage} release={release} onPlace={() => place.openModal()} />
        </TabPanel>
        <TabPanel value="sweeps">
          <SweepsTable version={version} />
        </TabPanel>
      </Tabs>

      <PlaceHoldModal route={place} onDone={changed} onDirtyChange={dirty.set("place")} />
      <ReleaseHoldModal route={release} onDone={changed} onDirtyChange={dirty.set("release")} />
      <SweepModal route={sweepRoute} onDone={changed} />
      <ErasureModal route={erasure} onDone={changed} onDirtyChange={dirty.set("erasure")} />
    </div>
  );
}

/* ------------------------------------------------------------------ holds */

function HoldsTable({
  status,
  onStatus,
  version,
  manage,
  release,
  onPlace,
}: {
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  version: number;
  manage: boolean;
  release: { openModal: (p?: Record<string, string | number | null | undefined>) => void };
  onPlace: () => void;
}) {
  const { me } = useCan();
  const entities = useEntities();
  const employees = useEmployeeDirectory();
  const { data, error, loading, reload } = useApi(() => holdsApi.list({ status: status === "ALL" ? null : status, limit: 100 }), [status, version]);

  const target = (h: LegalHold): string => {
    switch (h.scope) {
      case "EMPLOYEE":
        return employees.name(h.employee_id);
      case "LEGAL_ENTITY":
        return entities.name(h.legal_entity_id);
      case "DOCUMENT_TYPE":
        return DOC_TYPE_LABEL[h.doc_type ?? ""] ?? h.doc_type ?? "—";
      default:
        return `Document #${h.document_id}`;
    }
  };
  const columns: Column<LegalHold>[] = [
    {
      key: "scope",
      header: "Covers",
      primary: true,
      cell: (h) => (
        <div>
          <p className="font-medium">{SCOPE_LABEL[h.scope]}</p>
          <p className="text-xs text-muted-foreground">{target(h)}</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (h) => (
        <div className="max-w-xs">
          <p className="line-clamp-2 break-words">{h.reason}</p>
          {h.reference && <p className="text-xs text-muted-foreground">Ref {h.reference}</p>}
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (h) => <HoldStatusChip status={h.status} /> },
    {
      key: "placed",
      header: "Placed",
      cell: (h) => (
        <div className="text-sm">
          <p>{formatDateTime(h.created_at)}</p>
          <p className="text-xs text-muted-foreground">{me?.user.id === h.created_by_user_id ? "by you" : `by user #${h.created_by_user_id}`}</p>
        </div>
      ),
    },
    {
      key: "covered",
      header: "Documents",
      hideOnMobile: true,
      cell: (h) => (h.status === "ACTIVE" ? <span className="tabular-nums">{h.documents_covered ?? "—"}</span> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      hideInCard: false,
      cell: (h) =>
        h.status === "ACTIVE" && manage ? (
          <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => release.openModal({ id: h.id })} aria-label={`Release hold ${h.id}`}>
            Release
          </Button>
        ) : h.status === "RELEASED" ? (
          <span className="text-xs text-muted-foreground">Released {formatDate(h.released_at)}</span>
        ) : null,
    },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Field label="Show">
          <Select className="min-h-[44px]" value={status} onChange={(e) => onStatus(e.target.value as StatusFilter)}>
            <option value="ACTIVE">Active holds</option>
            <option value="RELEASED">Released holds</option>
            <option value="ALL">All holds</option>
          </Select>
        </Field>
      </div>
      {error && !data ? (
        <ErrorState message={errorText(error)} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Legal holds"
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(h) => h.id}
          cardBelowMd
          empty={
            <EmptyState
              icon={<FileLock2 />}
              title={status === "RELEASED" ? "No released holds" : "No legal holds"}
              description="A hold keeps the covered documents from ever being deleted by retention, whatever their retention date."
              action={
                manage ? (
                  <Button className="min-h-[44px]" onClick={onPlace}>
                    Place a hold
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ sweeps */

function SweepsTable({ version }: { version: number }) {
  const { data, error, loading, reload } = useApi(() => holdsApi.sweeps(20), [version]);
  const columns: Column<SweepRow>[] = [
    { key: "at", header: "When", primary: true, cell: (r) => formatDateTime(r.at) },
    { key: "trigger", header: "Started by", cell: (r) => TRIGGER_LABEL[r.trigger ?? ""] ?? r.trigger ?? "—" },
    { key: "due", header: "Past retention", cell: (r) => <span className="tabular-nums">{r.due ?? "—"}</span> },
    { key: "held", header: "Held back", cell: (r) => <span className="tabular-nums">{r.held ?? "—"}</span> },
    { key: "redacted", header: "Files deleted", cell: (r) => <span className="font-medium tabular-nums">{r.redacted ?? "—"}</span> },
    { key: "remaining", header: "Still due", hideOnMobile: true, cell: (r) => <span className="tabular-nums">{r.remaining ?? "—"}</span> },
    { key: "not_due", header: "Not yet due", hideOnMobile: true, cell: (r) => <span className="tabular-nums">{r.not_due ?? "—"}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Recent sweeps" description="Counts only. The daily job runs once per company; people can also run it from this page." />
      {error && !data ? (
        <ErrorState message={errorText(error)} onRetry={() => void reload()} />
      ) : (
        <DataTable
          caption="Retention sweeps"
          columns={columns}
          rows={data?.items}
          loading={loading}
          rowKey={(r) => `${r.at}-${r.action}-${r.trigger}`}
          cardBelowMd
          empty={<EmptyState icon={<Archive />} title="No sweeps yet" description="The first sweep runs overnight, or run one now." />}
        />
      )}
    </Card>
  );
}
