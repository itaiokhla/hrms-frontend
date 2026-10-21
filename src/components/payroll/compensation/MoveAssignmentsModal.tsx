"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { DiffView } from "@/components/payroll/DiffView";
import { MoneyText } from "@/components/payroll/MoneyText";
import type { ModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api";

import { compensationApi } from "./api";
import { todayIso } from "./format";
import type { MovePreviewResult } from "./types";

/**
 * Move salaries on older versions of a structure to the published version (EC-CMP-17): a dry run
 * shows each salary before and after; committing proposes one change per employee for approval.
 * Deep link: ?modal=move. Full page: the structure page.
 */
export function MoveAssignmentsModal({ route, structureId, toVersion, names }: { route: ModalRoute; structureId: number; toVersion: number; names: Record<string, string> }) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<MovePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  const dryRun = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await compensationApi.moveAssignments(structureId, { to_version: toVersion, effective_from: effectiveFrom, dry_run: true }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy("commit");
    setError(null);
    try {
      const result = await compensationApi.moveAssignments(structureId, { to_version: toVersion, effective_from: effectiveFrom, dry_run: false, note: note.trim() || undefined, assignment_ids: preview.items.map((i) => i.assignment_id!).filter(Boolean) });
      toast.success(`${result.count} salary change${result.count === 1 ? "" : "s"} sent for approval.`);
      await route.close();
      setPreview(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      title={`Move salaries to version ${toVersion}`}
      description="Each employee keeps their pay basis amount and overrides; the new version decides the breakdown. Every move goes for approval."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => void route.close()}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={commit} loading={busy === "commit"} disabled={!preview.count}>
              Send {preview.count} for approval
            </Button>
          ) : (
            <Button onClick={dryRun} loading={busy === "preview"}>
              Preview the move
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from" required>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => {
                setEffectiveFrom(e.target.value);
                setPreview(null);
              }}
            />
          </Field>
          <Field label="Approval note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Moved to version ${toVersion}`} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {preview && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{preview.count ? `${preview.count} salaries would move.` : "No salaries in your scope are on older versions."}</p>
            <ul className="space-y-3">
              {preview.items.slice(0, 50).map((item) => (
                <li key={item.assignment_id ?? item.employee_id} className="rounded-2xl border border-border p-3">
                  <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link href={`/payroll/compensation/${item.employee_id}`} className="font-medium text-primary hover:underline">
                      Employee #{item.employee_id}
                    </Link>
                    <span className="text-muted-foreground">
                      v{item.structure_before?.version} → v{item.structure_after.version} · pay basis <MoneyText money={item.pay_basis.after} />
                    </span>
                  </p>
                  <DiffView
                    caption={`Monthly amounts for employee ${item.employee_id}`}
                    rows={item.lines
                      .filter((l) => l.before_monthly?.amount !== l.after_monthly?.amount)
                      .map((l) => ({
                        key: l.component,
                        label: names[l.component] ?? l.component,
                        before: l.before_monthly ? <MoneyText money={l.before_monthly} /> : null,
                        after: l.after_monthly ? <MoneyText money={l.after_monthly} /> : null,
                        kind: !l.before_monthly ? "added" : !l.after_monthly ? "removed" : "changed",
                      }))}
                  />
                </li>
              ))}
            </ul>
            {preview.items.length > 50 && <p className="text-xs text-muted-foreground">Showing the first 50 of {preview.items.length}.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
