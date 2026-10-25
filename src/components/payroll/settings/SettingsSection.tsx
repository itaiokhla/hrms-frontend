"use client";

import { motion } from "framer-motion";
import { GitBranch, History, Hourglass, Scale, Table2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can, companyWide } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";
import type { SettingDefinition, SettingSection } from "@/lib/settings.generated";

import { InheritanceSheet } from "./InheritanceSheet";
import {
  LEVEL_LABELS,
  definitionOf,
  describeSaveError,
  formatValue,
  fromDraft,
  groupDefinitions,
  isVisible,
  issuesByKey,
  localTodayISO,
  policyTypeOf,
  sameValue,
  sectionDefinitions,
  sectionLevels,
  toDraft,
  type DraftValue,
  type SaveProblem,
} from "./model";
import { PolicyList } from "./PolicyList";
import { ConflictBanner, IssueSummary, SaveBar } from "./SaveBar";
import { SettingsScopeBar, optionsFor, useScopeOptions } from "./scopeOptions";
import { SettingControl } from "./SettingControl";
import { settingsApi } from "./settingsApi";
import type { EditableScope, SaveChangeResult, ScopeRef, SettingChangeIn, SettingValueItem } from "./types";

const SCOPES: EditableScope[] = ["TENANT", "LEGAL_ENTITY", "BRANCH", "PAY_GROUP"];
const CHANGE_APPROVAL_KEY = "settings.change_approval.enabled";

