"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Globe2, Lock, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

import { ToggleRow } from "./fields";
import type { DomainRow } from "./types";

interface DomainList {
  domains: DomainRow[];
  custom_entitled: boolean;
  platform_base_domain: string | null;
  cname_target: string | null;
  tls_mode: "PROBE" | "SIMULATED";
}

const STATUS: Record<DomainRow["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  PENDING_DNS: { label: "Waiting for DNS", tone: "warning" },
  VERIFYING: { label: "Issuing certificate", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  DNS_BROKEN: { label: "DNS broken", tone: "danger" },
  DISABLED: { label: "Disabled", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
  REMOVED: { label: "Removed", tone: "neutral" },
};

export function DomainStatus({ status }: { status: DomainRow["status"] }) {
  const s = STATUS[status];
  return (
    <motion.span key={status} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
      <Badge tone={s.tone} dot data-status={status}>
        {s.label}
      </Badge>
    </motion.span>
  );
}

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(value).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs text-primary hover:bg-primary-soft"
      aria-label={`Copy ${value}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DnsRecords({ domain }: { domain: DomainRow }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {domain.records.map((r) => (
            <tr key={r.type + r.name} className="border-b border-border/60 last:border-0 align-top">
              <td className="px-3 py-2 font-semibold">{r.type}</td>
              <td className="px-3 py-2 font-mono break-all">
                {r.name} <CopyValue value={r.name} />
              </td>
              <td className="px-3 py-2 font-mono break-all">
                {r.value} <CopyValue value={r.value} />
                <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">{r.purpose}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DomainsPanel({ openWizard }: { openWizard?: boolean }) {
  const confirm = useConfirm();
  const [data, setData] = useState<DomainList | null>(null);
  const [wizard, setWizard] = useState(!!openWizard);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DomainList>("/domains"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: number, fn: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const primary = data.domains.find((d) => d.is_primary);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Addresses"
          description="Where your team signs in. Invitations and password-reset emails always use the primary address."
          action={
            <Button size="sm" onClick={() => setWizard(true)} disabled={!data.custom_entitled} data-testid="add-domain">
              {data.custom_entitled ? <Plus className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Add custom domain
            </Button>
          }
        />
        {!data.custom_entitled && (
          <p className="border-b border-border/70 px-5 py-3 text-xs text-muted-foreground">
            Custom domains are available on the Professional plan.
          </p>
        )}
        {data.tls_mode === "SIMULATED" && (
          <p className="border-b border-border/70 bg-warning-soft px-5 py-3 text-xs text-warning">
            Development mode: DNS records come from a local fixture and certificates are simulated. Custom domains are not
            verified against real DNS or TLS in this environment.
          </p>
        )}
        {data.domains.length === 0 ? (
          <EmptyState title="No addresses yet" description="Ask your platform administrator to enable company addresses." />
        ) : (
          <ul className="divide-y divide-border/70">
            {data.domains.map((d) => (
              <li key={d.id} className="space-y-3 px-5 py-4" data-domain={d.hostname}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <Globe2 className="h-4 w-4 text-muted-foreground" />
                      <span className="break-all">{d.unicode_hostname}</span>
                      {d.is_primary && (
                        <Badge tone="primary">
                          <Star className="mr-0.5 inline h-3 w-3" /> Primary
                        </Badge>
                      )}
                      <DomainStatus status={d.status} />
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {d.kind === "PLATFORM_SUBDOMAIN" ? "Platform address" : "Custom domain"}
                      {d.kind === "CUSTOM" && ` · TLS ${d.tls_status.toLowerCase()}${d.tls_mode === "SIMULATED" ? " (simulated)" : ""}`}
                      {d.last_checked_at && ` · checked ${fmtDateTime(d.last_checked_at)}`}
                    </p>
                    {d.last_error && <p className="mt-1 text-xs text-danger">{d.last_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.kind === "CUSTOM" && ["PENDING_DNS", "VERIFYING", "ACTIVE", "DNS_BROKEN"].includes(d.status) && (
                      <Button size="sm" variant="secondary" loading={busy === d.id}
                        onClick={() => act(d.id, () => api.post(`/domains/${d.id}/verify`), "Checked DNS and TLS")}>
                        <RefreshCw className="h-4 w-4" /> Check now
                      </Button>
                    )}
                    {!d.is_primary && d.status === "ACTIVE" && (
                      <Button size="sm" variant="secondary" loading={busy === d.id}
                        onClick={() => act(d.id, () => api.post(`/domains/${d.id}/primary`), `${d.hostname} is now the primary address`)}>
                        Make primary
                      </Button>
                    )}
                    {d.kind === "CUSTOM" && (
                      <Button size="sm" variant="danger-ghost" loading={busy === d.id}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove ${d.hostname}?`,
                            message: "Everyone signed in on this address is signed out. Adding it again needs fresh DNS verification.",
                            confirmLabel: "Remove domain",
                            tone: "danger",
                          });
                          if (ok) await act(d.id, () => api.delete(`/domains/${d.id}`), "Domain removed");
                        }}>
                        <Trash2 className="h-4 w-4" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
                {d.kind === "CUSTOM" && d.status !== "ACTIVE" && <DnsRecords domain={d} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {primary && (
        <Card>
          <CardHeader title="Primary address rules" description={`Applies to ${primary.unicode_hostname}.`} />
          <div className="space-y-3 p-5">
            <ToggleRow
              label="Redirect other addresses to the primary"
              hint="People who open another address of your workspace are sent to the primary one."
              checked={primary.redirect_to_primary}
              disabled={busy !== null}
              onChange={(v) => act(primary.id, () => api.patch(`/domains/${primary.id}`, { redirect_to_primary: v }), "Saved")}
            />
            {primary.kind === "CUSTOM" && (
              <ToggleRow
                label="Enforce the custom domain at sign-in"
                hint="Sign-ins on the platform address continue on your domain with a one-time, 60-second code."
                checked={primary.enforce_custom_domain}
                disabled={busy !== null}
                onChange={(v) => act(primary.id, () => api.patch(`/domains/${primary.id}`, { enforce_custom_domain: v }), "Saved")}
              />
            )}
          </div>
        </Card>
      )}

      <AddDomainWizard open={wizard} onClose={() => { setWizard(false); void load(); }} />
    </div>
  );
}

function AddDomainWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setHostname("");
      setError(null);
      setDomain(null);
    }
  }, [open]);

  // Step 3 polls the live status every 10 seconds.
  useEffect(() => {
    if (step !== 3 || !domain || domain.status === "ACTIVE" || domain.status === "FAILED") return;
    const timer = setInterval(async () => {
      try {
        setDomain(await api.post<DomainRow>(`/domains/${domain.id}/verify`));
      } catch {
        /* keep polling */
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [step, domain]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setDomain(await api.post<DomainRow>("/domains", { hostname }));
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    if (!domain) return;
    setBusy(true);
    try {
      setDomain(await api.post<DomainRow>(`/domains/${domain.id}/verify`));
      setStep(3);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Add a custom domain"
      description={`Step ${step} of 3 · ${step === 1 ? "Hostname" : step === 2 ? "DNS records" : "Status"}`}
      footer={
        step === 1 ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={add} loading={busy} disabled={hostname.trim().length < 3} data-testid="domain-continue">Continue</Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="secondary" onClick={onClose}>Finish later</Button>
            <Button onClick={check} loading={busy} data-testid="domain-check">I've added the records</Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )
      }
    >
      <ol className="mb-5 flex gap-2" aria-label="Progress">
        {[1, 2, 3].map((n) => (
          <li key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </ol>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
          {step === 1 && (
            <div className="space-y-3">
              <Field label="Hostname" error={error ?? undefined} hint="Use a subdomain such as hr.example.com. Apex domains need an ALIAS/ANAME record.">
                <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="hr.example.com" autoFocus data-testid="domain-hostname" />
              </Field>
            </div>
          )}
          {step === 2 && domain && (
            <div className="space-y-3">
              <p className="text-sm">Add these records at your DNS provider. Changes can take a few minutes (up to 72 hours) to appear.</p>
              <DnsRecords domain={domain} />
            </div>
          )}
          {step === 3 && domain && (
            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <span className="font-medium">{domain.unicode_hostname}</span> <DomainStatus status={domain.status} />
              </p>
              {domain.last_error && <p className="text-xs text-danger">{domain.last_error}</p>}
              {domain.status === "PENDING_DNS" && (
                <p className="text-muted-foreground">We check every few minutes for 72 hours. You can close this window.</p>
              )}
              {domain.status === "ACTIVE" && (
                <p className="text-success">The domain is active. Make it your primary address in the list.</p>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
