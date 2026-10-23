"use client";

import { useCan } from "@/components/access/Can";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";

import { meApi } from "./api";
import type { PayrollPreferences } from "./types";

export interface PreferencesState {
  /** The resolved settings; undefined while loading or when they could not be read. */
  prefs: PayrollPreferences | undefined;
  loading: boolean;
  /** True when the request failed for a reason other than "no employee record" (404). */
  failed: boolean;
  reload: () => unknown;
}

/**
 * GET /me/payroll/preferences for the signed-in employee (never another employee: the API has no id).
 * Callers degrade honestly: a feature that depends on a setting is shown only when the setting says so,
 * and a failed request is reported as "couldn't be checked", never replaced by a guessed default.
 */
export function usePayrollPreferences(): PreferencesState {
  const { me } = useCan();
  const enabled = !!me?.employee;
  const { data, error, loading, reload } = useApi(() => meApi.preferences(), [me?.employee?.id], { enabled });
  return {
    prefs: data,
    loading: enabled && loading && !data,
    failed: !!error && !(error instanceof ApiError && error.status === 404),
    reload,
  };
}

/** Payslip questions are offered only when the employer's setting resolved to true for this employee. */
export function questionsEnabled(prefs: PayrollPreferences | undefined): boolean {
  return prefs?.payslip.queries_enabled === true;
}

/**
 * "Set document password" applies only when payslip PDFs are protected with the employee's own secret.
 * When the preferences could not be read the option stays available (with neutral copy) rather than
 * locking someone out of a password their employer may require.
 */
export function passwordApplies(state: Pick<PreferencesState, "prefs" | "failed">): boolean {
  if (state.prefs) return state.prefs.payslip.pdf_protection === "EMPLOYEE_SECRET";
  return state.failed;
}