function levelList(levels: string[]): string {
  const names = levels.map((l) => (LEVEL_LABELS[l] ?? l).toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "no level";
}

/** Read the scope from `?scope=LEGAL_ENTITY&id=3` (bookmarkable); unknown or forbidden targets fall back. */
function useScopeParam(): [ScopeRef, (scope: ScopeRef) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("scope");
  const type = (SCOPES as string[]).includes(raw ?? "") ? (raw as EditableScope) : "TENANT";
  const id = Number(params.get("id")) || null;
  const scope: ScopeRef = type === "TENANT" || !id ? { scope_type: "TENANT", scope_id: null, name: "Company" } : { scope_type: type, scope_id: id };
  const set = useCallback(
    (next: ScopeRef) => {
      const query = new URLSearchParams(params.toString());
      query.delete("scope");
      query.delete("id");
      if (next.scope_type !== "TENANT" && next.scope_id) {
        query.set("scope", next.scope_type);
        query.set("id", String(next.scope_id));
      }
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [scope, set];
}

/**
 * Settings › Payroll › {section} (3.8 §5.16): scope bar, typed controls with inheritance badges,
 * switch cards, policies, the inheritance sheet and a sticky save bar. Saves send every changed
 * key with its row version and one Idempotency-Key; conflicts and V-01…V-16 issues are shown inline.
 */
export function SettingsSection({ section }: { section: SettingSection }) {
  const { me } = useCan();
  const defs = useMemo(() => sectionDefinitions(section.slug), [section.slug]);
  const levels = useMemo(() => sectionLevels(defs), [defs]);
  const policyTypes = section.policyTypes.map(policyTypeOf).filter((t): t is NonNullable<typeof t> => !!t);
  const options = useScopeOptions(me);
  const [requestedScope, setScope] = useScopeParam();
  const inheritance = useModalRoute("inheritance", { keys: ["key"] });
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const today = localTodayISO();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  // The row version each edited key had when the person started editing it (EC-UX-04). Values are re-read when the
  // effective date changes; saving with the re-read version would silently overwrite a change someone else made in
  // the meantime, so the save carries the version the edit was based on and the API answers 409 if it moved.
  const [bases, setBases] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [results, setResults] = useState<SaveChangeResult[]>([]);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  // A scope the user can't open falls back to the company level (the API would answer 404).
  const known = requestedScope.scope_type === "TENANT" || optionsFor(options, requestedScope.scope_type).some((o) => o.id === requestedScope.scope_id);
  const scope: ScopeRef = known || options.loading ? requestedScope : { scope_type: "TENANT", scope_id: null, name: "Company" };
  const scopeName =
    scope.scope_type === "TENANT" ? "Company" : optionsFor(options, scope.scope_type).find((o) => o.id === scope.scope_id)?.name ?? scope.name;
  const scopeRef: ScopeRef = { ...scope, name: scopeName ?? undefined };

  const values = useApi(() => settingsApi.values(scope, effectiveFrom), [scope.scope_type, scope.scope_id, effectiveFrom], {
    enabled: defs.length > 0 && !!me,
  });
  // Never show another scope's values under this header while the new scope loads (audit 05 §18.14).
  const fresh =
    values.data && values.data.scope.scope_type === scope.scope_type && (values.data.scope.scope_id ?? null) === (scope.scope_id ?? null)
      ? values.data
      : undefined;
  const items = useMemo(() => new Map<string, SettingValueItem>((fresh?.items ?? []).map((i) => [i.key, i])), [fresh]);

  useEffect(() => {
    setDrafts({});
    setLocks({});
    setBases({});
    setErrors({});
    setProblem(null);
    setResults([]);
  }, [scope.scope_type, scope.scope_id, section.slug]);

  const rememberBase = (key: string) => {
    const version = items.get(key)?.row_version;
    if (version === undefined) return;
    setBases((b) => (key in b ? b : { ...b, [key]: version }));
  };

  const draftOf = (def: SettingDefinition): DraftValue => (def.key in drafts ? drafts[def.key] : toDraft(def, items.get(def.key)?.value));
  const lockedOf = (key: string): boolean => (key in locks ? locks[key] : items.get(key)?.here?.locked ?? false);

  const valueOf = (key: string): unknown => {
    const def = definitionOf(key);
    if (def && key in drafts) {
      const parsed = fromDraft(def, drafts[key]);
      if (parsed.ok) return parsed.value;
    }
    return items.get(key)?.value;
  };

  const visibleDefs = defs.filter((d) => isVisible(d, valueOf, fresh?.profile_version ?? null));
  const dirtyKeys = visibleDefs
    .filter((def) => {
      const item = items.get(def.key);
      if (!item) return false;
      const lockChanged = def.key in locks && locks[def.key] !== (item.here?.locked ?? false);
      if (!(def.key in drafts)) return lockChanged;
      const parsed = fromDraft(def, drafts[def.key]);
      return lockChanged || !parsed.ok || !sameValue(parsed.value, item.value);
    })
    .map((d) => d.key);

  // Deep links such as the setup checklist's `#setting-payroll-overtime-enabled` land once values render.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!fresh || scrolled.current || typeof window === "undefined" || !window.location.hash) return;
    scrolled.current = true;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    target?.scrollIntoView?.({ block: "center" });
    target?.querySelector<HTMLElement>("input, select, textarea, button[role=switch]")?.focus({ preventScroll: true });
  }, [fresh]);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirtyKeys.length > 0;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const canWriteAny = can(me, P.PAYROLL_CONFIGURATION_WRITE);
  const canWriteHere = canWriteAny && (scope.scope_type !== "TENANT" || companyWide(me, P.PAYROLL_CONFIGURATION_WRITE));
  const canWritePolicies = can(me, P.PAYROLL_CONFIGURATION_WRITE, "COMPANY");

  const readOnlyReason = (def: SettingDefinition, item: SettingValueItem | undefined): string | null => {
    if (!item) return null;
    if (def.ui.locked === true || (def.constraints as Record<string, unknown>).const !== undefined) return "This safeguard is always on.";
    if (item.badge?.code === "REQUIRED_BY_LAW") return null;
    if (item.badge?.code === "LOCKED") return "It can't be overridden at this level.";
    if (!item.editable) return `Set at the ${levelList(def.allowedLevels as string[])} level.`;
    if (item.pending) return "A change of this setting here is waiting for approval.";
    if (!canWriteAny) return "You can view this setting but not change it.";
    if (!canWriteHere) return "Company-level payroll settings need company-wide payroll configuration access.";
    if (def.module !== "Payroll" && !can(me, P.SETTINGS_MANAGE)) return "Changing this also needs the company settings permission.";
    if (def.adminOnly && !me?.is_company_admin) return "Only Company Administrators can change this.";
    return null;
  };
  const editable = (def: SettingDefinition, item: SettingValueItem | undefined) =>
    !!item && readOnlyReason(def, item) === null && item.badge?.code !== "REQUIRED_BY_LAW";

  const discard = () => {
    setDrafts({});
    setLocks({});
    setBases({});
    setErrors({});
    setProblem(null);
  };

  const reload = () => {
    discard();
    void values.reload();
  };

  const save = async () => {
    if (!fresh || dirtyKeys.length === 0) return;
    const clientErrors: Record<string, string[]> = {};
    const changes: SettingChangeIn[] = [];
    for (const key of dirtyKeys) {
      const def = definitionOf(key)!;
      const item = items.get(key)!;
      const parsed = key in drafts ? fromDraft(def, drafts[key]) : { ok: true as const, value: item.here?.value ?? item.value };
      if (!parsed.ok) {
        clientErrors[key] = [parsed.error];
        continue;
      }
      const lockChanged = key in locks && locks[key] !== (item.here?.locked ?? false);
      changes.push({
        key,
        scope_type: scope.scope_type,
        scope_id: scope.scope_type === "TENANT" ? null : scope.scope_id,
        value: parsed.value,
        row_version: key in bases ? bases[key] : item.row_version,
        ...(def.effectiveDated ? { effective_from: effectiveFrom } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(lockChanged ? { locked: locks[key] } : {}),
      });
    }
    setProblem(null);
    setResults([]);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      summaryRef.current?.focus();
      return;
    }
    if (effectiveFrom < today && changes.some((c) => c.effective_from) && !reason.trim()) {
      setErrors({});
      setProblem({ kind: "reason", message: "A reason is required for a change effective in the past." });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await settingsApi.save(changes, newIdempotencyKey());
      const pending = result.changes.filter((c) => c.status === "PENDING_APPROVAL").length;
      const applied = result.changes.filter((c) => c.status === "ACTIVE").length;
      toast.success(
        pending && applied
          ? `${applied} saved · ${pending} waiting for approval`
          : pending
            ? `Sent for approval: ${pending} change${pending === 1 ? "" : "s"}`
            : "Settings saved",
      );
      setResults(result.changes.filter((c) => c.status !== "UNCHANGED"));
      setDrafts({});
      setLocks({});
      setBases({});
      setReason("");
      if (result.warnings.length) setProblem({ kind: "invalid", message: "Saved with warnings.", issues: result.warnings });
      void values.reload();
    } catch (error) {
      const found = describeSaveError(error, changes.map((c) => c.key));
      setProblem(found);
      if (found.kind === "field") setErrors({ [found.key]: [found.message] });
      if (found.kind === "invalid") {
        const byKey = issuesByKey(found.issues.filter((i) => i.severity !== "WARNING"));
        setErrors(Object.fromEntries(Object.entries(byKey).map(([k, list]) => [k, list.map((i) => i.message)])));
      }
      summaryRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const configIssues = fresh?.issues ?? [];
  const keyIssues = issuesByKey([...configIssues, ...visibleDefs.flatMap((d) => items.get(d.key)?.issues ?? [])]);
  const sectionKeys = new Set<string>(defs.map((d) => d.key));
  const summary = [
    ...Object.entries(errors).flatMap(([key, list]) => list.map((message) => ({ key, message }))),
    ...(problem?.kind === "other" || problem?.kind === "reason" ? [{ key: null, message: problem.message }] : []),
    ...(problem?.kind === "invalid"
      ? problem.issues.filter((i) => i.severity === "WARNING").map((i) => ({ key: i.keys?.find((k) => sectionKeys.has(k)) ?? null, message: i.message, severity: i.severity, rule: i.rule }))
      : []),
    ...configIssues
      .filter((i) => i.keys?.some((k) => sectionKeys.has(k)))
      .map((i) => ({ key: i.keys.find((k) => sectionKeys.has(k)) ?? null, message: i.message, severity: i.severity, rule: i.rule })),
  ];
  const conflict = problem?.kind === "conflict" ? problem : null;
  const conflictDef = conflict?.key ? definitionOf(conflict.key) : undefined;
  const changeApproval = items.get(CHANGE_APPROVAL_KEY)?.value === true;
  const grains = dirtyKeys.map((k) => definitionOf(k)?.resolutionGrain ?? "PERIOD");
  const anyDated = dirtyKeys.length === 0 || dirtyKeys.some((k) => definitionOf(k)?.effectiveDated);

  return (
    <div>
      <PageHeader eyebrow="Settings › Payroll" title={section.title} description="Choose the level you're editing. Lower levels inherit what you set here unless they override it." />
      {defs.length > 0 && (
        <SettingsScopeBar
          value={scopeRef}
          onChange={setScope}
          levels={levels}
          options={options}
          actions={
            <>
              <Button variant="secondary" className="h-10" onClick={() => {
                  setSheetKey(null);
                  inheritance.openModal({ key: defs[0]?.key });
                }}>
                <GitBranch className="h-4 w-4" /> Inheritance
              </Button>
              {can(me, P.AUDIT_READ) && (
                <Link
                  href="/audit-logs"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium shadow-sm hover:bg-surface-muted"
                >
                  <History className="h-4 w-4" aria-hidden /> History
                </Link>
              )}
            </>
          }
        />
      )}

      <div className="mt-5 space-y-5">
        {changeApproval && (
          <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-foreground">
            <Hourglass className="h-4 w-4" aria-hidden />
            Approval of settings changes is on: changes to protected settings wait for a second administrator.
            <Link href="/settings/payroll/change-requests" className="font-medium underline underline-offset-2">
              See change requests
            </Link>
          </p>
        )}
        <div ref={summaryRef} tabIndex={-1} className="space-y-3 outline-none">
          <ConflictBanner
            open={!!conflict}
            message={conflict?.message ?? ""}
            label={conflictDef?.label ?? null}
            theirs={conflict?.current ? formatValue(conflictDef, conflict.current.value) : null}
            yours={conflict?.key && conflictDef ? (() => { const p = fromDraft(conflictDef, draftOf(conflictDef)); return p.ok ? formatValue(conflictDef, p.value) : null; })() : null}
            onReload={reload}
            onDismiss={() => setProblem(null)}
          />
          <IssueSummary issues={summary} labelOf={(key) => definitionOf(key)?.label ?? key} />
          {results.length > 0 && (
            <div role="status" className="rounded-2xl border border-success/40 bg-success-soft/50 px-4 py-3 text-sm text-foreground">
              <p className="font-semibold">Saved</p>
              <ul className="mt-1 space-y-0.5">
                {results.map((r) => (
                  <li key={r.key}>
                    <span className="font-medium">{definitionOf(r.key)?.label ?? r.key}:</span> {r.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {defs.length === 0 && policyTypes.length === 0 ? (
          <EmptySection slug={section.slug} />
        ) : defs.length > 0 && values.error && !fresh ? (
          <Card>
            <ErrorState message={values.error.message} onRetry={values.reload} />
          </Card>
        ) : defs.length > 0 && !fresh ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {groupDefinitions(visibleDefs).map(({ group, defs: groupDefs }, gi) => (
              <motion.section
                key={group ?? `g${gi}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(gi, 6) * 0.04 }}
                aria-label={group ?? section.title}
                className="space-y-3"
              >
                {group && <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group}</h2>}
                {groupDefs.map((def) => {
                  const item = items.get(def.key);
                  const issues = keyIssues[def.key] ?? [];
                  return (
                    <SettingControl
                      key={def.key}
                      def={def}
                      item={item}
                      draft={draftOf(def)}
                      onDraft={(v) => {
                        rememberBase(def.key);
                        setDrafts((d) => ({ ...d, [def.key]: v }));
                        setErrors((e) => {
                          if (!(def.key in e)) return e;
                          const next = { ...e };
                          delete next[def.key];
                          return next;
                        });
                      }}
                      dirty={dirtyKeys.includes(def.key)}
                      locked={lockedOf(def.key)}
                      onLocked={(v) => {
                        rememberBase(def.key);
                        setLocks((l) => ({ ...l, [def.key]: v }));
                      }}
                      canLock={scope.scope_type !== "PAY_GROUP"}
                      canEdit={editable(def, item)}
                      readOnlyReason={readOnlyReason(def, item)}
                      errors={[...(errors[def.key] ?? []), ...issues.filter((i) => i.severity === "ERROR" && !(errors[def.key] ?? []).includes(i.message)).map((i) => i.message)]}
                      warnings={issues.filter((i) => i.severity === "WARNING").map((i) => i.message)}
                      onExplain={(key) => {
                        setSheetKey(null);
                        inheritance.openModal({ key });
                      }}
                    />
                  );
                })}
              </motion.section>
            ))}
          </div>
        )}

        {policyTypes.length > 0 && (
          <Card className="space-y-6 p-4 sm:p-5">
            <div>
              <h2 className="text-[15px] font-semibold">Policies</h2>
              <p className="text-sm text-muted-foreground">
                Policies hold the detailed rules. They are company-wide and assigned to people by rules; drafts change nobody&apos;s pay until activated.
              </p>
            </div>
            {policyTypes.map((type) => (
              <PolicyList key={type.code} type={type} canWrite={canWritePolicies} scopeOptions={options} />
            ))}
          </Card>
        )}

        {defs.length > 0 && fresh && (
          <SaveBar
            dirtyCount={dirtyKeys.length}
            grains={grains}
            effectiveFrom={effectiveFrom}
            onEffectiveFrom={setEffectiveFrom}
            today={today}
            reason={reason}
            onReason={setReason}
            reasonError={problem?.kind === "reason" ? problem.message : null}
            saving={saving}
            canSave={canWriteAny}
            onSave={() => void save()}
            onDiscard={discard}
            effectiveDated={anyDated}
          />
        )}
      </div>

      {defs.length > 0 && (
        <InheritanceSheet
          open={inheritance.open}
          onOpenChange={inheritance.onOpenChange}
          settingKey={sheetKey ?? inheritance.param("key")}
          onKeyChange={setSheetKey}
          keys={defs}
          scope={scopeRef}
          asOf={effectiveFrom}
        />
      )}
    </div>
  );
}

function EmptySection({ slug }: { slug: string }) {
  const { me } = useCan();
  if (slug === "statutory") {
    return (
      <Card>
        <EmptyState
          icon={<Scale />}
          title="Statutory schemes follow the country pack"
          description="Contributions and taxes are calculated only from a verified country pack for each legal entity; nothing here switches them on. Each entity's capability is shown under Compliance."
          action={
            can(me, P.PAYROLL_STATUTORY_REVIEW) ? (
              <Link href="/payroll/compliance" className="text-sm font-medium text-primary underline underline-offset-2">
                Open Compliance
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        icon={<Table2 />}
        title={slug === "tables" ? "Lookup tables arrive with salary components" : "Nothing to configure here yet"}
        description={
          slug === "tables"
            ? "Formula lookup tables (slabs and bands used by components) are edited next to the components that use them."
            : "This section has no settings in this release."
        }
      />
    </Card>
  );
}
