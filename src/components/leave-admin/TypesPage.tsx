"use client";

import { Layers, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, SearchInput, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, KIND_LABEL, type LeaveTypeV2 } from "@/lib/leave/adminTypes";
import { useModalRoute } from "@/lib/useModalRoute";

import { LeaveTypeEditor, TYPE_MODAL } from "./LeaveTypeEditor";
import { LeaveSwatch, useLeaveAccess, useLeaveTypes } from "./shared";

/** Settings › Leave › Types (03-leave/01 §11.2): the catalogue; rows open `?modal=leave-type&id=`. */
export function TypesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState(false);
  const types = useLeaveTypes(true);
  const access = useLeaveAccess();
  const canWrite = !!access.data?.manage_company;
  const modal = useModalRoute(TYPE_MODAL, { dirty });
  const editingId = modal.id && /^\d+$/.test(modal.id) ? Number(modal.id) : null;

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (types.data ?? [])
      .filter((t) => showInactive || t.is_active)
      .filter((t) => !text || t.name.toLowerCase().includes(text) || t.code.includes(text))
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [types.data, showInactive, q]);

  const columns: Column<LeaveTypeV2>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      hideable: false,
      cell: (t) => (
        <span className="flex items-center gap-2.5">
          <LeaveSwatch token={t.color_token} className="h-3 w-3" />
          <span className="min-w-0">
            <span className="block font-medium">{t.name}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">{t.code}</span>
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", cell: (t) => CATEGORY_LABEL[t.category] ?? t.category },
    { key: "unit", header: "Unit", hideOnMobile: true, cell: (t) => (t.unit === "HOUR" ? "Hours" : "Days") },
    { key: "kind", header: "Kind", hideOnMobile: true, cell: (t) => (t.kind ? KIND_LABEL[t.kind] : "—") },
    {
      key: "privacy",
      header: "Privacy",
      cell: (t) => <Badge tone={t.sensitivity === "SENSITIVE" ? "warning" : "neutral"}>{t.sensitivity === "SENSITIVE" ? "Sensitive" : "Standard"}</Badge>,
    },
    {
      key: "flags",
      header: "Balance",
      hideOnMobile: true,
      cell: (t) => (
        <span className="text-xs text-muted-foreground">
          {t.is_unlimited ? "Unlimited" : "Limited"} · {t.is_paid ? "Paid" : "Unpaid"}
          {t.allow_half_day ? " · ½ days" : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => <Badge tone={t.is_active ? "success" : "neutral"} dot>{t.is_active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title="Leave types"
        description="The kinds of leave people can take. How much, who is eligible and the request rules live in leave plans."
        actions={
          <>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showInactive} onChange={setShowInactive} label="Show inactive" />
              Show inactive
            </label>
            {canWrite && (
              <Button onClick={() => modal.openModal()} data-testid="new-leave-type">
                <Plus className="h-4 w-4" /> New leave type
              </Button>
            )}
          </>
        }
      />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or code" />
          </div>
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void types.reload()}>
            <RefreshCw className={cn("h-4 w-4", types.loading && "animate-spin")} />
          </Button>
        </div>
        {types.error && !types.data ? (
          <ErrorState message={types.error.message} onRetry={() => void types.reload()} />
        ) : (
          <DataTable
            caption="Leave types"
            columns={columns}
            rows={types.data ? rows : undefined}
            loading={types.loading && !types.data}
            busy={types.loading && !!types.data}
            rowKey={(t) => t.id}
            onRowClick={(t) => modal.openModal({ id: t.id })}
            cardBelowMd
            empty={
              <EmptyState
                icon={<Layers />}
                title={q ? "No leave types match" : "No leave types yet"}
                description="Start from a plan template (it creates the types it needs) or add a type yourself."
                action={
                  canWrite ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Link href="/settings/leave/plans?modal=new-plan" className="inline-flex min-h-[40px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                        Start from template
                      </Link>
                      <Button onClick={() => modal.openModal()}>New leave type</Button>
                    </div>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Card>
      <Modal
        open={modal.open}
        onOpenChange={modal.onOpenChange}
        size="lg"
        title={editingId ? "Edit leave type" : "New leave type"}
        description={editingId ? "Changes apply from now on; history keeps the type's code." : "Add the type, then give it rules in a leave plan."}
      >
        <LeaveTypeEditor
          key={editingId ?? "new"}
          typeId={editingId}
          canWrite={canWrite}
          onDirtyChange={setDirty}
          onCancel={() => void modal.close()}
          onSaved={() => {
            setDirty(false);
            void types.reload();
            void modal.close({ force: true });
          }}
        />
      </Modal>
    </div>
  );
}
