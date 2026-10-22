import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

/** Payment staff: any payroll:payment:* code beyond SELF (the menu uses the same rule). */
export const canSeePayments = (me: Me | null) =>
  [P.PAYROLL_PAYMENT_PREPARE, P.PAYROLL_PAYMENT_APPROVE, P.PAYROLL_PAYMENT_SUBMIT, P.PAYROLL_PAYMENT_RECONCILE].some((code) => canBeyondSelf(me, code));

export const canPrepare = (me: Me | null) => canBeyondSelf(me, P.PAYROLL_PAYMENT_PREPARE);
export const canReconcile = (me: Me | null) => canBeyondSelf(me, P.PAYROLL_PAYMENT_RECONCILE);
export const canManageFunding = (me: Me | null) => canBeyondSelf(me, P.PAYROLL_FUNDING_ACCOUNTS_MANAGE);
