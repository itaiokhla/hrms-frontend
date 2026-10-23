"use client";

import { createContext, useContext } from "react";

import { can } from "@/lib/access";
import { RUN_FINALIZED_STATES } from "@/lib/payroll/catalogues.generated";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import type { ApprovalRequestDetail, Run } from "./types";

/* State lists mirrored from hrms-backend services/runs.py and services/review.py (UI hints only; the API decides). */
export const FULL_HOLD_STATES = ["DRAFT", "INPUTS_PENDING", "READY", "CALCULATED", "VALIDATION_FAILED", "REVIEW_REQUIRED", "REJECTED", "REOPENED_FOR_CORRECTION"];
export const PAYMENT_HOLD_STATES = [...FULL_HOLD_STATES, "APPROVAL_PENDING", "APPROVED", "FINALIZED", "PAYMENT_READY"];
export const RESOLVABLE_STATES = ["DRAFT", "INPUTS_PENDING", "READY", "CALCULATED", "VALIDATION_FAILED", "REVIEW_REQUIRED", "APPROVAL_PENDING", "APPROVED", "REJECTED", "REOPENED_FOR_CORRECTION"];
export const ACKNOWLEDGE_STATES = ["REVIEW_REQUIRED", "VALIDATION_FAILED", "REJECTED"];

export const isFinalized = (status: string) => RUN_FINALIZED_STATES.includes(status);

export interface RunContextValue {
  run: Run;
  me: Me | null;
  approval: ApprovalRequestDetail | null;
  /** Reload the run and every tab. */
  reload: () => void;
  /** Bumped on every reload: tabs refetch when it changes. */
  version: number;
  /** POST runs/{id}/calculate (employee ids = recalculate those employees only). */
  startCalculation: (employeeIds?: number[]) => Promise<void>;
  calculating: boolean;
}

export const RunContext = createContext<RunContextValue | null>(null);

export function useRun(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRun outside RunContext");
  return value;
}

export const hasAction = (run: Run, ...actions: string[]) => actions.some((a) => run.available_actions.includes(a));

/** Holds: payroll:run:review before finalization, payroll:payment:approve after (services/runs._hold_permission). */
export function canHold(me: Me | null | undefined, run: Run, type: "PAYMENT" | "FULL" = "PAYMENT"): boolean {
  const permission = isFinalized(run.status) ? can(me, P.PAYROLL_PAYMENT_APPROVE) : can(me, P.PAYROLL_RUN_REVIEW);
  const states = type === "FULL" ? FULL_HOLD_STATES : PAYMENT_HOLD_STATES;
  return permission && states.includes(run.status);
}

export function canRelease(me: Me | null | undefined, run: Run): boolean {
  const permission = isFinalized(run.status) ? can(me, P.PAYROLL_PAYMENT_APPROVE) : can(me, P.PAYROLL_RUN_REVIEW);
  return permission && !["CANCELLED", "CLOSED", "CALCULATING"].includes(run.status);
}

/** Waive / defer / fix exceptions: payroll:run:create, while the run can still change. */
export function canResolveExceptions(me: Me | null | undefined, run: Run): boolean {
  return can(me, P.PAYROLL_RUN_CREATE) && RESOLVABLE_STATES.includes(run.status);
}

/**
 * Reversal (corrections, services/reversals.request_reversal): payroll:run:reverse plus the rights to
 * prepare a correction run (create + calculate), on a finalized run that is not itself a reversal.
 * The state machine has no REVERSE action, so this is not in `available_actions`.
 */
export function canRequestReversal(me: Me | null | undefined, run: Run): boolean {
  return (
    can(me, P.PAYROLL_RUN_REVERSE) &&
    can(me, P.PAYROLL_RUN_CREATE) &&
    can(me, P.PAYROLL_RUN_CALCULATE) &&
    isFinalized(run.status) &&
    run.run_type !== "REVERSAL"
  );
}

/** Approving a reversal: payroll:run:approve (the API also refuses the requester and the first approver). */
export function canApproveReversal(me: Me | null | undefined, run: Run): boolean {
  return can(me, P.PAYROLL_RUN_APPROVE) && isFinalized(run.status);
}

export function canAcknowledge(me: Me | null | undefined, run: Run): boolean {
  return can(me, P.PAYROLL_RUN_REVIEW) && ACKNOWLEDGE_STATES.includes(run.status);
}
