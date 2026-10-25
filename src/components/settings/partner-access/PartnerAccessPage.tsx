"use client";

import { History, Plus, ShieldCheck, Undo2, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { ErrorSummary, Notice, PayrollPage, ReasonModal } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { partnerAccessApi } from "./api";
import { GrantModal } from "./GrantModal";
import type { ActivityItem, Delegation, DelegationStatus } from "./types";

const STATUS: Record<DelegationStatus, { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  PENDING: { label: "Starts later", tone: "info" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REVOKED: { label: "Revoked", tone: "danger" },
};

export function PartnerAccessPage() {
  return (
    <PayrollPage>
      <PartnerAccess />
    </PayrollPage>
  );
}

function PartnerAccess() {
  const { data, error, loading, reload } = useApi(() => partnerAccessApi.overview(), []);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<Delegation | null>(null);
  const [viewing, setViewing] = useState<Delegation | null>(null);

  const partner = data?.partner ?? null;
  const canGrant = !!partner && partner.status === "active";

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Partner access"
        description="Your partner never sees your people or payroll data on its own. Share read-only access for a short time, and end it whenever you like."
        actions={
          <Button className="min-h-[44px]" disabled={!canGrant || loading} onClick={() => setGranting(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Grant access
          </Button>
        }
      />
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data ? (
        <div className="space-y-4">
          <Notice title="What a delegation can and cannot do">
            Read-only, at most {data.max_days} days, and every request your partner makes is written to your audit log. Payments, approvals,
            finalizing payroll, full bank numbers and changes to users or roles can never be shared.
          </Notice>
          {!partner && (
            <Notice tone="warning" title="This workspace has no partner">
              There is nobody to share access with. Your platform administrator links a partner to your company.
            </Notice>
          )}
          {partner && partner.status !== "active" && (
            <Notice tone="warning" title={`${partner.name} is not active`}>
              New access can&apos;t be granted until the partner is active again.
            </Notice>
          )}
          {data.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Users />}
                title="No partner access granted"
                description={partner ? `${partner.name} cannot see any of your data right now.` : "Nothing is shared with anyone."}
                action={canGrant ? <Button className="min-h-[44px]" onClick={() => setGranting(true)}>Grant access</Button> : undefined}
              />
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="Delegations">
              {data.items.map((row) => (
                <DelegationCard key={row.id} row={row} onRevoke={() => setRevoking(row)} onActivity={() => setViewing(row)} />
              ))}
            </ul>
          )}
          <GrantModal
            open={granting}
            onOpenChange={setGranting}
            overview={data}
            onGranted={() => {
              toast.success("Access granted");
              void reload();
            }}
          />
        </div>
      ) : null}
      <ReasonModal
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="End partner access"
        danger
        confirmLabel="End access now"
        consequence={`${revoking?.partner_name ?? "The partner"} loses access on its very next request. This can't be undone; you would grant a new access instead.`}
        reasonLabel="Why are you ending it?"
        onSubmit={async (reason) => {
          if (!revoking) return;
          await partnerAccessApi.revoke(revoking.id, reason);
          toast.success("Access ended");
          setRevoking(null);
          await reload();
        }}
      />
      <ActivitySheet row={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function DelegationCard({ row, onRevoke, onActivity }: { row: Delegation; onRevoke: () => void; onActivity: () => void }) {
  const status = STATUS[row.status];
  const open = row.status === "ACTIVE" || row.status === "PENDING";
  const limits = [...row.legal_entities.map((e) => e.name ?? `Entity #${e.id}`), ...row.pay_groups.map((g) => g.name ?? `Pay group #${g.id}`)];
  return (
    <li>
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{row.partner_name ?? "Partner"}</h2>
              <Badge tone={status.tone} dot>{status.label}</Badge>
              <Badge tone="primary">
                <ShieldCheck className="me-1 h-3 w-3" aria-hidden />
                Read only
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmtDateTime(row.starts_at)} to {fmtDateTime(row.expires_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-[44px]" onClick={onActivity} aria-label={`Activity of access ${row.id}`}>
              <History className="h-4 w-4" aria-hidden /> Activity
            </Button>
            {open && (
              <Button variant="secondary" className="min-h-[44px] text-danger" onClick={onRevoke} aria-label={`End access ${row.id}`}>
                <Undo2 className="h-4 w-4" aria-hidden /> End access
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm">{row.reason}</p>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Can read</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Shared permissions">
            {row.permissions.map((p) => (
              <li key={p.code}>
                <Badge>{p.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
          {row.narrowed ? `Limited to ${limits.join(", ")}` : "Whole company"}
          {" · "}
          Granted by {row.granted_by.name ?? "an administrator"} on {fmtDateTime(row.granted_at)}
        </p>
        {row.status === "REVOKED" && (
          <p className="text-sm text-muted-foreground">
            Ended by {row.revoked_by?.name ?? "an administrator"} on {fmtDateTime(row.revoked_at)}: {row.revoke_reason}
          </p>
        )}
      </Card>
    </li>
  );
}

const ACTIVITY_LABEL: Record<string, { label: string; tone: "neutral" | "info" | "warning" }> = {
  DELEGATED_REQUEST: { label: "Read", tone: "neutral" },
  DELEGATION_TOKEN_ISSUED: { label: "Opened workspace", tone: "info" },
};

function ActivitySheet({ row, onClose }: { row: Delegation | null; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<ActivityItem[]>(() => partnerAccessApi.activity(row!.id), [row?.id], { enabled: !!row });
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()} title="What the partner did" description="Every request made under this access, newest first.">
      {error ? (
        <div className="space-y-3">
          <ErrorSummary error={error} />
          <Button variant="secondary" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <Skeleton className="h-32 w-full" />
      ) : data && data.length ? (
        <ol className="space-y-2" aria-label="Partner activity">
          {data.map((item) => {
            const kind = ACTIVITY_LABEL[item.action] ?? { label: "Refused", tone: "warning" as const };
            return (
              <li key={item.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-medium">{item.method && item.path ? `${item.method} ${item.path}` : item.description}</span>
                  <Badge tone={kind.tone}>{kind.label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(item.at)} · {item.operator_email}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState title="Nothing yet" description="The partner has not used this access." />
      )}
    </Sheet>
  );
}
