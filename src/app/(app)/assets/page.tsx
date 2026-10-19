"use client";

import { motion } from "framer-motion";
import { Boxes, CheckCircle2, Laptop, PackageCheck, Plus, Undo2, UserPlus, Wrench } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DataTable, EmptyState, Pagination, PageHeader, SearchInput, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, Sheet } from "@/components/ui/overlay";
import { Badge, Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can, canBeyondSelf } from "@/lib/access";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Asset, Page } from "@/lib/types";

export default function AssetsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.ASSET_READ)}>
      <Assets />
    </RequireAccess>
  );
}

function Assets() {
  const { me } = useCan();
  const inventory = canBeyondSelf(me, P.ASSET_READ);
  const mine = !!me?.employee;
  const tabs = [...(mine ? [{ value: "mine", label: "My assets" }] : []), ...(inventory ? [{ value: "inventory", label: "Inventory" }] : [])];
  const [tab, setTab] = useState(inventory ? "inventory" : "mine");
  return (
    <div>
      <PageHeader title="Assets" description="Every company device and its custody history, from inventory to return." />
      {tabs.length > 1 ? (
        <Tabs tabs={tabs} value={tab} onValueChange={setTab}>
          <TabPanel value="mine"><MyAssets /></TabPanel>
          <TabPanel value="inventory"><Inventory /></TabPanel>
        </Tabs>
      ) : inventory ? <Inventory /> : <MyAssets />}
    </div>
  );
}

