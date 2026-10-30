"use client";

import { Send, Save, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { todayISO } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { accessHas, errorIssues, leaveApi, leaveErrorMessage, units } from "@/lib/leave/api";
import { emitLeaveChanged } from "@/lib/leave/events";
import type {
  EndPortion,
  LeaveAttachment,
  LeaveBalance,
  LeaveDetail,
  LeaveIssue,
  LeavePreview,
  LeaveRequestInput,
  LeaveTypeV2,
  StartPortion,
} from "@/lib/leave/types";

import { AttachmentUploader } from "./AttachmentUploader";
import { IssueList } from "./LeaveBits";
import { useLeaveAccess } from "./LeaveAccessContext";
import { LeavePreviewPanel } from "./LeavePreviewPanel";

type Single = "FULL" | "FIRST_HALF" | "SECOND_HALF";

interface TypeOption {
  code: string;
  name: string;
  type?: LeaveTypeV2;
  balance?: LeaveBalance;
}

function optionText(o: TypeOption): string {
  const b = o.balance;
  if (!b) return o.name;
  if (b.frozen) return `${o.name} · not in your plan`;
  if (b.unlimited) return `${o.name} · unlimited`;
  const avail = b.available ?? b.balance;
  const from = b.eligibility && b.eligibility !== "ELIGIBLE" && b.available_from ? ` · from ${b.available_from}` : "";
  return `${o.name} · ${units(avail, b.unit)} available${from}`;
}

function portionsOf(halfAllowed: boolean, same: boolean, single: Single, first: StartPortion, last: EndPortion) {
  if (!halfAllowed) return { start_portion: "FULL" as StartPortion, end_portion: "FULL" as EndPortion };
  if (same) {
    if (single === "FIRST_HALF") return { start_portion: "FULL" as StartPortion, end_portion: "FIRST_HALF" as EndPortion };
    if (single === "SECOND_HALF") return { start_portion: "SECOND_HALF" as StartPortion, end_portion: "FULL" as EndPortion };
    return { start_portion: "FULL" as StartPortion, end_portion: "FULL" as EndPortion };
  }
  return { start_portion: first, end_portion: last };
}

/**
 * Apply for leave (LH 03-leave/03 §4; 09-ui-ux/02 §5): type, dates, half days, reason (as the plan asks), emergency,
 * apply-on-behalf (`leave:apply_on_behalf`), documents, and a live debounced preview of every day, the findings and
 * the balance. "Save draft" keeps it unsent; "Submit request" sends it to the approvers. With `editId` it edits a
 * DRAFT or RETURNED request (PUT) and can resubmit it.
 */
export function ApplyLeaveForm({
  editId,
  initialType,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  editId?: number | null;
  initialType?: string | null;
  onDone: (leave: LeaveDetail) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { access, error: accessError } = useLeaveAccess();
  const myId = access?.employee_id ?? null;
  const canOnBehalf = !!access?.on_behalf_enabled && accessHas(access, "leave:apply_on_behalf");

  const { data: existing, error: loadError, loading: loadingExisting } = useApi(
    () => (editId ? leaveApi.get(editId) : Promise.resolve(undefined)),
    [editId],
  );
  const { data: existingFiles } = useApi(
    () => (editId ? leaveApi.attachments(editId) : Promise.resolve([] as LeaveAttachment[])),
    [editId],
  );

  const [who, setWho] = useState<"me" | "other">("me");
  const [person, setPerson] = useState<PickedEmployee | null>(null);
  const [type, setType] = useState<string>(initialType ?? "");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [single, setSingle] = useState<Single>("FULL");
  const [firstDay, setFirstDay] = useState<StartPortion>("FULL");
  const [lastDay, setLastDay] = useState<EndPortion>("FULL");
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [files, setFiles] = useState<LeaveAttachment[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formIssues, setFormIssues] = useState<LeaveIssue[]>([]);

  const touch = () => setTouched(true);

  // Someone without an own employee profile can only apply for others.
  useEffect(() => {
    if (access && myId === null && canOnBehalf) setWho("other");
  }, [access, myId, canOnBehalf]);

  // Default dates: the employee's local today (the browser's date only if the access facts could not load).
  useEffect(() => {
    if (start || editId || (!access && !accessError)) return;
    const today = access?.local_today ?? todayISO();
    setStart(today);
    setEnd(today);
  }, [access, accessError, start, editId]);

  // Prefill an edit once it is loaded.
  const prefilled = useRef<number | null>(null);
  useEffect(() => {
    if (!existing || prefilled.current === existing.id) return;
    prefilled.current = existing.id;
    setType(existing.leave_type);
    setStart(existing.start_date);
    setEnd(existing.end_date);
    if (existing.start_date === existing.end_date) {
      setSingle(existing.end_portion === "FIRST_HALF" ? "FIRST_HALF" : existing.start_portion === "SECOND_HALF" ? "SECOND_HALF" : "FULL");
    } else {
      setFirstDay(existing.start_portion);
      setLastDay(existing.end_portion);
    }
    setReason(existing.reason ?? "");
    setContact(existing.contact_note ?? "");
    setEmergency(existing.is_emergency);
  }, [existing]);
  useEffect(() => {
    if (existingFiles) setFiles(existingFiles);
  }, [existingFiles]);

  useEffect(() => onDirtyChange?.(touched && busy === null), [touched, busy, onDirtyChange]);

  const onBehalf = existing ? existing.employee_id !== myId : who === "other";
  const subjectId = existing ? existing.employee_id : onBehalf ? person?.id ?? null : myId;

  const { data: balances, loading: loadingBalances } = useApi(() => leaveApi.myBalances(), [], {
    enabled: !!access && myId !== null && !onBehalf,
  });
  const { data: types, error: typesError } = useApi(() => leaveApi.types(), []);

  const options = useMemo<TypeOption[]>(() => {
    const all = types ?? [];
    const byCode = new Map(all.map((t) => [t.code, t]));
    if (!onBehalf && balances?.balances.length) {
      return balances.balances
        .filter((b) => byCode.get(b.leave_type_code)?.is_active !== false)
        .map((b) => ({ code: b.leave_type_code, name: b.name, balance: b, type: byCode.get(b.leave_type_code) }));
    }
    return all.filter((t) => t.is_active).map((t) => ({ code: t.code, name: t.display_name || t.name, type: t }));
  }, [types, balances, onBehalf]);

  // Pick the first usable type once the options are known (or keep the one asked for).
  useEffect(() => {
    if (!options.length || existing) return;
    if (type && options.some((o) => o.code === type)) return;
    const first = options.find((o) => !o.balance?.frozen) ?? options[0];
    setType(first.code);
  }, [options, type, existing]);

  const selected = options.find((o) => o.code === type);
  const halfAllowed = !!access?.half_day_enabled && selected?.type?.allow_half_day === true;
  const same = !!start && start === end;
  const portions = portionsOf(halfAllowed, same, single, firstDay, lastDay);

  const body: LeaveRequestInput | null =
    type && start && end && (!onBehalf || subjectId)
      ? {
          leave_type: type,
          start_date: start,
          end_date: end,
          ...portions,
          reason: reason.trim() || null,
          is_emergency: emergency,
          attachment_ids: files.map((f) => f.id),
          contact_note: contact.trim() || null,
          ...(onBehalf && subjectId ? { employee_id: subjectId } : {}),
        }
      : null;

  /* ---------------------------------------------------------------- live preview */
  const key = body ? JSON.stringify(body) : "";
  const debouncedKey = useDebounced(key, 350);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewIssues, setPreviewIssues] = useState<LeaveIssue[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!debouncedKey) {
      setPreview(null);
      return;
    }
    const id = ++seq.current;
    setPreviewing(true);
    leaveApi
      .preview(JSON.parse(debouncedKey) as LeaveRequestInput)
      .then((p) => {
        if (id !== seq.current) return;
        setPreview(p);
        setPreviewError(null);
        setPreviewIssues([]);
      })
      .catch((e) => {
        if (id !== seq.current) return;
        setPreview(null);
        setPreviewError(leaveErrorMessage(e));
        setPreviewIssues(errorIssues(e));
      })
      .finally(() => {
        if (id === seq.current) setPreviewing(false);
      });
  }, [debouncedKey]);

  const reasonRule = preview?.reason_rule ?? "OPTIONAL";
  const reasonError = preview?.issues.find((i) => i.code === "REASON_REQUIRED" && i.severity === "ERROR")?.message;
  const fresh = !!preview && debouncedKey === key && !previewing;
  const blocking = fresh && preview!.blocking;
  const documentsAllowed = preview?.documents_allowed ?? true;
  const suggestedCategory = preview?.documents_required[0]?.category ?? null;

  /* ---------------------------------------------------------------- send */
  const send = async (mode: "draft" | "submit") => {
    if (!body) return;
    setBusy(mode);
    setFormError(null);
    setFormIssues([]);
    try {
      let result: LeaveDetail;
      if (existing) {
        result = await leaveApi.update(existing.id, body);
        if (mode === "submit") result = await leaveApi.submit(existing.id);
      } else {
        result = await leaveApi.create({ ...body, draft: mode === "draft" });
      }
      toast.success(
        mode === "draft"
          ? existing ? "Changes saved" : "Draft saved"
          : result.status_v2 === "APPROVED"
            ? "Leave approved automatically"
            : existing?.status_v2 === "RETURNED"
              ? "Request resubmitted"
              : "Leave requested. Your approvers have been notified.",
      );
      setTouched(false);
      emitLeaveChanged();
      onDone(result);
    } catch (e) {
      setFormError(leaveErrorMessage(e));
      setFormIssues(errorIssues(e));
    } finally {
      setBusy(null);
    }
  };

  if (editId && loadingExisting && !existing) return <Skeleton className="h-96 rounded-2xl" />;
  if (editId && loadError) return <p role="alert" className="text-sm text-danger">{loadError.message}</p>;
  if (access && myId === null && !canOnBehalf) {
    return <p className="text-sm text-muted-foreground">Your account is not linked to an employee profile, so you cannot apply for leave.</p>;
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      onSubmit={(e) => {
        e.preventDefault();
        void send("submit");
      }}
      data-testid="apply-leave-form"
      noValidate
    >
      <div className="space-y-4">
        {!existing && canOnBehalf && myId !== null && (
          <div data-testid="apply-for">
            <Segmented<"me" | "other">
              label="Apply for"
              value={who}
              onChange={(v) => { setWho(v); touch(); }}
              options={[{ value: "me", label: "Myself" }, { value: "other", label: "Someone else" }]}
            />
          </div>
        )}
        {!existing && onBehalf && (
          <Field label="Employee" required htmlFor="leave-employee" hint="Only people you may apply for appear.">
            <div data-testid="leave-employee">
              <EmployeePicker id="leave-employee" value={person} onChange={(p) => { setPerson(p); touch(); }} />
            </div>
          </Field>
        )}
        {existing && onBehalf && (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><UserRound className="h-4 w-4" aria-hidden /> For {existing.employee_name}</p>
        )}

        <Field label="Leave type" required error={typesError && !options.length ? typesError.message : undefined}>
          <Select
            value={type}
            onChange={(e) => { setType(e.target.value); touch(); }}
            disabled={!options.length && (loadingBalances || !types)}
            data-testid="leave-type-select"
          >
            {!options.length && <option value="">{types ? "No leave types" : "Loading…"}</option>}
            {options.map((o) => (
              <option key={o.code} value={o.code} disabled={o.balance?.frozen}>{optionText(o)}</option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" required>
            <Input
              type="date"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (v && (!end || v > end)) setEnd(v);
                touch();
              }}
              data-testid="leave-start"
            />
          </Field>
          <Field label="To" required>
            <Input type="date" value={end} min={start || undefined} onChange={(e) => { setEnd(e.target.value); touch(); }} data-testid="leave-end" />
          </Field>
        </div>

        {halfAllowed && same && (
          <div data-testid="leave-portion-single">
            <Segmented<Single>
              label="Day"
              value={single}
              onChange={(v) => { setSingle(v); touch(); }}
              options={[{ value: "FULL", label: "Full day" }, { value: "FIRST_HALF", label: "First half" }, { value: "SECOND_HALF", label: "Second half" }]}
            />
          </div>
        )}
        {halfAllowed && !same && start && end && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-testid="leave-portion-start">
              <Segmented<StartPortion>
                label="First day"
                value={firstDay}
                onChange={(v) => { setFirstDay(v); touch(); }}
                options={[{ value: "FULL", label: "Full day" }, { value: "SECOND_HALF", label: "Second half" }]}
              />
            </div>
            <div data-testid="leave-portion-end">
              <Segmented<EndPortion>
                label="Last day"
                value={lastDay}
                onChange={(v) => { setLastDay(v); touch(); }}
                options={[{ value: "FULL", label: "Full day" }, { value: "FIRST_HALF", label: "First half" }]}
              />
            </div>
          </div>
        )}

        {reasonRule !== "HIDDEN" && (
          <Field
            label="Reason"
            required={reasonRule === "REQUIRED"}
            error={touched ? reasonError : undefined}
            hint={reasonRule === "REQUIRED" ? "Required for this leave type." : "Optional, visible to your approvers."}
          >
            <Textarea value={reason} maxLength={1000} onChange={(e) => { setReason(e.target.value); touch(); }} data-testid="leave-reason" />
          </Field>
        )}

        <Field label="Contact while away" hint="Optional: how to reach you if something urgent comes up.">
          <Input value={contact} maxLength={500} onChange={(e) => { setContact(e.target.value); touch(); }} data-testid="leave-contact" />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={emergency}
            onChange={(e) => { setEmergency(e.target.checked); touch(); }}
            className="mt-0.5 h-4 w-4 accent-primary"
            data-testid="leave-emergency"
          />
          <span>
            <span className="font-medium">This is an emergency</span>
            <span className="block text-xs text-muted-foreground">Short-notice leave your plan allows in emergencies; a reason may be required.</span>
          </span>
        </label>

        {documentsAllowed && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-foreground/90">Documents</p>
            <AttachmentUploader
              attachments={files}
              leaveId={existing?.id ?? null}
              employeeId={!existing && onBehalf ? subjectId : null}
              suggestedCategory={suggestedCategory}
              disabled={onBehalf && !subjectId}
              onUploaded={(a) => { setFiles((f) => [...f, a]); touch(); }}
              onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))}
            />
          </div>
        )}

        {(formError || formIssues.length > 0) && (
          <div className="space-y-2" data-testid="apply-error">
            {formError && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>}
            <IssueList issues={formIssues.filter((i) => i.severity === "ERROR")} testId="apply-error-issues" />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={busy !== null}>Cancel</Button>
          <Button variant="secondary" loading={busy === "draft"} disabled={!body || busy !== null} onClick={() => void send("draft")} data-testid="leave-save-draft">
            <Save className="h-4 w-4" aria-hidden /> {existing ? "Save changes" : "Save draft"}
          </Button>
          <Button type="submit" loading={busy === "submit"} disabled={!body || busy !== null || blocking} data-testid="leave-submit">
            <Send className="h-4 w-4" aria-hidden /> {existing ? (existing.status_v2 === "RETURNED" ? "Save and resubmit" : "Save and submit") : "Submit request"}
          </Button>
        </div>
        {blocking && <p className="text-end text-xs text-muted-foreground">Fix the problems in the preview to submit, or save a draft.</p>}
      </div>

      <div className="lg:sticky lg:top-0 lg:self-start">
        <LeavePreviewPanel preview={preview} loading={previewing} error={previewError} errorIssues={previewIssues} />
      </div>
    </form>
  );
}
