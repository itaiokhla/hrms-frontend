import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

/** Payroll staff who see bank details (any of the payroll:bank_details:* codes beyond SELF). */
export const BANK_VIEW_CODES = [P.PAYROLL_BANK_DETAILS_READ_MASKED, P.PAYROLL_BANK_DETAILS_EDIT, P.PAYROLL_BANK_DETAILS_APPROVE, P.PAYROLL_BANK_DETAILS_READ_FULL];

export const canSeeBankDetails = (me: Me | null) => BANK_VIEW_CODES.some((code) => canBeyondSelf(me, code));
