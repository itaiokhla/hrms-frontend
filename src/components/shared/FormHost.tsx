"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Modal, Sheet, useConfirm } from "@/components/ui/overlay";
import { useModalRoute } from "@/lib/useModalRoute";

/**
 * The same-form rule (X 04 §4; D-X-12): one `XForm` per entity, three frames. `FormHost` owns the frame — Modal for
 * create (`?modal=<key>`), right-side Sheet for view and edit (`?modal=<key>&id=<id>`, edit swaps the body with
 * `mode=edit`, never a second overlay), the page twin (`FormPage`) — plus the dirty guard, the Idempotency-Key of
 * the open form, focus and the success transitions. The form itself knows nothing about its frame.
 */
export type FormVariant = "modal" | "sheet" | "page";
export type FormMode = "create" | "view" | "edit";

export interface FormRenderProps {
  /** The `<form id>` the frame's submit button targets (`form={formId}`). */
  formId: string;
  mode: Exclude<FormMode, "view">;
  variant: FormVariant;
  /** The record id in edit mode. */
  id: string | null;
  /** One key per open form; renewed after a success or a payload change (LH DR-38). */
  idempotencyKey: string;
  renewKey: () => void;
  setDirty: (dirty: boolean) => void;
  setSubmitting: (submitting: boolean) => void;
  /** Call after a successful create / save; for a create pass the new record's id. */
  onSuccess: (result?: { id?: number | string }) => void;
}

const DISCARD = { title: "Discard changes?", message: "Your changes in this form haven't been saved.",
  confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" as const };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export interface FormHostProps {
  /** Overlay key (`?modal=<formKey>`), e.g. "shift". */
  formKey: string;
  /** Object name for titles and toasts ("Shift" → "New shift", "Shift created."). */
  objectName: string;
  /** Sheet title of an existing record (stable for e2e, X 04 §3.2). */
  recordTitle?: (id: string) => string;
  createTitle?: string;
  submitLabel?: { create?: string; edit?: string };
  size?: "sm" | "md" | "lg" | "xl";
  width?: string;
  /** Configuration objects open their new Sheet after a create; requests close and refresh (X 04 §4.2). */
  afterCreate?: "sheet" | "close";
  /** Read-only view of a record (facts as text, never disabled inputs). */
  renderView?: (id: string, controls: { edit: () => void }) => ReactNode;
  /** The entity's XForm. */
  renderForm: (props: FormRenderProps) => ReactNode;
  /** Extra footer actions in view mode (from the record's allowed_actions). */
  viewActions?: (id: string) => ReactNode;
  /** May the viewer edit this record (from allowed_actions)? Shows "Edit". */
  canEdit?: (id: string) => boolean;
  /** Non-modal Sheet on wide list hosts (X 04 §3.6); edit always turns modal. */
  nonModalView?: boolean;
  onChanged?: () => void;
}

