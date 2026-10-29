"use client";

import { motion } from "framer-motion";
import { Lock, Plus, Unlock } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { api, toApiError } from "@/lib/api";
import { can } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

interface PeriodClose {
  id: number;
  legal_entity_id: number;
  branch_id: number | null;
  cycle_start: string;
  cycle_end: string;
  status: "OPEN" | "CLOSED" | "REOPENED";
  open_exception_count: number;
  closed_at: string | null;
  reopen_reason: string | null;
}

/** Attendance period close (AS 04-attendance/04 §14.3): close a cycle for self-service; reopen needs step-up. */
export default function PeriodClosePage() {
  return (
    <RequireAccess check={(me) => can(me, P.ATTENDANCE_CLOSE_PERIOD)}>
      <PeriodCloses />
    </RequireAccess>
  );
}

function PeriodCloses() {
  const { data, loading, reload } = useApi(() => api.get<{ items: PeriodClose[] }>("/attendance/period-closes"), []);
  const entities = useApi(() => api.get<{ id: number; legal_name: string; code: string }[]>("/legal-entities"), []);
  const [creating, setCreating] = useState(false);
  const [entity, setEntity] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [closing, setClosing] = useState<PeriodClose | null>(null);
  const [openItems, setOpenItems] = useState<number | null>(null);
  const [reopening, setReopening] = useState<PeriodClose | null>(null);
  const [reason, setReason] = useState("");

  const create = async () => {
    try {
      await api.post("/attendance/period-closes", { legal_entity_id: Number(entity), cycle_start: start, cycle_end: end });
      toast.success("Cycle added");
      setCreating(false);
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };

  const close = async (row: PeriodClose, acknowledge = false) => {
    try {
      await api.post(`/attendance/period-closes/${row.id}/close`, { acknowledge_open_items: acknowledge });
      toast.success("Attendance cycle closed");
      setClosing(null);
      setOpenItems(null);
      await reload();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "OPEN_ITEMS") {
        setClosing(row);
        setOpenItems(Number((err.details as { total?: number } | undefined)?.total ?? 0));
      } else {
        toast.error(err.message);
      }
    }
  };

  const reopen = async () => {
    if (!reopening) return;
    try {
      await api.post(`/attendance/period-closes/${reopening.id}/reopen`, { reason });
      toast.success("Cycle reopened");
      setReopening(null);
      setReason("");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };

  const name = (id: number) => entities.data?.find((x) => x.id === id)?.legal_name ?? `#${id}`;
  return (
    <div>
      <PageHeader title="Attendance period close" description="Close a reviewed cycle so employees can no longer file requests for it. HR corrections stay possible."
        actions={<Button data-testid="pc-new" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add cycle</Button>} />
      <Card>
        <DataTable rows={data?.items} loading={loading && !data} rowKey={(r) => r.id}
          empty={<EmptyState icon={<Lock />} title="No cycles yet" description="Add a cycle to close it after review." />}
          columns={[
            { key: "entity", header: "Legal entity", cell: (r) => name(r.legal_entity_id) },
            { key: "cycle", header: "Cycle", cell: (r) => `${fmtDate(r.cycle_start, "d MMM")} – ${fmtDate(r.cycle_end, "d MMM yyyy")}` },
            { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "CLOSED" ? "danger" : "success"} dot>
              <span data-testid={`pc-status-${r.id}`}>{r.status.toLowerCase()}</span></Badge> },
            { key: "open", header: "Open items at close", cell: (r) => r.closed_at ? r.open_exception_count : "—" },
            { key: "act", header: "", cell: (r) => r.status === "CLOSED"
              ? <Button size="sm" variant="ghost" data-testid={`pc-reopen-${r.id}`} onClick={() => setReopening(r)}><Unlock className="h-4 w-4" /> Reopen</Button>
              : <Button size="sm" variant="subtle" data-testid={`pc-close-${r.id}`} onClick={() => void close(r)}><Lock className="h-4 w-4" /> Close</Button> },
          ]} />
      </Card>
      <Modal open={creating} onOpenChange={setCreating} title="Add attendance cycle"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          <Button data-testid="pc-create" disabled={!entity || !start || !end} onClick={create}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Legal entity" required>
            <Select data-testid="pc-entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Choose…</option>
              {(entities.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.legal_name || x.code}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cycle start" required><Input data-testid="pc-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Cycle end" required><Input data-testid="pc-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        </div>
      </Modal>
      <Modal open={closing !== null} onOpenChange={(o) => !o && setClosing(null)} title="Close with open items?"
        description={`${openItems ?? 0} request(s) or on-duty day(s) of this cycle are still waiting. They stay decidable after the close.`}
        footer={<><Button variant="secondary" onClick={() => setClosing(null)}>Cancel</Button>
          <Button variant="danger" data-testid="pc-ack" onClick={() => closing && void close(closing, true)}>Close anyway</Button></>}>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted-foreground">Employees will no longer file their own requests for these dates.</motion.p>
      </Modal>
      <Modal open={reopening !== null} onOpenChange={(o) => !o && setReopening(null)} title="Reopen cycle"
        description="Employees regain self-service. You may be asked to confirm it is you."
        footer={<><Button variant="secondary" onClick={() => setReopening(null)}>Cancel</Button>
          <Button data-testid="pc-reopen-confirm" disabled={reason.trim().length < 5} onClick={() => void reopen()}>Reopen</Button></>}>
        <Field label="Reason" required><Textarea data-testid="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
