"use client";

import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { platformCall } from "@/lib/platform";

export interface PartnerDelegation {
  id: number;
  company: { id: number; name: string; slug: string };
  permissions: { code: string; label: string }[];
  narrowed: boolean;
  read_only: true;
  legal_entity_count: number;
  pay_group_count: number;
  starts_at: string;
  expires_at: string;
  reason: string;
}

export interface OpenedSession {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  delegation_expires_at: string;
  read_only: true;
  company: { id: number; name: string; slug: string };
  permissions: string[];
}

const call = <T,>(fn: () => Promise<T>) => platformCall(fn);

/**
 * Partner console, "Delegated access": the client companies that currently grant this partner read-only access
 * (names, permissions and expiry only: no HR data). Opening one issues a 10-minute bearer token for the
 * company's API; the company can end the access at any moment and the next request is refused.
 */
export function PartnerDelegations() {
  const [items, setItems] = useState<PartnerDelegation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [session, setSession] = useState<OpenedSession | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await call(() => api.get<{ items: PartnerDelegation[] }>("/partner/delegations"))).items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const open = async (row: PartnerDelegation) => {
    setOpening(row.id);
    try {
      setSession(await call(() => api.post<OpenedSession>(`/partner/delegations/${row.id}/token`)));
    } catch (e) {
      toast.error(errorMessage(e));
      void load(); // the access may just have ended
    } finally {
      setOpening(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Companies below currently share read-only access with you. It ends when they end it or when the time is up. Everything you read is recorded in their audit log.
      </p>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<KeyRound />} title="No delegated access right now" description="A client company grants access from its own Settings, Partner access page." />
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Delegated access">
          {items.map((row) => (
            <li key={row.id}>
              <Card className="space-y-2 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{row.company.name}</h3>
                      <Badge tone="primary">
                        <ShieldCheck className="me-1 h-3 w-3" aria-hidden />
                        Read only
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Until {fmtDateTime(row.expires_at)}</p>
                  </div>
                  <Button className="min-h-[44px]" loading={opening === row.id} onClick={() => open(row)} aria-label={`Open ${row.company.name}`}>
                    <KeyRound className="h-4 w-4" aria-hidden /> Open workspace
                  </Button>
                </div>
                <p className="text-sm">{row.reason}</p>
                <ul className="flex flex-wrap gap-1.5" aria-label={`Permissions for ${row.company.name}`}>
                  {row.permissions.map((p) => (
                    <li key={p.code}>
                      <Badge>{p.label}</Badge>
                    </li>
                  ))}
                </ul>
                {row.narrowed && (
                  <p className="text-xs text-muted-foreground">
                    Limited to {row.legal_entity_count} legal {row.legal_entity_count === 1 ? "entity" : "entities"} and {row.pay_group_count} pay {row.pay_group_count === 1 ? "group" : "groups"}.
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!session}
        onOpenChange={(o) => !o && setSession(null)}
        title={session ? `${session.company.name}: read-only session` : "Read-only session"}
        description="Send this token as Authorization: Bearer to the company's API. It works for a few minutes and only while the company's access is current."
        footer={<Button className="min-h-[44px]" onClick={() => setSession(null)}>Done</Button>}
      >
        {session && (
          <div className="space-y-3">
            <p className="text-sm">Expires {fmtDateTime(session.expires_at)} (access ends {fmtDateTime(session.delegation_expires_at)}). Read-only: changes are refused.</p>
            <Textarea readOnly rows={5} aria-label="Access token" value={session.access_token} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(session.access_token);
                  toast.success("Token copied");
                } catch {
                  toast.error("Copy failed. Select the token and copy it.");
                }
              }}
            >
              <Copy className="h-4 w-4" aria-hidden /> Copy token
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
