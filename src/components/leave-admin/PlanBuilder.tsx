"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Archive, ArrowLeft, CopyPlus, FlaskConical, Hourglass, MoreHorizontal, Pencil, Plus, Save, ShieldCheck, Snowflake, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { DetailGate, Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { DropdownMenu, MenuItem, MenuSeparator, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { issuesOf, leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeavePlanFields, LeaveTypeV2, PlanIssue, PlanVersion } from "@/lib/leave/adminTypes";
import { useTabParam } from "@/lib/useTabParam";
import { useSession } from "@/store/session";

import { AssignmentEditor } from "./AssignmentEditor";
import { ActivateModal, PlanDetailsModal, SimulateModal } from "./PlanModals";
import { addTypeRule, hydratePlan, preparePlan, removeTypeRule, ruleIndexOf, rulePath, setIn } from "./planModel";
import { PlanSettingsEditor, TypeRuleEditor } from "./RuleEditor";
import { ErrorNotice, IssueList, LeaveSwatch, hasLeavePerm, useLeaveAccess, useLeaveTypes, useOrgOptions } from "./shared";

const TABS = ["types", "settings", "assignment", "versions"] as const;
type Tab = (typeof TABS)[number];

const VERSION_TONE: Record<string, "success" | "info" | "neutral"> = { ACTIVE: "success", DRAFT: "info", SUPERSEDED: "neutral" };

/** The version the builder opens: the newest draft, else the active one, else the latest. */
export function defaultVersion(versions: PlanVersion[], activeVersion?: number | null): number | null {
  const drafts = versions.filter((v) => v.status === "DRAFT").map((v) => v.version);
  if (drafts.length) return Math.max(...drafts);
  if (activeVersion) return activeVersion;
  return versions.length ? Math.max(...versions.map((v) => v.version)) : null;
}

/**
 * Settings › Leave › Plans › {plan} (03-leave/01 §11.5): versions, the DRAFT editor of every type rule, plan defaults
 * and comp-off, assignment rules, simulate, activate (second person, step-up) and archive.
 */
