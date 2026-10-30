"use client";

import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { rotationsApi, type RotationPattern, type RotationTemplate } from "@/components/rosters/api";
import { FilterBar } from "@/components/shared/FilterBar";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, TabPanel, Tabs, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ATTENDANCE_TABS, visibleTabs } from "@/lib/attendance-routes";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";
import { useModalRoute } from "@/lib/useModalRoute";
import { useTabParam } from "@/lib/useTabParam";

import { AssignmentsList, RotationAssignModal, activeVersion } from "./RotationAssignments";
import { LastAutoPublishRun, RotationErrorNotice, VersionBadge } from "./RotationParts";
import { templateSummary, versionCrews } from "./rotationModel";

type MainTab = "patterns" | "assignments";

/** The 22 platform templates (best effort: the picker falls back to a blank pattern). */
export function useRotationTemplates() {
  const { data } = useApi(() => rotationsApi.templates().catch(() => [] as RotationTemplate[]), []);
  return useMemo(() => {
    const items = [...(data ?? [])].sort((a, b) => a.number - b.number);
    return { items, byKey: new Map(items.map((t) => [t.key, t])) };
  }, [data]);
}

/** The version a list row describes: the active one, else the newest. */
function shownVersion(p: RotationPattern) {
  return activeVersion(p) ?? p.versions[p.versions.length - 1] ?? null;
}

/* ------------------------------------------------------------------ new rotation */

/**
 * New rotation (`?modal=rotation`; overlay `rotation`, create: template, code, name). A template is copied on use
 * (§2.4); the editor page then maps its letters to this company's shifts and saves the first draft.
 */
