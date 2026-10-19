"use client";

import { motion } from "framer-motion";
import { ChevronRight, GitBranch, Pencil, ScanFace, UserMinus, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Sheet, useConfirm } from "@/components/ui/overlay";
import { Avatar, Badge, Divider, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMoney, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Employee } from "@/lib/types";
import { useSession } from "@/store/session";

export function EmployeeDrawer({
  employeeId,
  onClose,
  onEdit,
  onChanged,
}: {
  employeeId: number | null;
  onClose: () => void;
  onEdit: (e: Employee) => void;
  onChanged: () => void;
}) {
  const open = employeeId !== null;
  const { can } = useCan();
  const me = useSession((s) => s.me);
  const confirm = useConfirm();
  const { data: employee, loading, reload } = useApi(() => api.get<Employee>(`/employees/${employeeId}`), [employeeId], { enabled: open });
  const { data: chain } = useApi(
    () => api.get<{ id: number; full_name: string; position: string | null }[]>(`/org/employees/${employeeId}/chain`),
    [employeeId, employee?.manager_id],
    { enabled: open },
  );
  const { data: history } = useApi(
    () => api.get<{ manager_name: string | null; effective_from: string; effective_until: string | null }[]>(`/org/employees/${employeeId}/history`),
    [employeeId, employee?.manager_id],
    { enabled: open },
  );
  const [changingManager, setChangingManager] = useState(false);
  const [newManager, setNewManager] = useState<PickedEmployee | null>(null);
  const [busy, setBusy] = useState(false);
  const faceInput = useRef<HTMLInputElement>(null);

  const isSelf = me?.employee?.id === employeeId;

  const saveManager = async () => {
    setBusy(true);
    try {
      await api.put(`/org/employees/${employeeId}/manager`, { manager_id: newManager?.id ?? null });
      toast.success("Reporting line updated");
      setChangingManager(false);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!employee) return;
    const deactivate = employee.is_active;
    const ok = await confirm({
      title: deactivate ? `End employment for ${employee.full_name}?` : `Reactivate ${employee.full_name}?`,
      message: deactivate
        ? "Their login is closed immediately. Attendance, leave and payroll history are kept."
        : "The employee record becomes active again. Their login stays closed until an administrator restores it.",
      confirmLabel: deactivate ? "End employment" : "Reactivate",
      tone: deactivate ? "danger" : "primary",
    });
    if (!ok) return;
    try {
      await api.post(`/employees/${employee.id}/${deactivate ? "deactivate" : "reactivate"}`);
      toast.success(deactivate ? "Employment ended" : "Employee reactivated");
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const enrollFace = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      await api.post(`/face/enroll?employee_id=${employeeId}`, form);
      toast.success("Face enrolled for attendance");
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={employee?.full_name ?? "Employee"}
      description={employee ? `${employee.position || "No title"} · ${employee.employee_code}` : undefined}
      footer={
        employee && (
          <div className="flex w-full flex-wrap justify-between gap-2">
            {can(P.EMPLOYEE_DEACTIVATE) && !isSelf ? (
              <Button variant={employee.is_active ? "danger-ghost" : "subtle"} onClick={toggleActive}>
                {employee.is_active ? <><UserMinus className="h-4 w-4" /> End employment</> : <><UserPlus className="h-4 w-4" /> Reactivate</>}
              </Button>
            ) : <span />}
            {can(P.EMPLOYEE_UPDATE) && (
              <Button variant="secondary" onClick={() => onEdit(employee)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
          </div>
        )
      }
    >
      {loading && !employee && <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>}
      {employee && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar name={employee.full_name} src={employee.has_photo ? `/api/v1/employees/${employee.id}/photo` : null} size={64} />
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{employee.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge status={employee.is_active ? "active" : "deactivated"} label={employee.is_active ? "Active" : "Inactive"} />
                {employee.department && <Badge tone="primary">{employee.department}</Badge>}
                {employee.has_login ? <Badge tone="success">Has login</Badge> : <Badge>No login</Badge>}
                {employee.face_registered && <Badge tone="info"><ScanFace className="h-3 w-3" /> Face enrolled</Badge>}
              </div>
            </div>
          </div>

          <section>
            <SectionTitle>Reporting line</SectionTitle>
            <div className="rounded-2xl border border-border p-4">
              {chain && chain.length > 0 ? (
                <ol className="flex flex-wrap items-center gap-1.5 text-sm">
                  {[...chain].reverse().map((m, i) => (
                    <motion.li key={m.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-1.5">
                      <span className="rounded-lg bg-muted px-2 py-1">{m.full_name}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </motion.li>
                  ))}
                  <li className="rounded-lg bg-primary-soft px-2 py-1 font-medium text-primary">{employee.full_name}</li>
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No primary manager.</p>
              )}
              {can(P.ORG_MANAGE_HIERARCHY) && !isSelf && (
                changingManager ? (
                  <div className="mt-4 space-y-3">
                    <EmployeePicker value={newManager} onChange={setNewManager} placeholder="Choose new manager (or leave empty)" excludeIds={[employee.id]} />
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy} onClick={saveManager}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setChangingManager(false)}>Cancel</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Pending approvals move to the new manager automatically. Circular reporting is blocked.</p>
                  </div>
                ) : (
                  <Button size="sm" variant="subtle" className="mt-4" onClick={() => {
                    setNewManager(employee.manager_id ? { id: employee.manager_id, full_name: employee.manager_name ?? "" } : null);
                    setChangingManager(true);
                  }}>
                    <GitBranch className="h-4 w-4" /> Change manager
                  </Button>
                )
              )}
            </div>
          </section>

          <section>
            <SectionTitle>Employment</SectionTitle>
            <Details rows={[
              ["Joined", fmtDate(employee.hire_date)],
              ["Shift", employee.shift ?? "—"],
              ["Location", employee.location ?? "—"],
              ...(employee.termination_date ? [["Left", fmtDate(employee.termination_date)] as [string, string]] : []),
              ...(employee.base_salary !== undefined
                ? [["Base salary", fmtMoney(employee.base_salary ?? null, me?.company.currency)] as [string, string]]
                : []),
            ]} />
          </section>

          {employee.phone !== undefined && (
            <section>
              <SectionTitle>Personal details</SectionTitle>
              <Details rows={[
                ["Phone", employee.phone ?? "—"],
                ["Date of birth", fmtDate(employee.date_of_birth)],
                ["Gender", titleCase(employee.gender) || "—"],
                ["Address", [employee.address, employee.city, employee.country].filter(Boolean).join(", ") || "—"],
              ]} />
            </section>
          )}

          {history && history.length > 0 && (
            <section>
              <SectionTitle>Manager history</SectionTitle>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <p className="font-medium">{h.manager_name ?? "No manager"}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(h.effective_from)} → {h.effective_until ? fmtDate(h.effective_until) : "present"}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {can(P.FACE_ENROLL) && (
            <section>
              <SectionTitle>Face attendance</SectionTitle>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4">
                <p className="text-sm text-muted-foreground">
                  {employee.face_registered ? "A face is enrolled. Uploading replaces the primary photo." : "Upload a clear, front-facing photo to enable face check-in."}
                </p>
                <input ref={faceInput} type="file" accept="image/jpeg,image/png" className="hidden"
                  onChange={(e) => e.target.files?.[0] && enrollFace(e.target.files[0])} />
                <Button size="sm" variant="secondary" onClick={() => faceInput.current?.click()}>
                  <ScanFace className="h-4 w-4" /> {employee.face_registered ? "Replace" : "Enroll"}
                </Button>
              </div>
            </section>
          )}
          <Divider />
        </div>
      )}
    </Sheet>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</p>
);

const Details = ({ rows }: { rows: [string, string][] }) => (
  <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-border p-4 text-sm">
    {rows.map(([k, v]) => (
      <div key={k}>
        <dt className="text-xs text-muted-foreground">{k}</dt>
        <dd className="mt-0.5 font-medium">{v}</dd>
      </div>
    ))}
  </dl>
);
