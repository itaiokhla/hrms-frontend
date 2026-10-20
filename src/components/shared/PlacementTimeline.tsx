"use client";

import { motion } from "framer-motion";
import { ArrowRightLeft } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Department } from "@/lib/types";

export interface Placement {
  id: number;
  legal_entity_id: number;
  legal_entity: string | null;
  legal_entity_code: string | null;
  currency: string | null;
  branch_id: number;
  branch: string | null;
  department_id: number | null;
  department: string | null;
  reason: string;
  note: string | null;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  is_future: boolean;
}
interface BranchOption {
  id: number;
  name: string;
  code: string;
  legal_entity_id: number;
  legal_entity_code: string | null;
  status: string;
}

const REASONS = ["TRANSFER", "PROMOTION", "DEMOTION", "REORG", "SECONDMENT_START", "SECONDMENT_END", "CORRECTION"];

/** Effective-dated placement history: legal entity, branch and department over time. */
export function PlacementTimeline({
  employeeId,
  canChange,
  onChanged,
}: {
  employeeId: number;
  canChange: boolean;
  onChanged?: () => void;
}) {
  const { data, loading, reload } = useApi(() => api.get<Placement[]>(`/employees/${employeeId}/assignments`), [employeeId]);
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Skeleton className="h-24" />;
  const current = data?.find((p) => p.is_current);
  return (
    <div className="rounded-2xl border border-border p-4" data-testid="placement-timeline">
      {data && data.length > 0 ? (
        <ol className="relative space-y-3 border-l border-border pl-4">
          {data.map((p, i) => (
            <motion.li key={p.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="text-sm">
              <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${p.is_current ? "bg-primary" : "bg-muted-foreground/40"}`} />
              <p className="flex flex-wrap items-center gap-1.5 font-medium">
                {p.legal_entity} <span className="text-muted-foreground">·</span> {p.branch}
                {p.department && <><span className="text-muted-foreground">·</span> {p.department}</>}
                <Badge tone={p.is_current ? "primary" : p.is_future ? "info" : "neutral"}>{p.reason.replace("_", " ").toLowerCase()}</Badge>
                {p.is_future && <Badge tone="info">scheduled</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(p.effective_from)} → {p.effective_to ? fmtDate(p.effective_to) : "present"}
                {p.currency && ` · paid in ${p.currency}`}
                {p.note && ` · ${p.note}`}
              </p>
            </motion.li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No placement recorded.</p>
      )}
      {canChange && current && (
        <Button size="sm" variant="subtle" className="mt-4" onClick={() => setOpen(true)} data-testid="change-placement">
          <ArrowRightLeft className="h-4 w-4" /> Change placement
        </Button>
      )}
      {current && (
        <ChangePlacementModal
          open={open}
          employeeId={employeeId}
          current={current}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function ChangePlacementModal({ open, employeeId, current, onClose, onSaved }: {
  open: boolean; employeeId: number; current: Placement; onClose: () => void; onSaved: () => void;
}) {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branchId, setBranchId] = useState<number>(current.branch_id);
  const [departmentId, setDepartmentId] = useState<number | null>(current.department_id);
  const [effective, setEffective] = useState(todayISO());
  const [reason, setReason] = useState("TRANSFER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(current.branch_id);
    setDepartmentId(current.department_id);
    setError(null);
    api.get<BranchOption[]>("/branches").then(setBranches).catch(() => setBranches([]));
    api.get<Department[]>("/departments").then(setDepartments).catch(() => setDepartments([]));
  }, [open, current]);

  const target = branches.find((b) => b.id === branchId);
  const crossEntity = target && target.legal_entity_id !== current.legal_entity_id;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/employees/${employeeId}/assignments`, {
        branch_id: branchId, legal_entity_id: target?.legal_entity_id, department_id: departmentId,
        effective_from: effective, reason, note: note || null,
      });
      toast.success("Placement changed");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} size="lg" title="Change placement"
      description="Starts a new placement on the effective date and closes the current one the day before. History is kept."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} data-testid="save-placement">Save change</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch (and legal entity)" required>
          <Select value={branchId} onChange={(e) => setBranchId(Number(e.target.value))} data-testid="placement-branch">
            {branches.filter((b) => b.status === "ACTIVE").map((b) => (
              <option key={b.id} value={b.id}>{b.name} · {b.legal_entity_code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={departmentId ?? ""} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Effective from" required>
          <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} data-testid="placement-date" />
        </Field>
        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}
          </Select>
        </Field>
        <Field label="Note" className="sm:col-span-2"><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-4 rounded-xl bg-surface-muted p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Impact</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Current placement ends the day before {fmtDate(effective)}.</li>
          {crossEntity && <li>Moves to another legal entity: payroll from this date is in that entity and its currency.</li>}
          <li>Pay periods that are already approved are never changed; the date must be after them.</li>
        </ul>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