function MyAssets() {
  const { data, loading, reload } = useApi(() => api.get<Asset[]>("/assets/mine"), []);
  const acknowledge = async (a: Asset) => {
    try {
      await api.post(`/assets/${a.id}/acknowledge`);
      toast.success("Receipt acknowledged");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (loading && !data) return <Skeleton className="h-40 rounded-2xl" />;
  if (!data?.length) return <Card><EmptyState icon={<Laptop />} title="No assets assigned to you" /></Card>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((a, i) => (
        <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Laptop className="h-5 w-5" /></span>
              <Badge>{a.category}</Badge>
            </div>
            <p className="mt-3 font-semibold">{a.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{a.asset_tag}{a.serial_number ? ` · ${a.serial_number}` : ""}</p>
            <p className="mt-2 text-xs text-muted-foreground">Assigned {fmtDate(a.assignment?.assigned_at)}</p>
            {a.assignment?.acknowledged_at ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Acknowledged</p>
            ) : (
              <Button size="sm" className="mt-3" onClick={() => acknowledge(a)}><PackageCheck className="h-4 w-4" /> Acknowledge receipt</Button>
            )}
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function Inventory() {
  const { me } = useCan();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const query = useDebounced(q);
  const { data, loading, reload } = useApi(
    () => api.get<Page<Asset>>("/assets", { params: { q: query || undefined, status: status || undefined, skip, limit: 25 } }),
    [query, status, skip],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partial<Asset> | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      const body = { asset_tag: editing.asset_tag, name: editing.name, category: editing.category, serial_number: editing.serial_number || null,
        purchase_date: editing.purchase_date || null, purchase_cost: editing.purchase_cost ?? null, notes: editing.notes || null };
      if (editing.id) await api.put(`/assets/${editing.id}`, body);
      else await api.post("/assets", body);
      toast.success("Asset saved");
      setEditing(null);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={(v) => { setQ(v); setSkip(0); }} placeholder="Search tag, name or serial" className="flex-1" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} className="sm:w-44" aria-label="Status">
          <option value="">All statuses</option><option value="in_stock">In stock</option><option value="assigned">Assigned</option>
          <option value="maintenance">Maintenance</option><option value="retired">Retired</option>
        </Select>
        {can(me, P.ASSET_MANAGE) && <Button onClick={() => setEditing({ category: "IT" })}><Plus className="h-4 w-4" /> Add asset</Button>}
      </div>
      <DataTable rows={data?.items} loading={loading} rowKey={(a) => a.id} onRowClick={(a) => setSelected(a.id)}
        empty={<EmptyState icon={<Boxes />} title="No assets" description="Add laptops, phones and other equipment to track who has what." />}
        columns={[
          { key: "asset", header: "Asset", cell: (a) => <div><p className="font-medium">{a.name}</p><p className="font-mono text-xs text-muted-foreground">{a.asset_tag}</p></div> },
          { key: "cat", header: "Category", cell: (a) => a.category, hideOnMobile: true },
          { key: "holder", header: "Holder", cell: (a) => a.assignment?.employee_name ?? <span className="text-muted-foreground">—</span> },
          { key: "ack", header: "Acknowledged", hideOnMobile: true, cell: (a) => a.assignment ? (a.assignment.acknowledged_at ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">Pending</Badge>) : "—" },
          { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
        ]} />
      {data && <Pagination total={data.total} skip={skip} limit={25} onChange={setSkip} />}
      <AssetDrawer assetId={selected} onClose={() => setSelected(null)} onChanged={() => void reload()} onEdit={(a) => setEditing(a)} />
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit asset" : "Add asset"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset tag" required><Input value={editing.asset_tag ?? ""} onChange={(e) => setEditing({ ...editing, asset_tag: e.target.value })} /></Field>
            <Field label="Name" required><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Category" required><Input value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
            <Field label="Serial number"><Input value={editing.serial_number ?? ""} onChange={(e) => setEditing({ ...editing, serial_number: e.target.value })} /></Field>
            <Field label="Purchase date"><Input type="date" value={editing.purchase_date ?? ""} onChange={(e) => setEditing({ ...editing, purchase_date: e.target.value })} /></Field>
            <Field label="Purchase cost"><Input type="number" min={0} value={editing.purchase_cost ?? ""} onChange={(e) => setEditing({ ...editing, purchase_cost: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function AssetDrawer({ assetId, onClose, onChanged, onEdit }: { assetId: number | null; onClose: () => void; onChanged: () => void; onEdit: (a: Asset) => void }) {
  const { me } = useCan();
  const { data: asset, reload } = useApi(() => api.get<Asset>(`/assets/${assetId}`), [assetId], { enabled: assetId !== null });
  const [assignee, setAssignee] = useState<PickedEmployee | null>(null);
  const [condition, setCondition] = useState("good");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setAssignee(null);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={assetId !== null} onOpenChange={(o) => !o && onClose()} title={asset?.name ?? "Asset"} description={asset?.asset_tag}
      footer={asset && can(me, P.ASSET_MANAGE) && <Button variant="secondary" onClick={() => onEdit(asset)}>Edit details</Button>}>
      {!asset ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2"><StatusBadge status={asset.status} /><Badge>{asset.category}</Badge></div>
          {can(me, P.ASSET_ASSIGN) && asset.status !== "retired" && (
            <Card className="space-y-3 p-4">
              <p className="text-sm font-semibold">{asset.assignment ? "Transfer to someone else" : "Assign"}</p>
              <EmployeePicker value={assignee} onChange={setAssignee} excludeIds={asset.assignment ? [asset.assignment.employee_id] : []} />
              <Button size="sm" disabled={!assignee || asset.status === "maintenance"} loading={busy}
                onClick={() => act(() => api.post(`/assets/${asset.id}/assign`, { employee_id: assignee!.id }), asset.assignment ? "Asset transferred" : "Asset assigned")}>
                <UserPlus className="h-4 w-4" /> {asset.assignment ? "Transfer" : "Assign"}
              </Button>
              {asset.assignment && (
                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <Field label="Return condition" className="w-40">
                    <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
                      <option value="good">Good</option><option value="damaged">Damaged</option><option value="lost">Lost</option>
                    </Select>
                  </Field>
                  <Button size="sm" variant="secondary" loading={busy}
                    onClick={() => act(() => api.post(`/assets/${asset.id}/return`, { condition, status: condition === "good" ? "in_stock" : "maintenance" }), "Asset returned")}>
                    <Undo2 className="h-4 w-4" /> Recover
                  </Button>
                </div>
              )}
            </Card>
          )}
          {can(me, P.ASSET_MANAGE) && !asset.assignment && (
            <div className="flex flex-wrap gap-2">
              {asset.status !== "maintenance" && <Button size="sm" variant="secondary" onClick={() => act(() => api.put(`/assets/${asset.id}/status`, { status: "maintenance" }), "Sent to maintenance")}><Wrench className="h-4 w-4" /> Maintenance</Button>}
              {asset.status !== "in_stock" && <Button size="sm" variant="secondary" onClick={() => act(() => api.put(`/assets/${asset.id}/status`, { status: "in_stock" }), "Back in stock")}>Mark in stock</Button>}
              {asset.status !== "retired" && <Button size="sm" variant="danger-ghost" onClick={() => act(() => api.put(`/assets/${asset.id}/status`, { status: "retired" }), "Asset retired")}>Retire</Button>}
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custody history</p>
            {asset.history?.length ? (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {asset.history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <p className="font-medium">{h.employee_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDateTime(h.assigned_at)} → {h.returned_at ? `${fmtDateTime(h.returned_at)} (${h.return_condition ?? "returned"})` : "current"}
                    </p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted-foreground">Never assigned.</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
