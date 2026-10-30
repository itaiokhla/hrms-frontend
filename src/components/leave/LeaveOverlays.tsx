"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/overlay";
import { useModalRoute, type ModalRoute } from "@/lib/useModalRoute";

import { ApplyLeaveForm } from "./ApplyLeaveForm";
import { LeaveRequestDrawer } from "./LeaveRequestDrawer";

export const APPLY_KEYS = ["edit", "type"];

interface Overlays {
  /** `?modal=apply-leave` (optionally with a pre-selected type). */
  openApply: (params?: { type?: string }) => void;
  /** `?modal=apply-leave&edit=<id>`: edit a DRAFT or RETURNED request. */
  openEdit: (id: number) => void;
  /** `?modal=leave&id=<id>`: the request drawer. */
  openLeave: (id: number) => void;
}

const Ctx = createContext<Overlays | null>(null);

/** The apply dialog as a deep-linkable modal (`?modal=apply-leave`, `&edit=<id>` for drafts and returned requests). */
export function ApplyLeaveModal({ route, onDirtyChange }: { route: ModalRoute; onDirtyChange: (dirty: boolean) => void }) {
  const edit = route.param("edit");
  const editId = edit && /^\d+$/.test(edit) ? Number(edit) : null;
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="xl"
      title={editId ? "Edit leave request" : "Apply for leave"}
      description={editId ? "Change the request, then save it or send it again." : "The preview shows each day, your balance and anything your plan asks for."}
    >
      {route.open && (
        <ApplyLeaveForm
          key={editId ?? "new"}
          editId={editId}
          initialType={route.param("type")}
          onDirtyChange={onDirtyChange}
          onCancel={() => void route.close()}
          onDone={() => {
            onDirtyChange(false);
            void route.close({ force: true });
          }}
        />
      )}
    </Modal>
  );
}

/**
 * One owner of the two leave overlays per page, so the button that opens a modal and the modal itself share the same
 * route (Back closes what this tab opened instead of leaving a duplicate history entry).
 */
export function LeaveOverlaysProvider({ children, apply = true }: { children: ReactNode; apply?: boolean }) {
  const [dirty, setDirty] = useState(false);
  const applyRoute = useModalRoute("apply-leave", { keys: APPLY_KEYS, dirty });
  const leaveRoute = useModalRoute("leave", { keys: ["id"] });
  const openApplyModal = applyRoute.openModal;
  const openLeaveModal = leaveRoute.openModal;
  const value = useMemo<Overlays>(
    () => ({
      openApply: (params = {}) => openApplyModal(params),
      openEdit: (id) => openApplyModal({ edit: id }),
      openLeave: (id) => openLeaveModal({ id }),
    }),
    [openApplyModal, openLeaveModal],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {apply && <ApplyLeaveModal route={applyRoute} onDirtyChange={setDirty} />}
      <LeaveRequestDrawer route={leaveRoute} onEdit={(id) => openApplyModal({ edit: id })} />
    </Ctx.Provider>
  );
}

/** Open the leave overlays; outside a provider it drives the URL itself. */
export function useLeaveOverlays(): Overlays {
  const ctx = useContext(Ctx);
  const applyRoute = useModalRoute("apply-leave", { keys: APPLY_KEYS });
  const leaveRoute = useModalRoute("leave", { keys: ["id"] });
  return (
    ctx ?? {
      openApply: (params = {}) => applyRoute.openModal(params),
      openEdit: (id) => applyRoute.openModal({ edit: id }),
      openLeave: (id) => leaveRoute.openModal({ id }),
    }
  );
}
