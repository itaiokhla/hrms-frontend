"use client";

import { CheckCircle2, CopyPlus, MoveRight, Rocket, Save, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isConflict, PayrollApiError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { compensationApi, linePayload } from "./api";
import { structureTypeLabel, todayIso } from "./format";
import { LinesEditor, toEditable, type EditableLine } from "./LinesEditor";
import { MoveAssignmentsModal } from "./MoveAssignmentsModal";
import { BackLink, ConflictBanner, ErrorSummary, IdChips, LoadError, PageSkeleton, ToneChip, useOrgOptions } from "./shared";
import { StructurePreview } from "./StructurePreview";
import type { Eligibility, SalaryStructure, StructureVersion, TestVector, ValidationReport } from "./types";

const VERSION_TONE: Record<string, { label: string; tone: "neutral" | "success" | "info" }> = {
  DRAFT: { label: "Draft", tone: "info" },
  ACTIVE: { label: "Published", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

interface Edit {
  version: number;
  rowVersion: number;
  name: string;
  description: string;
  lines: EditableLine[];
  eligibility: Eligibility;
  rangeMin: string;
  rangeMax: string;
  vectors: TestVector[];
}

function editOf(s: SalaryStructure, v: StructureVersion): Edit {
  return {
    version: v.version,
    rowVersion: v.row_version,
    name: s.name,
    description: s.description ?? "",
    lines: toEditable(v.lines),
    eligibility: v.eligibility ?? {},
    rangeMin: v.test_range?.min ?? "",
    rangeMax: v.test_range?.max ?? "",
    vectors: v.test_vectors ?? [],
  };
}

function reportFromError(e: unknown): ValidationReport | null {
  if (!(e instanceof PayrollApiError) || !e.detail || typeof e.detail !== "object") return null;
  const d = e.detail as Partial<ValidationReport>;
  return Array.isArray(d.errors) ? { ok: false, currency: d.currency ?? null, errors: d.errors, warnings: d.warnings ?? [], minimum_pay_basis: d.minimum_pay_basis ?? null, vectors: d.vectors ?? [] } : null;
}

/**
 * Salary structure builder (3.8 §5.8): lines editor, eligibility, test range and vectors, live
 * preview, Validate and Publish, and moving assignments to the new version with a before/after preview.
 */
export function StructureBuilder({ id }: { id: number }) {
  const { me, can } = useCan();
  const canEdit = can(P.PAYROLL_SALARY_STRUCTURE_EDIT);
  const canPublish = canEdit || can(P.PAYROLL_SALARY_STRUCTURE_APPROVE);
  const canMove = can(P.PAYROLL_COMPENSATION_EDIT);
  const detail = useApi(() => compensationApi.getStructure(id), [id]);
  const catalogue = useApi(() => compensationApi.listComponents(), []);
  const org = useOrgOptions();
  const publishModal = useModalRoute("publish", { keys: ["version"] });
  const moveModal = useModalRoute("move", { keys: [] });
  const structure = detail.data;

  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [seeded, setSeeded] = useState<SalaryStructure | null>(null);
  const [dirty, setDirty] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishFrom, setPublishFrom] = useState("");
  const [vectorDraft, setVectorDraft] = useState<{ name: string; amount: string; expected: string }>({ name: "", amount: "", expected: "" });

  const versions = structure?.versions ?? [];
  const current = versions.find((v) => v.version === selected) ?? versions.find((v) => v.status === "DRAFT") ?? versions.find((v) => v.status === "ACTIVE") ?? versions[versions.length - 1];
  if (structure && current && structure !== seeded) {
    setSeeded(structure);
    setSelected(current.version);
    setEdit(editOf(structure, current));
    setDirty(false);
    setReport(current.validation ?? null);
  }

  const names = useMemo(() => Object.fromEntries((catalogue.data ?? []).map((c) => [c.code, c.name])), [catalogue.data]);

  if (detail.error) return <LoadError error={detail.error} onRetry={detail.reload} what="Salary structure" backHref="/payroll/structures" backLabel="Back to structures" />;
  if (!structure || !current || !edit) return <PageSkeleton />;

  const isDraft = current.status === "DRAFT";
  const readOnly = !canEdit || !isDraft || structure.status === "ARCHIVED";
  const currency = structure.currency ?? report?.currency ?? me?.company.currency ?? "INR";
  const change = (patch: Partial<Edit>) => {
    setEdit((e) => (e ? { ...e, ...patch } : e));
    setDirty(true);
  };
  const choose = (n: number) => {
    const v = versions.find((x) => x.version === n);
    if (!v) return;
    setSelected(n);
    setEdit(editOf(structure, v));
    setDirty(false);
    setReport(v.validation ?? null);
  };

  const errors = report?.errors ?? [];
  const lineIssues = [...errors, ...(report?.warnings ?? [])];
  const general = errors.filter((e) => !e.component || !edit.lines.some((l) => l.component === e.component));
  const activeVersion = versions.find((v) => v.status === "ACTIVE");
  const olderAssignments = Object.entries(structure.assignment_counts)
    .filter(([v]) => Number(v) !== activeVersion?.version)
    .reduce((sum, [, n]) => sum + n, 0);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setSaveError(null);
    try {
      await fn();
    } catch (e) {
      if (isConflict(e) && (e as PayrollApiError).code === "ROW_VERSION_CONFLICT") setConflict(errorMessage(e));
      else {
        const fromError = reportFromError(e);
        if (fromError) setReport(fromError);
        setSaveError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  };

  const rangeError = (edit.rangeMin && !/^\d+(\.\d+)?$/.test(edit.rangeMin)) || (edit.rangeMax && !/^\d+(\.\d+)?$/.test(edit.rangeMax)) ? "Use plain numbers such as 300000." : (edit.rangeMin === "") !== (edit.rangeMax === "") ? "Give both the minimum and the maximum." : null;

  const save = () =>
    run("save", async () => {
      if (rangeError) throw new Error(rangeError);
      const saved = await compensationApi.updateStructureVersion(structure.id, edit.version, {
        row_version: edit.rowVersion,
        name: edit.name.trim(),
        description: edit.description.trim() || null,
        eligibility: edit.eligibility,
        lines: edit.lines.map(linePayload),
        test_range: edit.rangeMin && edit.rangeMax ? { min: edit.rangeMin, max: edit.rangeMax } : null,
        test_vectors: edit.vectors,
      });
      toast.success("Draft saved.");
      setSelected(edit.version);
      detail.setData(saved);
    });

  const validate = () =>
    run("validate", async () => {
      const r = await compensationApi.validateStructure(structure.id, current.version);
      setReport(r);
      if (r.ok) toast.success(`Version ${current.version} is ready to publish.`);
    });

  const newDraft = () =>
    run("draft", async () => {
      const saved = await compensationApi.createStructureVersion(structure.id, activeVersion?.version);
      toast.success("Draft created from the published version.");
      setSelected(null);
      detail.setData(saved);
    });

  const publish = () =>
    run("publish", async () => {
      const saved = await compensationApi.publishStructure(structure.id, { version: current.version, effective_from: publishFrom || undefined });
      toast.success(`Version ${current.version} published. New salaries use it from ${fmtDate(publishFrom || todayIso())}.`);
      await publishModal.close();
      setSelected(current.version);
      detail.setData(saved);
    });

  const addVector = () => {
    const pairs = vectorDraft.expected
      .split(/[\n,;]+/)
      .map((p) => p.split(/[=:]/).map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1]);
    if (!vectorDraft.amount || !pairs.length) return;
    change({ vectors: [...edit.vectors, { name: vectorDraft.name || `Vector ${edit.vectors.length + 1}`, pay_basis_amount: vectorDraft.amount, expected: Object.fromEntries(pairs) }] });
    setVectorDraft({ name: "", amount: "", expected: "" });
  };

  const summary = [...(saveError ? [saveError] : []), ...general.map((g) => g.message)];

  return (
    <div>
      <BackLink href="/payroll/structures">Salary structures</BackLink>
      <PageHeader
        eyebrow={<bdi dir="ltr">{structure.code}</bdi>}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {structure.name}
            <ToneChip label={`v${current.version} · ${VERSION_TONE[current.status]?.label ?? current.status}`} tone={VERSION_TONE[current.status]?.tone ?? "neutral"} />
          </span>
        }
        description={`${structureTypeLabel(structure.type)} · ${currency}`}
        actions={
          <>
            {versions.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Version</span>
                <Select value={String(current.version)} onChange={(e) => choose(Number(e.target.value))} aria-label="Version">
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} · {VERSION_TONE[v.status]?.label ?? v.status}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {isDraft && (
              <Button variant="secondary" onClick={validate} loading={busy === "validate"} disabled={dirty} title={dirty ? "Save the draft first" : undefined} className="min-h-[44px]">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Validate
              </Button>
            )}
            {isDraft && canPublish && (
              <Button onClick={() => publishModal.openModal({ version: current.version })} disabled={dirty} title={dirty ? "Save the draft first" : undefined} className="min-h-[44px]">
                <Rocket className="h-4 w-4" aria-hidden /> Publish v{current.version}
              </Button>
            )}
            {!isDraft && canEdit && !structure.draft_version && structure.status === "ACTIVE" && (
              <Button onClick={newDraft} loading={busy === "draft"} className="min-h-[44px]">
                <CopyPlus className="h-4 w-4" aria-hidden /> Edit as new version
              </Button>
            )}
            {!isDraft && canMove && activeVersion && current.version === activeVersion.version && olderAssignments > 0 && (
              <Button variant="secondary" onClick={() => moveModal.openModal()} className="min-h-[44px]">
                <MoveRight className="h-4 w-4" aria-hidden /> Move {olderAssignments} salaries to v{activeVersion.version}
              </Button>
            )}
          </>
        }
      />
      {conflict && (
        <ConflictBanner
          message={conflict}
          onReload={() => {
            setConflict(null);
            void detail.reload();
          }}
          className="mb-4"
        />
      )}
      <ErrorSummary errors={summary} className="mb-4" />
      {report && (
        <ValidationCard report={report} />
      )}

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Lines" description="Drag to change the payslip order. Calculation order comes from what each line depends on." />
            <div className="p-5">
              <LinesEditor lines={edit.lines} onChange={(lines) => change({ lines })} components={catalogue.data ?? []} issues={lineIssues} readOnly={readOnly} currency={currency} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Details & eligibility" description="Who can be given this structure. Empty lists mean everyone." />
            <fieldset disabled={readOnly} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={edit.name} onChange={(e) => change({ name: e.target.value })} />
                </Field>
                <Field label="Description">
                  <Textarea rows={1} value={edit.description} onChange={(e) => change({ description: e.target.value })} />
                </Field>
              </div>
              <IdChips label="Legal entities" options={org.legalEntities} value={edit.eligibility.legal_entity_ids ?? []} onChange={(ids) => change({ eligibility: { ...edit.eligibility, legal_entity_ids: ids } })} />
              <IdChips label="Pay groups" options={org.payGroups} value={edit.eligibility.pay_group_ids ?? []} onChange={(ids) => change({ eligibility: { ...edit.eligibility, pay_group_ids: ids } })} />
              <IdChips label="Grades" options={org.grades} value={edit.eligibility.grade_ids ?? []} onChange={(ids) => change({ eligibility: { ...edit.eligibility, grade_ids: ids } })} />
              <IdChips label="Employment types" options={org.employmentTypes} value={edit.eligibility.employment_type_ids ?? []} onChange={(ids) => change({ eligibility: { ...edit.eligibility, employment_type_ids: ids } })} />
            </fieldset>
          </Card>

          <Card>
            <CardHeader title="Test range & vectors" description="Publishing checks the balancing line over the range and that every vector still gives its expected amounts." />
            <fieldset disabled={readOnly} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Pay basis minimum (${currency})`} error={rangeError ?? undefined}>
                  <Input dir="ltr" inputMode="decimal" value={edit.rangeMin} onChange={(e) => change({ rangeMin: e.target.value })} />
                </Field>
                <Field label={`Pay basis maximum (${currency})`}>
                  <Input dir="ltr" inputMode="decimal" value={edit.rangeMax} onChange={(e) => change({ rangeMax: e.target.value })} />
                </Field>
              </div>
              <ul className="space-y-2" aria-label="Test vectors">
                {edit.vectors.map((v, i) => {
                  const result = report?.vectors.find((r) => r.name === v.name);
                  return (
                    <li key={`${v.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                      {result ? result.passed ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Passed" /> : <XCircle className="h-4 w-4 text-danger" aria-label="Failed" /> : null}
                      <span className="font-medium">{v.name}</span>
                      <span className="text-muted-foreground">
                        at <MoneyText amount={v.pay_basis_amount} currency={currency} />
                      </span>
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {Object.entries(v.expected).map(([k, a]) => `${k}=${a}`).join(", ")}
                      </span>
                      {result && !result.passed && result.mismatches.length > 0 && (
                        <span className="w-full text-xs text-danger">
                          {result.mismatches.map((m) => `${m.component}: expected ${m.expected}, got ${m.actual ?? "nothing"}`).join("; ")}
                        </span>
                      )}
                      {!readOnly && (
                        <Button size="sm" variant="danger-ghost" className="ms-auto min-h-[44px] sm:min-h-[32px]" onClick={() => change({ vectors: edit.vectors.filter((_, n) => n !== i) })}>
                          Remove
                        </Button>
                      )}
                    </li>
                  );
                })}
                {!edit.vectors.length && <li className="text-sm text-muted-foreground">No test vectors yet.</li>}
              </ul>
              {!readOnly && (
                <div className="grid gap-3 rounded-2xl border border-dashed border-border p-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
                  <Field label="Name">
                    <Input value={vectorDraft.name} onChange={(e) => setVectorDraft((d) => ({ ...d, name: e.target.value }))} />
                  </Field>
                  <Field label="Pay basis">
                    <Input dir="ltr" inputMode="decimal" value={vectorDraft.amount} onChange={(e) => setVectorDraft((d) => ({ ...d, amount: e.target.value }))} />
                  </Field>
                  <Field label="Expected monthly amounts" hint="BASIC=50000, HRA=20000">
                    <Input dir="ltr" value={vectorDraft.expected} onChange={(e) => setVectorDraft((d) => ({ ...d, expected: e.target.value }))} />
                  </Field>
                  <Button variant="secondary" onClick={addVector} className="min-h-[44px]">
                    Add vector
                  </Button>
                </div>
              )}
            </fieldset>
          </Card>

          {!readOnly && (
            <Card className="sticky bottom-3 z-10 flex items-center justify-between gap-3 p-4 shadow-lift">
              <p className="text-sm text-muted-foreground">{dirty ? "Unsaved changes in this draft." : "All changes saved."}</p>
              <Button onClick={save} loading={busy === "save"} disabled={!dirty} className="min-h-[44px]">
                <Save className="h-4 w-4" aria-hidden /> Save draft
              </Button>
            </Card>
          )}
        </div>
        <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          <StructurePreview structureId={structure.id} version={current.version} currency={currency} type={structure.type} names={names} stale={dirty} />
        </aside>
      </div>

      <Modal
        open={publishModal.open}
        onOpenChange={publishModal.onOpenChange}
        title={`Publish version ${current.version}?`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => void publishModal.close()}>
              Cancel
            </Button>
            <Button onClick={publish} loading={busy === "publish"} disabled={!isDraft}>
              Publish v{current.version}
            </Button>
          </>
        }
      >
        {isDraft ? (
          <div className="space-y-4 text-sm">
            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
              <li>The draft is validated again; publishing stops if anything fails.</li>
              <li>Version {current.version} becomes the version new salaries use, and it can no longer be edited.</li>
              {activeVersion && (
                <li>
                  Version {activeVersion.version} is archived. The {structure.assignment_counts[String(activeVersion.version)] ?? 0} salaries on it keep it until you move them.
                </li>
              )}
            </ul>
            <Field label="Effective from" hint="Empty: today.">
              <Input type="date" value={publishFrom} onChange={(e) => setPublishFrom(e.target.value)} />
            </Field>
            {saveError && busy === null && <p role="alert" className="text-danger">{saveError}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only a draft version can be published.</p>
        )}
      </Modal>

      {activeVersion && <MoveAssignmentsModal route={moveModal} structureId={structure.id} toVersion={activeVersion.version} names={names} />}
    </div>
  );
}

function ValidationCard({ report }: { report: ValidationReport }) {
  return (
    <Card className="mb-4 p-4" role="status">
      <div className="flex flex-wrap items-center gap-3">
        {report.ok ? (
          <p className="inline-flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> Validation passed
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 font-medium text-danger">
            <XCircle className="h-5 w-5" aria-hidden /> {report.errors.length} problem{report.errors.length === 1 ? "" : "s"} to fix before publishing
          </p>
        )}
        {report.vectors.length > 0 && (
          <span className="text-sm text-muted-foreground">
            Test vectors: {report.vectors.filter((v) => v.passed).length} of {report.vectors.length} pass
          </span>
        )}
        {report.minimum_pay_basis && (
          <span className="text-sm">
            Minimum pay basis: <MoneyText money={report.minimum_pay_basis} />
          </span>
        )}
        {report.validated_at && <span className="text-xs text-muted-foreground">Checked {fmtDate(report.validated_at)}</span>}
      </div>
      {report.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-warning">
          {report.warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