export function NewRotationModal({ templates }: { templates: RotationTemplate[] }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("rotation", { keys: ["template"], dirty });
  const [template, setTemplate] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const open = route.open;
  const preset = route.param("template");
  useEffect(() => {
    if (!open) return;
    setTemplate(preset ?? "");
    setCode("");
    setName("");
    setErrors({});
    setError(null);
    setKey(newIdempotencyKey());
  }, [open, preset]);
  useEffect(() => setDirty(open && (!!code || !!name)), [open, code, name]);
  if (!open) return null;
  const chosen = templates.find((t) => t.key === template) ?? null;

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!code.trim()) found.code = "Enter a code.";
    if (!name.trim()) found.name = "Enter a name.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const created = await rotationsApi.create({ code: code.trim(), name: name.trim(), template_key: template || null }, key);
      toast.success(`Rotation ${created.code} created. Map its letters to shifts and save the draft.`);
      setDirty(false);
      router.push(`/attendance/rotations/${created.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={route.onOpenChange} size="lg" title="New rotation"
      description="Start from a common cycle or from a blank pattern. You map its letters to your shifts next."
      footer={<>
        <Button variant="secondary" onClick={() => void route.close()}>Cancel</Button>
        <Button data-testid="create-rotation" loading={busy} disabled={busy} onClick={() => void submit()}>Create rotation</Button>
      </>}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="new-rotation">
        <RotationErrorNotice error={error} />
        <Field label="Start from" hint={chosen ? templateSummary(chosen) : "A blank pattern starts as one crew on a 7-day week."}>
          <Select value={template} onChange={(e) => {
            setTemplate(e.target.value);
            const t = templates.find((x) => x.key === e.target.value);
            if (t && !name) setName(t.name);
          }}>
            <option value="">Blank pattern</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </Select>
        </Field>
        {chosen && (
          <div className="rounded-xl border border-border bg-surface-muted/50 px-4 py-3 text-sm" data-testid="template-preview">
            <p className="font-medium">{chosen.name}</p>
            <p className="mt-1 break-all font-mono text-xs">
              {chosen.tokens ?? Object.entries(chosen.crew_rows ?? {}).map(([c, row]) => `${c} ${row}`).join(" · ")}
            </p>
            <p className="mt-1 text-muted-foreground">
              Crews {versionCrews({ crew_rows: chosen.crew_rows, crew_offsets: chosen.crew_offsets })
                .map((c) => (chosen.crew_rows ? c.code : `${c.code} +${c.offset}`)).join(", ")}. O is a day off.
            </p>
            {chosen.note && <p className="mt-1 text-muted-foreground">{chosen.note}</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required error={errors.code} hint="Unique in the company, e.g. PUNE-6ON2OFF.">
            <Input value={code} maxLength={40} autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Name" required error={errors.name}>
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ patterns list */

function PatternsList({ patterns, loading, error, onRetry, templates, assigned, canCreate, onCreate }: {
  patterns: RotationPattern[] | undefined;
  loading: boolean;
  error: { message: string } | null;
  onRetry: () => void;
  templates: Map<string, RotationTemplate>;
  assigned: Map<number, number>;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (patterns ?? []).filter((p) => !term || p.code.toLowerCase().includes(term) || p.name.toLowerCase().includes(term));
  }, [patterns, q]);
  const columns: Column<RotationPattern>[] = [
    { key: "code", header: "Code", primary: true, cell: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { key: "name", header: "Name", cell: (p) => p.name },
    { key: "template", header: "Template", hideOnMobile: true,
      cell: (p) => (p.template_key ? templates.get(p.template_key)?.name ?? p.template_key : "Blank") },
    { key: "cycle", header: "Cycle", cell: (p) => { const v = shownVersion(p); return v ? `${v.cycle_days} days` : "—"; } },
    { key: "crews", header: "Crews", hideOnMobile: true, cell: (p) => { const v = shownVersion(p); return v ? versionCrews(v).length || 1 : "—"; } },
    { key: "version", header: "Current version", cell: (p) => {
      const v = shownVersion(p);
      if (!v) return <span className="text-muted-foreground">No version yet</span>;
      const draft = p.versions.some((x) => x.status === "DRAFT" && x.version_no > v.version_no);
      return <span className="inline-flex flex-wrap items-center gap-1.5">v{v.version_no} <VersionBadge status={v.status} />
        {draft && <Badge tone="neutral">Newer draft</Badge>}</span>;
    } },
    { key: "assignments", header: "Assignments", hideOnMobile: true, cell: (p) => assigned.get(p.id) ?? 0 },
    { key: "status", header: "Status", cell: (p) => (p.status === "ARCHIVED" ? "Archived" : "Active") },
  ];
  return (
    <Card>
      <FilterBar search={{ value: q, onChange: setQ, label: "Search code or name", placeholder: "Search code or name…" }}
        resultCount={patterns ? rows.length : undefined} />
      {error ? <ErrorState message={error.message} onRetry={onRetry} /> : (
        <DataTable columns={columns} rows={patterns ? rows : undefined} loading={loading && !patterns} rowKey={(p) => p.id}
          rowHref={(p) => `/attendance/rotations/${p.id}`} onRowClick={(p) => router.push(`/attendance/rotations/${p.id}`)}
          cardBelowMd caption="Rotation patterns"
          empty={<EmptyState icon={<Repeat />} title={q ? "No rotations match" : "No rotations yet"}
            description={q ? "Try another code or name." : canCreate
              ? "Start from a common cycle such as 6 on 2 off, then map its letters to your shifts."
              : "Rotations appear here once a shift manager creates them."}
            action={!q && canCreate ? <Button onClick={onCreate}><Plus className="h-4 w-4" aria-hidden /> New rotation</Button> : undefined} />} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ workspace */

/**
 * `/attendance/rotations` (A16; 09-ui-ux/02 §8.2): tabs Patterns and Assignments (`?tab=assignments`), the last
 * automatic publish, "New rotation" (`shift:manage`, template picker → editor page) and "Assign rotation…"
 * (`shift:assign`).
 */
export function RotationsWorkspace() {
  const { me } = useCan();
  const tabs = visibleTabs(ATTENDANCE_TABS["/attendance/rotations"], me);
  const values = tabs.map((t) => t.value as MainTab);
  const [tab, setTab] = useTabParam<MainTab>(values.length ? values : ["patterns"], values[0] ?? "patterns");
  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);
  const manage = can(me, P.SHIFT_MANAGE);
  const assign = can(me, P.SHIFT_ASSIGN);
  const create = useModalRoute("rotation", { keys: ["template"] });
  const assignRoute = useModalRoute("rotation-assign", { keys: ["pattern"] });
  const templates = useRotationTemplates();
  const patterns = useApi(() => rotationsApi.list(), [refresh]);
  const counts = useApi(() => rotationsApi.assignments({ limit: 500 }).catch(() => null), [refresh]);
  const assigned = useMemo(() => {
    const out = new Map<number, number>();
    for (const a of counts.data?.items ?? []) if (a.status === "ACTIVE") out.set(a.pattern_id, (out.get(a.pattern_id) ?? 0) + 1);
    return out;
  }, [counts.data]);

  return (
    <div>
      <WorkspaceHeader eyebrow="Shifts" title="Rotations" showHideAmounts={false}
        description="Repeating shift cycles for crews and people: which cycle they follow and from which day."
        actions={<>
          {assign && <Button variant="secondary" onClick={() => assignRoute.openModal()}>Assign rotation…</Button>}
          {manage && <Button onClick={() => create.openModal()}><Plus className="h-4 w-4" aria-hidden /> New rotation</Button>}
        </>} />
      <LastAutoPublishRun refresh={refresh} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} tabs={tabs.map((t) => ({ value: t.value, label: t.label }))}>
        <TabPanel value="patterns">
          <PatternsList patterns={patterns.data} loading={patterns.loading} error={patterns.error} onRetry={() => void patterns.reload()}
            templates={templates.byKey} assigned={assigned} canCreate={manage} onCreate={() => create.openModal()} />
        </TabPanel>
        <TabPanel value="assignments">
          <Card>
            <AssignmentsList refresh={refresh} canAssign={assign} onAssign={() => assignRoute.openModal()} />
          </Card>
        </TabPanel>
      </Tabs>
      {manage && <NewRotationModal templates={templates.items} />}
      {assign && <RotationAssignModal patterns={patterns.data ?? []} onDone={bump} />}
    </div>
  );
}