export function FormHost({ formKey, objectName, recordTitle, createTitle, submitLabel, size = "lg", width = "max-w-xl",
  afterCreate = "sheet", renderView, renderForm, viewActions, canEdit, nonModalView, onChanged }: FormHostProps) {
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const route = useModalRoute(formKey, { keys: ["id", "mode", "pane"], dirty });
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const confirm = useConfirm();
  const id = route.id;
  const mode: FormMode = id ? (route.param("mode") === "edit" ? "edit" : "view") : "create";
  const [key, setKey] = useState(newKey);
  const openedAt = useRef<string | null>(null);

  // A new open (different subject or mode) gets a fresh key and a clean form.
  const signature = route.open ? `${id ?? "new"}:${mode}` : null;
  useEffect(() => {
    if (signature && signature !== openedAt.current) {
      openedAt.current = signature;
      setKey(newKey());
      setDirty(false);
    }
    if (!signature) openedAt.current = null;
  }, [signature]);

  const replaceParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(search?.toString() ?? "");
    mutate(next);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [router, pathname, search]);

  const toEdit = useCallback(() => replaceParams((p) => p.set("mode", "edit")), [replaceParams]);
  const toView = useCallback(async () => {
    if (dirty && !(await confirm(DISCARD))) return;
    setDirty(false);
    replaceParams((p) => p.delete("mode"));
  }, [dirty, confirm, replaceParams]);

  const onSuccess = useCallback((result?: { id?: number | string }) => {
    setDirty(false);
    setKey(newKey());
    onChanged?.();
    if (mode === "create") {
      toast.success(`${objectName} created.`);
      if (afterCreate === "sheet" && result?.id !== undefined) {
        // The create URL entry is replaced, so Back from the Sheet returns to the list (X-UI-09).
        replaceParams((p) => {
          p.set("modal", formKey);
          p.set("id", String(result.id));
          p.delete("mode");
        });
      } else {
        void route.close();
      }
      return;
    }
    toast.success("Saved.");
    replaceParams((p) => p.delete("mode"));
  }, [mode, objectName, afterCreate, replaceParams, formKey, route, onChanged]);

  const formId = `${formKey}-form`;
  const props = useMemo<FormRenderProps>(() => ({
    formId, mode: mode === "view" ? "edit" : mode, variant: mode === "create" ? "modal" : "sheet", id,
    idempotencyKey: key, renewKey: () => setKey(newKey()), setDirty, setSubmitting, onSuccess,
  }), [formId, mode, id, key, onSuccess]);

  if (!route.open) return null;
  const primary = mode === "create" ? submitLabel?.create ?? `Create ${objectName.toLowerCase()}` : submitLabel?.edit ?? "Save";

  if (mode === "create") {
    return (
      <Modal open onOpenChange={route.onOpenChange} size={size} title={createTitle ?? `New ${objectName.toLowerCase()}`}
        footer={<>
          <Button variant="secondary" onClick={() => void route.close()}>Cancel</Button>
          <Button type="submit" form={formId} loading={submitting}>{primary}</Button>
        </>}>
        {renderForm(props)}
      </Modal>
    );
  }
  const title = recordTitle ? recordTitle(id!) : objectName;
  return (
    <Sheet open onOpenChange={route.onOpenChange} width={width} title={mode === "edit" ? `Editing ${title}` : title}
      modal={mode === "edit" || !nonModalView}
      footer={mode === "edit" ? <>
        <Button variant="secondary" onClick={() => void toView()}>Cancel</Button>
        <Button type="submit" form={formId} loading={submitting}>{primary}</Button>
      </> : <>
        {viewActions?.(id!)}
        {(canEdit?.(id!) ?? true) && <Button variant="secondary" onClick={toEdit}>Edit</Button>}
      </>}>
      {mode === "edit" ? renderForm(props) : renderView?.(id!, { edit: toEdit })}
    </Sheet>
  );
}

/** The page twin of a record (X 04 §4.2 `page`): the same XForm with `variant="page"` and a sticky saved bar. */
export function FormPage({ formKey, title, renderForm, submitLabel = "Save changes" }: {
  formKey: string;
  title: string;
  renderForm: (props: FormRenderProps) => ReactNode;
  submitLabel?: string;
}) {
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const formId = `${formKey}-page-form`;
  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold">{title}</h1>
      {renderForm({
        formId, mode: "edit", variant: "page", id: null, idempotencyKey: key, renewKey: () => setKey(newKey()), setDirty,
        setSubmitting, onSuccess: () => {
          setDirty(false);
          setKey(newKey());
          setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        },
      })}
      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <span className="text-sm text-muted-foreground" role="status">
          {dirty ? "Unsaved changes" : savedAt ? `All changes saved ${savedAt}` : ""}
        </span>
        <Button type="submit" form={formId} loading={submitting} disabled={!dirty}>{submitLabel}</Button>
      </div>
    </div>
  );
}
