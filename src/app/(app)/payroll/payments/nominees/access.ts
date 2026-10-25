import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

/** Nominees of a deceased employee's final settlement: bank-details staff beyond SELF (read, edit or approve). */
export const NOMINEE_CODES = [P.PAYROLL_BANK_DETAILS_READ_MASKED, P.PAYROLL_BANK_DETAILS_EDIT, P.PAYROLL_BANK_DETAILS_APPROVE];

export const canSeeNominees = (me: Me | null) => NOMINEE_CODES.some((code) => canBeyondSelf(me, code));