export function PlanBuilder({ planId }: { planId: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const me = useSession((s) => s.me);
  const access = useLeaveAccess();
  const canWrite = hasLeavePerm(access.data, "leave:manage_policy");
  const plan = useApi(() => leaveAdminApi.plan(planId), [planId]);
  const types = useLeaveTypes(true);
  const settings = useApi(() => leaveAdminApi.settings().catch(() => null), [], { enabled: canWrite });
  const org = useOrgOptions();
  const [tab, setTab] = useTabParam<Tab>(TABS, "types");

  const [selected, setSelected] = useState<number | null>(null);
  const [doc, setDoc] = useState<LeavePlanFields | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [dirty, setDirty] = useState(false);
  const [serverIssues, setServerIssues] = useState<PlanIssue[]>([]);
  const [warnings, setWarnings] = useState<PlanIssue[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [addCode, setAddCode] = useState("");
  const [activateOpen, setActivateOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const versions = useMemo(() => plan.data?.versions ?? [], [plan.data]);
  const version = versions.find((v) => v.version === selected) ?? null;
  const isDraft = version?.status === "DRAFT";
  const readOnly = !canWrite || !isDraft || plan.data?.status === "ARCHIVED";
  const today = access.data?.local_today ?? todayISO();
  const secondPerson = settings.data?.settings.find((s) => s.key === "leave.plan.requires_second_person")?.value === true;
  const typeByCode = useMemo(() => new Map((types.data ?? []).map((t) => [t.code, t])), [types.data]);

  useEffect(() => {
    if (plan.data && selected === null) setSelected(defaultVersion(plan.data.versions, plan.data.active_version?.version));
  }, [plan.data, selected]);

  // Load the selected version into the editor (never over unsaved edits).
  useEffect(() => {
    if (!version || dirty) return;
    const fields = hydratePlan(version.fields);
    setDoc(fields);
    setEffectiveFrom(version.effective_from);
    setActiveCode((code) => (code && fields.types.some((t) => t.leave_type_code === code) ? code : fields.types[0]?.leave_type_code ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id, version?.policy_hash, version?.effective_from, plan.data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const prepared = useMemo(() => (doc && isDraft ? preparePlan(doc, types.data) : null), [doc, isDraft, types.data]);
  const issues = useMemo(() => [...(prepared?.issues ?? []), ...serverIssues], [prepared, serverIssues]);
  const ruleIssues = (index: number) =>
    issues.filter((i) => ruleIndexOf(i.field) === index).map((i) => ({ ...i, field: rulePath(i.field) }));
  const planIssues = issues.filter((i) => ruleIndexOf(i.field) === null);

  const edit = (updater: (d: LeavePlanFields) => LeavePlanFields) => {
    setDoc((d) => (d ? updater(d) : d));
    setDirty(true);
    setServerIssues([]);
  };
  const setRule = (index: number) => (path: string, value: unknown) => edit((d) => setIn(d, `types[${index}].${path}`, value));
  const setPlanField = (path: string, value: unknown) => edit((d) => setIn(d, path, value));

  const discardOk = async () =>
    !dirty || (await confirm({ title: "Discard changes?", message: "Your edits to this draft haven't been saved.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" }));

  const pickVersion = async (v: number) => {
    if (v === selected || !(await discardOk())) return;
    setDirty(false);
    setServerIssues([]);
    setWarnings([]);
    setSelected(v);
  };

  const save = async () => {
    if (!doc || !version) return;
    const { fields, issues: found } = preparePlan(doc, types.data);
    if (found.length) {
      toast.error(`Fix ${found.length} problem(s) before saving.`);
      const index = ruleIndexOf(found[0].field);
      if (index !== null) {
        setTab("types");
        setActiveCode(doc.types[index]?.leave_type_code ?? null);
      } else setTab("settings");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await leaveAdminApi.saveVersion(planId, version.version, { fields, effective_from: effectiveFrom || undefined });
      setDoc(hydratePlan(saved.fields));
      setWarnings(saved.warnings ?? []);
      setServerIssues([]);
      setDirty(false);
      toast.success(saved.warnings?.length ? `Draft saved with ${saved.warnings.length} warning(s) to fix before activation` : "Draft saved");
      void plan.reload();
    } catch (e) {
      setServerIssues(issuesOf(e));
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  const newVersion = async () => {
    if (!(await discardOk())) return;
    try {
      const created = await leaveAdminApi.createVersion(planId);
      toast.success(`Draft version ${created.version} created from the latest version`);
      setDirty(false);
      setSelected(created.version);
      void plan.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a version.");
    }
  };

  const archive = async () => {
    if (!plan.data) return;
    const ok = await confirm({
      title: `Archive ${plan.data.name}?`,
      message: "The plan stops applying; its versions and rules are kept. Plans still used by employees today cannot be archived.",
      confirmLabel: "Archive plan",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await leaveAdminApi.archive(planId);
      toast.success("Plan archived");
      router.push("/settings/leave/plans");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't archive the plan.");
    }
  };

  const removeRule = async (code: string) => {
    const name = typeByCode.get(code)?.name ?? code;
    if (!(await confirm({ title: `Remove ${name} from this plan?`, message: "People on this plan can no longer request it once the version is active (unless “keep the balance” is on).", confirmLabel: "Remove", tone: "danger" }))) return;
    edit((d) => removeTypeRule(d, code));
    if (activeCode === code) setActiveCode(doc?.types.find((t) => t.leave_type_code !== code)?.leave_type_code ?? null);
  };

  const addRule = () => {
    const type = typeByCode.get(addCode);
    if (!type) return;
    edit((d) => addTypeRule(d, type));
    setActiveCode(type.code);
    setAddCode("");
  };

  const jumpTo = (issue: PlanIssue) => {
    const index = ruleIndexOf(issue.field);
    if (index !== null && doc?.types[index]) {
      setTab("types");
      setActiveCode(doc.types[index].leave_type_code);
    } else setTab("settings");
  };

  const activeIndex = doc?.types.findIndex((t) => t.leave_type_code === activeCode) ?? -1;
  const activeRule = activeIndex >= 0 ? doc?.types[activeIndex] : undefined;
  const available = (types.data ?? []).filter((t) => t.is_active && !doc?.types.some((r) => r.leave_type_code === t.code));
  const pending = version?.activation_request;

  return (
    <DetailGate loading={plan.loading} error={plan.error} hasData={!!plan.data} onRetry={() => void plan.reload()} what="Leave plan" backHref="/settings/leave/plans" backLabel="Back to plans">
      {plan.data && (
        <div className="pb-24">
          <Link href="/settings/leave/plans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> All plans
          </Link>
          <PageHeader
            eyebrow="Leave plan"
            title={<span className="flex flex-wrap items-center gap-3">{plan.data.name}{plan.data.status === "ARCHIVED" && <Badge>Archived</Badge>}</span>}
            description={plan.data.description ?? (plan.data.active_version ? `Version ${plan.data.active_version.version} active from ${fmtDate(plan.data.active_version.effective_from)}.` : "No version is active yet.")}
            actions={
              <>
                <Button variant="secondary" onClick={() => setSimulateOpen(true)} disabled={!version} data-testid="plan-simulate">
                  <FlaskConical className="h-4 w-4" /> Simulate
                </Button>
                {canWrite && plan.data.status === "ACTIVE" && (
                  <>
                    <Button variant="secondary" onClick={() => void newVersion()} data-testid="plan-new-version">
                      <CopyPlus className="h-4 w-4" /> New version
                    </Button>
                    {isDraft && (
                      <Button onClick={() => setActivateOpen(true)} data-testid="plan-activate">
                        <ShieldCheck className="h-4 w-4" /> {pending ? "Review activation" : secondPerson ? "Request activation…" : "Activate…"}
                      </Button>
                    )}
                    <DropdownMenu trigger={<Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
                      <MenuItem icon={<Pencil />} onSelect={() => setDetailsOpen(true)}>Edit name and description</MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Archive />} tone="danger" onSelect={() => void archive()}>Archive plan</MenuItem>
                    </DropdownMenu>
                  </>
                )}
              </>
            }
          />

          <Card className="mb-5 p-4" data-testid="version-bar">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">Version</p>
                <div role="radiogroup" aria-label="Version" className="flex flex-wrap gap-1.5">
                  {versions.map((v) => (
                    <button key={v.version} type="button" role="radio" aria-checked={v.version === selected} onClick={() => void pickVersion(v.version)}
                      className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                        v.version === selected ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-muted")}
                      data-testid={`version-${v.version}`}>
                      v{v.version}
                      <Badge tone={VERSION_TONE[v.status] ?? "neutral"} className="px-1.5 py-0 text-[10px]">{v.status.toLowerCase()}</Badge>
                    </button>
                  ))}
                </div>
              </div>
              {version && (
                <Field label="Effective from" className="w-44" hint={isDraft ? "Saved with the draft." : version.effective_to ? `Until ${fmtDate(version.effective_to)}` : "Open-ended"}>
                  <Input type="date" value={effectiveFrom} disabled={readOnly}
                    onChange={(e) => { setEffectiveFrom(e.target.value); setDirty(true); }} data-testid="version-effective-from" />
                </Field>
              )}
              <span className="flex-1" />
              {isDraft && canWrite && (
                <Button onClick={() => void save()} loading={saving} disabled={!dirty} data-testid="plan-save">
                  <Save className="h-4 w-4" /> Save draft
                </Button>
              )}
            </div>
            {version && !isDraft && (
              <p className="mt-3 text-sm text-muted-foreground">
                {version.status === "ACTIVE" ? "Active versions are read-only." : "Superseded versions are read-only."} Use <strong>New version</strong> to change the rules.
                {version.activated_at && <> Activated {fmtDateTime(version.activated_at)}.</>}
              </p>
            )}
            {pending && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm" data-testid="pending-activation">
                <Hourglass className="h-4 w-4 text-info" aria-hidden />
                Waiting for a second approver: activation from {fmtDate(pending.effective_from)} requested
                {version?.activation_requested_by_user_id === me?.user.id ? " by you" : ` by user #${version?.activation_requested_by_user_id}`}.
              </div>
            )}
          </Card>

          {isDraft && issues.length > 0 && (
            <div className="mb-4"><IssueList issues={issues} onSelect={jumpTo} /></div>
          )}
          {warnings.length > 0 && <div className="mb-4"><IssueList issues={warnings} tone="warning" title="Fix before activation" onSelect={jumpTo} /></div>}
          {saveError && !issuesOf(saveError).length ? <div className="mb-4"><ErrorNotice error={saveError} /></div> : null}

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            tabs={[
              { value: "types", label: "Leave types", badge: doc?.types.length },
              { value: "settings", label: "Plan settings" },
              { value: "assignment", label: "Assignment", badge: plan.data.rule_count || undefined },
              { value: "versions", label: "Versions" },
            ]}
          >
            <TabPanel value="types">
              {!doc ? null : (
                <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
                  <Card className="h-fit p-2" data-testid="rule-list">
                    <ul className="space-y-1">
                      {doc.types.map((rule, index) => {
                        const type = typeByCode.get(rule.leave_type_code);
                        const n = ruleIssues(index).length;
                        return (
                          <li key={rule.leave_type_code}>
                            <button type="button" onClick={() => setActiveCode(rule.leave_type_code)} aria-current={activeCode === rule.leave_type_code ? "true" : undefined}
                              className={cn("relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                                activeCode === rule.leave_type_code ? "text-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground")}
                              data-testid={`rule-item-${rule.leave_type_code}`}>
                              {activeCode === rule.leave_type_code && (
                                <MotionSafe><motion.span layoutId="active-rule" className="absolute inset-0 rounded-xl bg-primary-soft" transition={{ type: "spring", stiffness: 420, damping: 34 }} /></MotionSafe>
                              )}
                              <LeaveSwatch token={type?.color_token} className="relative" />
                              <span className="relative min-w-0 flex-1 truncate font-medium">{type?.name ?? rule.leave_type_code}</span>
                              {rule.frozen && <Snowflake className="relative h-3.5 w-3.5 text-info" aria-label="Frozen" />}
                              {n > 0 && <span className="relative rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white" aria-label={`${n} problem(s)`}>{n}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {doc.types.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No leave types yet.</p>}
                    {!readOnly && (
                      <div className="mt-2 space-y-2 border-t border-border p-2">
                        <Select aria-label="Leave type to add" value={addCode} onChange={(e) => setAddCode(e.target.value)} data-testid="rule-add-select">
                          <option value="">Add a leave type…</option>
                          {available.map((t: LeaveTypeV2) => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
                        </Select>
                        <Button variant="secondary" size="sm" className="w-full" disabled={!addCode} onClick={addRule} data-testid="rule-add">
                          <Plus className="h-4 w-4" /> Add to plan
                        </Button>
                      </div>
                    )}
                  </Card>
                  <div className="min-w-0">
                    <AnimatePresence mode="wait">
                      {activeRule ? (
                        <MotionSafe key={activeRule.leave_type_code}>
                          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
                            <div className="mb-3 flex flex-wrap items-center gap-3">
                              <LeaveSwatch token={typeByCode.get(activeRule.leave_type_code)?.color_token} className="h-3.5 w-3.5" />
                              <h2 className="text-lg font-semibold">{typeByCode.get(activeRule.leave_type_code)?.name ?? activeRule.leave_type_code}</h2>
                              <span className="font-mono text-xs text-muted-foreground">{activeRule.leave_type_code}</span>
                              {typeByCode.get(activeRule.leave_type_code)?.kind && <Badge tone="info">{typeByCode.get(activeRule.leave_type_code)?.kind?.replace("_", " ").toLowerCase()}</Badge>}
                              <span className="flex-1" />
                              {!readOnly && (
                                <Button variant="danger-ghost" size="sm" onClick={() => void removeRule(activeRule.leave_type_code)} data-testid="rule-remove">
                                  <Trash2 className="h-4 w-4" /> Remove from plan
                                </Button>
                              )}
                            </div>
                            <TypeRuleEditor rule={activeRule} type={typeByCode.get(activeRule.leave_type_code)} types={types.data ?? []}
                              branches={org.branches} issues={ruleIssues(activeIndex)} readOnly={readOnly} onChange={setRule(activeIndex)} />
                          </motion.div>
                        </MotionSafe>
                      ) : (
                        <Card><EmptyState title="Add a leave type" description="Each leave type in the plan gets its own rules: entitlement, eligibility, request rules and year end." /></Card>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </TabPanel>
            <TabPanel value="settings">
              {doc && (
                <PlanSettingsEditor plan={doc} issues={planIssues} readOnly={readOnly} onChange={setPlanField}
                  hasCompOff={doc.types.some((r) => typeByCode.get(r.leave_type_code)?.kind === "COMP_OFF")} />
              )}
            </TabPanel>
            <TabPanel value="assignment">
              <Card className="p-4 sm:p-5">
                <AssignmentEditor planId={planId} readOnly={!canWrite || plan.data.status !== "ACTIVE"} onSaved={() => void plan.reload()} />
              </Card>
            </TabPanel>
            <TabPanel value="versions">
              <Card className="p-4 sm:p-5">
                <ol className="relative space-y-4 border-s border-border ps-6" data-testid="versions-list">
                  {[...versions].reverse().map((v) => (
                    <li key={v.version} className="relative">
                      <span className={cn("absolute -start-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-surface", v.status === "ACTIVE" ? "bg-success" : v.status === "DRAFT" ? "bg-info" : "bg-muted-foreground/40")} aria-hidden />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">Version {v.version}</span>
                        <Badge tone={VERSION_TONE[v.status] ?? "neutral"} dot>{v.status.toLowerCase()}</Badge>
                        <span className="text-sm text-muted-foreground">{fmtDate(v.effective_from)} – {v.effective_to ? fmtDate(v.effective_to) : "open-ended"}</span>
                        {v.activation_request && <Badge tone="warning">activation requested</Badge>}
                        <span className="flex-1" />
                        <Button size="sm" variant={v.version === selected ? "subtle" : "ghost"} onClick={() => { void pickVersion(v.version); setTab("types"); }}>
                          {v.version === selected ? "Open" : "View"}
                        </Button>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {v.fields?.types?.length ?? 0} leave type(s)
                        {v.activated_at && <> · activated {fmtDateTime(v.activated_at)}{v.activated_by_user_id ? ` by user #${v.activated_by_user_id}` : ""}</>}
                        {v.policy_hash && <> · <span className="font-mono">{v.policy_hash.slice(0, 10)}</span></>}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
            </TabPanel>
          </Tabs>

          <MotionSafe>
            <AnimatePresence>
              {dirty && isDraft && canWrite && (
                <motion.div
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lift backdrop-blur"
                  data-testid="unsaved-bar"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-warning" aria-hidden />
                  <span className="flex-1 text-sm font-medium">
                    Unsaved changes to version {version?.version}
                    {issues.length > 0 && <span className="ms-2 text-danger">· {issues.length} problem(s)</span>}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { setDirty(false); setServerIssues([]); setDoc(version ? hydratePlan(version.fields) : null); setEffectiveFrom(version?.effective_from ?? ""); }}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={() => void save()} loading={saving} data-testid="plan-save-bar"><Save className="h-4 w-4" /> Save draft</Button>
                </motion.div>
              )}
            </AnimatePresence>
          </MotionSafe>

          {version && (
            <>
              <ActivateModal open={activateOpen} onOpenChange={setActivateOpen} plan={plan.data} version={version} secondPerson={secondPerson}
                myUserId={me?.user.id} today={today} dirty={dirty} onIssues={(found) => setServerIssues(found)}
                onDone={() => { setSelected(null); void plan.reload(); }} />
              <SimulateModal open={simulateOpen} onOpenChange={setSimulateOpen} plan={plan.data} versions={versions} initialVersion={version.version}
                today={today} types={types.data ?? []} />
            </>
          )}
          <PlanDetailsModal open={detailsOpen} onOpenChange={setDetailsOpen} plan={plan.data} onSaved={() => void plan.reload()} />
          {!canWrite && access.data && (
            <Notice tone="info" title="Read-only" className="mt-4">You can review plans; changing them needs leave configuration access.</Notice>
          )}
        </div>
      )}
    </DetailGate>
  );
}
