"use client";

import { motion } from "framer-motion";
import { Archive, CheckCircle2, Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { PolicyCard as SharedPolicyCard, type PolicyAction } from "@/components/payroll/PolicyCard";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import type { PolicyTypeMeta } from "@/lib/settings.generated";

import { summarizeFields } from "./policyFields";
import { ActivateModal, AssignmentRulesModal, PolicyModal } from "./PolicyModals";
import { policiesApi } from "./settingsApi";
import type { PolicyRow, ScopeOptions } from "./types";

/**
 * One policy on a settings page (3.8 §5.16) on the shared PolicyCard: name · version · effective
 * date · coverage, a one-line summary of the active version, and the actions this user may take.
 * The API returns rule counts, not head counts, so coverage is shown as rules.
 */
export function PolicyCard({
  policy,
  type,
  canWrite,
  onEdit,
  onActivate,
  onRules,
  onArchive,
  index = 0,
}: {
  policy: PolicyRow;
  type: PolicyTypeMeta;
  canWrite: boolean;
  onEdit: () => void;
  onActivate: (version: number) => void;
  onRules: () => void;
  onArchive: () => void;
  index?: number;
}) {
  const active = policy.active_version;
  const drafts = [...policy.draft_versions].sort((a, b) => b - a);
  const summary = summarizeFields(type.fields, active?.fields);
  const actions: PolicyAction[] = canWrite
    ? [
        { label: drafts.length ? `Edit draft v${drafts[0]}` : "Edit (new draft version)", onSelect: onEdit, icon: <Pencil /> },
        ...(drafts.length ? [{ label: `Activate v${drafts[0]}…`, onSelect: () => onActivate(drafts[0]), icon: <CheckCircle2 /> }] : []),
        ...(type.assignable ? [{ label: "Assignment rules…", onSelect: onRules, icon: <Users /> }] : []),
        { label: "Archive", onSelect: onArchive, tone: "danger" as const, icon: <Archive /> },
      ]
    : [];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.04 }}
      data-policy={policy.id}
    >
      <SharedPolicyCard
        name={policy.name}
        version={active?.version ?? policy.latest_version ?? "—"}
        status={active ? active.status : drafts.length ? "DRAFT" : null}
        effectiveFrom={active?.effective_from ?? null}
        population={type.assignable ? (policy.rule_count === 0 ? "not assigned" : `${policy.rule_count} rule${policy.rule_count === 1 ? "" : "s"}`) : undefined}
        summary={summary || (active ? "Defaults" : "Not active: it changes nobody's pay yet.")}
        actions={actions}
      >
        {drafts.length > 0 && active ? (
          <p className="text-xs text-muted-foreground">
            Draft v{drafts[0]} is waiting to be activated; v{active.version} stays in force until then.
          </p>
        ) : undefined}
      </SharedPolicyCard>
    </motion.div>
  );
}

/** Policies of one type with "Add policy", edit, activate, rules and archive. */
export function PolicyList({
  type,
  canWrite,
  scopeOptions,
}: {
  type: PolicyTypeMeta;
  canWrite: boolean;
  scopeOptions: ScopeOptions;
}) {
  const policyModal = useModalRoute("policy", { keys: ["type", "policy"] });
  const rulesModal = useModalRoute("rules", { keys: ["policy"] });
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(() => policiesApi.list(type.code), [type.code]);
  const [activating, setActivating] = useState<{ policy: PolicyRow; version: number } | null>(null);
  const policyParam = Number(policyModal.param("policy")) || null;
  const policyOpen = policyModal.open && policyModal.param("type") === type.code;
  const rulesId = Number(rulesModal.param("policy")) || null;
  const rulesPolicy = rulesModal.open ? (data ?? []).find((p) => p.id === rulesId) ?? null : null;

  const archive = async (policy: PolicyRow) => {
    const ok = await confirm({
      title: `Archive ${policy.name}?`,
      message: "Archived policies stop applying from today and can't be activated again. Finalized runs keep the version they used.",
      confirmLabel: "Archive",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await policiesApi.archive(policy.id);
      toast.success(`${policy.name} archived`);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Archiving failed");
    }
  };

  return (
    <section aria-labelledby={`policies-${type.code}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={`policies-${type.code}`} className="text-[15px] font-semibold">
            {type.label}
          </h3>
          <p className="text-xs text-muted-foreground">
            {type.grain === "PERIOD" ? "Resolved once per pay period." : "Resolved day by day."}
            {type.assignable ? " The highest-priority matching rule decides who gets which policy." : ""}
          </p>
        </div>
        {canWrite && (
          <Button size="sm" className="h-10" onClick={() => policyModal.openModal({ type: type.code })}>
            <Plus className="h-4 w-4" /> Add policy
          </Button>
        )}
      </div>
      <div aria-busy={loading || undefined}>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : !data ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border">
            <EmptyState title="No policies yet" description={`Add a ${type.label.toLowerCase()} to describe how this works for your people.`} />
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((policy, index) => (
              <PolicyCard
                key={policy.id}
                index={index}
                policy={policy}
                type={type}
                canWrite={canWrite}
                onEdit={() => policyModal.openModal({ type: type.code, policy: policy.id })}
                onActivate={(version) => setActivating({ policy, version })}
                onRules={() => rulesModal.openModal({ policy: policy.id })}
                onArchive={() => void archive(policy)}
              />
            ))}
          </div>
        )}
      </div>
      {canWrite && (
        <>
          <PolicyModal
            open={policyOpen}
            onClose={() => void policyModal.close()}
            type={type}
            policyId={policyOpen ? policyParam : null}
            onSaved={() => void reload()}
          />
          <ActivateModal
            open={!!activating}
            onClose={() => setActivating(null)}
            policy={activating?.policy ?? null}
            version={activating?.version ?? null}
            type={type}
            onDone={() => void reload()}
          />
          <AssignmentRulesModal
            open={!!rulesPolicy}
            onClose={() => void rulesModal.close()}
            policy={rulesPolicy}
            scopeOptions={scopeOptions}
            onSaved={() => void reload()}
          />
        </>
      )}
    </section>
  );
}
