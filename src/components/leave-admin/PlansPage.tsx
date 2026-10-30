"use client";

import { motion } from "framer-motion";
import { Check, Copy, FileStack, Globe2, LayoutTemplate, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { PlanSummary, PlanTemplate } from "@/lib/leave/adminTypes";
import { useModalRoute } from "@/lib/useModalRoute";

import { ErrorNotice, useLeaveAccess } from "./shared";

export const NEW_PLAN_MODAL = "new-plan";

type Source = "TEMPLATE" | "COPY" | "BLANK";

/** New plan (03-leave/01 §11.4): start from a template, a copy of another plan, or blank; then name and date. */
export function NewPlanForm({ plans, onCreated, onCancel, onDirtyChange }: {
  plans: PlanSummary[];
  onCreated: (id: number) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const templates = useApi(() => leaveAdminApi.templates(), []);
  const [step, setStep] = useState<1 | 2>(1);
  const [source, setSource] = useState<Source>("TEMPLATE");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const template = templates.data?.find((t) => t.key === templateKey);

  const touch = () => onDirtyChange?.(true);
  const next = () => {
    if (source === "TEMPLATE" && !templateKey) return setErrors({ source: "Choose a template." });
    if (source === "COPY" && !copyFrom) return setErrors({ source: "Choose the plan to copy." });
    if (!name) setName(source === "TEMPLATE" && template ? template.name : source === "COPY" ? `${plans.find((p) => String(p.id) === copyFrom)?.name ?? "Plan"} (copy)` : "");
    setErrors({});
    setStep(2);
  };
  const create = async () => {
    if (!name.trim()) return setErrors({ name: "Enter a name." });
    setBusy(true);
    setError(null);
    try {
      const created = await leaveAdminApi.createPlan({
        name: name.trim(),
        description: description.trim() || null,
        effective_from: effectiveFrom || null,
        template_key: source === "TEMPLATE" ? templateKey : null,
        copy_from_plan_id: source === "COPY" ? Number(copyFrom) : null,
      });
      toast.success(`Plan ${created.name} created as a draft`);
      onDirtyChange?.(false);
      onCreated(created.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const sources: { value: Source; title: string; text: string; icon: typeof Copy }[] = [
    { value: "TEMPLATE", title: "Template", text: "Country and industry starters; missing leave types are created.", icon: LayoutTemplate },
    { value: "COPY", title: "Copy a plan", text: "Start from the latest version of an existing plan.", icon: Copy },
    { value: "BLANK", title: "Blank", text: "An empty plan: add leave types one by one.", icon: FileStack },
  ];

  return (
    <div className="space-y-5" data-testid="new-plan-form">
      <ol className="flex items-center gap-2 text-xs font-medium text-muted-foreground" aria-label="Steps">
        {["Start from", "Name and date"].map((label, i) => (
          <li key={label} className={cn("flex items-center gap-2", step === i + 1 && "text-foreground")}>
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border", step > i + 1 ? "border-success bg-success text-white" : step === i + 1 ? "border-primary text-primary" : "border-border")}>
              {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            {label}
            {i === 0 && <span className="mx-1 h-px w-8 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Start from" className="grid gap-3 sm:grid-cols-3">
            {sources.map((s) => {
              const Icon = s.icon;
              const on = source === s.value;
              return (
                <button key={s.value} type="button" role="radio" aria-checked={on} onClick={() => { setSource(s.value); setErrors({}); touch(); }}
                  data-testid={`plan-source-${s.value.toLowerCase()}`}
                  className={cn("rounded-2xl border p-4 text-left transition-all", on ? "border-primary bg-primary-soft/50 shadow-glow" : "border-border hover:border-muted-foreground/40")}>
                  <Icon className={cn("mb-2 h-5 w-5", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.text}</p>
                </button>
              );
            })}
          </div>
          {source === "TEMPLATE" && (
            templates.error ? <ErrorNotice error={templates.error} /> : !templates.data ? <Skeleton className="h-40 rounded-2xl" /> : (
              <div role="radiogroup" aria-label="Template" className="grid gap-3 sm:grid-cols-2">
                {templates.data.map((t: PlanTemplate, i) => (
                  <MotionSafe key={t.key}>
                    <motion.button type="button" role="radio" aria-checked={templateKey === t.key}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      onClick={() => { setTemplateKey(t.key); setErrors({}); touch(); }} data-testid={`template-${t.key}`}
                      className={cn("h-full w-full rounded-2xl border p-4 text-left transition-colors", templateKey === t.key ? "border-primary bg-primary-soft/40" : "border-border hover:bg-surface-muted/60")}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{t.name}</p>
                        <Badge tone="neutral"><Globe2 className="h-3 w-3" aria-hidden />{t.country ?? "Any"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                      <p className="mt-2 flex flex-wrap gap-1">
                        {t.types.map((code) => <span key={code} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{code}</span>)}
                      </p>
                    </motion.button>
                  </MotionSafe>
                ))}
              </div>
            )
          )}
          {source === "COPY" && (
            <Field label="Plan to copy" error={errors.source}>
              <Select value={copyFrom} onChange={(e) => { setCopyFrom(e.target.value); setErrors({}); touch(); }} data-testid="copy-from">
                <option value="">Choose a plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          {source === "BLANK" && <Notice tone="info" title="A blank plan starts with no leave types">Add each type in the plan builder; every new rule starts with valid defaults.</Notice>}
          {errors.source && source === "TEMPLATE" && <p className="text-xs font-medium text-danger" role="alert">{errors.source}</p>}
          {source === "TEMPLATE" && template && (
            <Notice tone="warning" title="Check the amounts against your local law">Templates are starting points; leave types they need are created if missing.</Notice>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Plan name" required error={errors.name}>
            <Input value={name} maxLength={150} onChange={(e) => { setName(e.target.value); touch(); }} data-testid="plan-name" />
          </Field>
          <Field label="Effective from" hint="The first draft version starts on this date; you can change it before activating.">
            <Input type="date" value={effectiveFrom} onChange={(e) => { setEffectiveFrom(e.target.value); touch(); }} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} maxLength={2000} value={description} onChange={(e) => { setDescription(e.target.value); touch(); }} />
          </Field>
          <ErrorNotice error={error} />
        </div>
      )}

      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStep(1)} disabled={step === 1}>Back</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          {step === 1 ? (
            <Button onClick={next} data-testid="plan-next">Next</Button>
          ) : (
            <Button onClick={() => void create()} loading={busy} data-testid="plan-create">
              <Sparkles className="h-4 w-4" /> Create draft
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings › Leave › Plans (03-leave/01 §11.4): list with head counts, unassigned alert, `?modal=new-plan`. */
export function PlansPage() {
  const router = useRouter();
  const [archived, setArchived] = useState(false);
  const [dirty, setDirty] = useState(false);
  const plans = useApi(() => leaveAdminApi.plans(archived), [archived]);
  const access = useLeaveAccess();
  const unassigned = useApi(() => leaveAdminApi.unassigned(), [], { enabled: !!access.data?.v2_enabled });
  const modal = useModalRoute(NEW_PLAN_MODAL, { dirty });
  const canWrite = !!access.data && (access.data.permissions["leave:manage_policy"]?.length ?? 0) > 0;
  useEffect(() => {
    if (!modal.open) setDirty(false);
  }, [modal.open]);

  const columns: Column<PlanSummary>[] = [
    {
      key: "name",
      header: "Plan",
      primary: true,
      cell: (p) => (
        <span className="min-w-0">
          <span className="block font-medium">{p.name}</span>
          {p.description && <span className="block max-w-md truncate text-xs text-muted-foreground">{p.description}</span>}
        </span>
      ),
    },
    {
      key: "active",
      header: "Active version",
      cell: (p) => (p.active_version ? <span>v{p.active_version.version} <span className="text-muted-foreground">from {fmtDate(p.active_version.effective_from)}</span></span> : <span className="text-muted-foreground">Not active</span>),
    },
    {
      key: "draft",
      header: "Draft",
      hideOnMobile: true,
      cell: (p) => (p.draft_versions.length ? <Badge tone="info">v{p.draft_versions[p.draft_versions.length - 1]} draft</Badge> : "—"),
    },
    { key: "rules", header: "Assignment rules", hideOnMobile: true, cell: (p) => p.rule_count || <span className="text-warning">None</span> },
    { key: "people", header: "People", cell: (p) => <span className="tabular-nums">{p.head_count ?? 0}</span> },
    { key: "status", header: "Status", cell: (p) => <Badge tone={p.status === "ACTIVE" ? "success" : "neutral"} dot>{p.status === "ACTIVE" ? "Open" : "Archived"}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title="Leave plans"
        description="A plan bundles the rules of each leave type — entitlement, accrual, eligibility, request rules and year end — for the people it is assigned to."
        actions={
          <>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={archived} onChange={setArchived} label="Show archived" /> Show archived
            </label>
            {canWrite && (
              <Button onClick={() => modal.openModal()} data-testid="new-plan">
                <Plus className="h-4 w-4" /> New plan
              </Button>
            )}
          </>
        }
      />
      {access.data && !access.data.v2_enabled && (
        <Notice tone="info" title="Plans apply after go-live" className="mb-4">
          While the company is on legacy leave you can build, simulate and activate plans; balances follow them once leave v2 goes live.
        </Notice>
      )}
      {!!unassigned.data?.length && (
        <Notice tone="warning" title={`${unassigned.data.length} employee(s) have no leave plan today`} className="mb-4">
          Add or widen an assignment rule so that everyone is covered (an “Everyone” rule with a low priority is a good catch-all).
        </Notice>
      )}
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void plans.reload()}>
            <RefreshCw className={cn("h-4 w-4", plans.loading && "animate-spin")} />
          </Button>
        </div>
        {plans.error && !plans.data ? (
          <ErrorState message={plans.error.message} onRetry={() => void plans.reload()} />
        ) : (
          <DataTable
            caption="Leave plans"
            columns={columns}
            rows={plans.data}
            loading={plans.loading && !plans.data}
            busy={plans.loading && !!plans.data}
            rowKey={(p) => p.id}
            rowHref={(p) => `/settings/leave/plans/${p.id}`}
            onRowClick={(p) => router.push(`/settings/leave/plans/${p.id}`)}
            cardBelowMd
            empty={
              <EmptyState
                icon={<LayoutTemplate />}
                title="No leave plans yet"
                description="Start from a country template: it creates the leave types it needs and sensible rules for each."
                action={canWrite ? <Button onClick={() => modal.openModal()}>New plan</Button> : undefined}
              />
            }
          />
        )}
      </Card>
      <Modal open={modal.open} onOpenChange={modal.onOpenChange} size="xl" title="New leave plan" description="Plans start as a draft; nothing applies until a version is activated.">
        <NewPlanForm
          plans={(plans.data ?? []).filter((p) => p.status === "ACTIVE")}
          onDirtyChange={setDirty}
          onCancel={() => void modal.close()}
          onCreated={(id) => router.push(`/settings/leave/plans/${id}`)}
        />
      </Modal>
    </div>
  );
}
