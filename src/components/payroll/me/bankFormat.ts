/**
 * Live format checks for bank details, mirroring hrms-backend/app/payroll/banking/validators.py
 * (3.7 §2.3) so people see problems while typing. The server repeats every check on submit and is the
 * only authority; a valid format proves the format only, never that the account belongs to you.
 */

export type RuleSet = "IN" | "AE" | "SA" | "GB" | "US" | "SEPA" | "INTERNATIONAL";

export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22,
  CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22,
  GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20,
  MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

const IBAN_TERRITORIES: Record<string, string> = {
  AX: "FI", BL: "FR", GF: "FR", GP: "FR", MF: "FR", MQ: "FR", NC: "FR", PF: "FR", PM: "FR", RE: "FR", TF: "FR",
  WF: "FR", YT: "FR", GG: "GB", IM: "GB", JE: "GB",
};

const SEPA = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "IS", "LI", "NO", "CH", "GB", "MC", "SM", "VA", "AD", "GI", "AX", "BL", "GF",
  "GP", "MF", "MQ", "PM", "RE", "YT", "GG", "IM", "JE",
]);

const RULE_SET_BY_COUNTRY: Record<string, RuleSet> = {
  IN: "IN", AE: "AE", SA: "SA", GB: "GB", GG: "GB", IM: "GB", JE: "GB",
  US: "US", AS: "US", GU: "US", MP: "US", PR: "US", UM: "US", VI: "US",
};

const BBAN: Record<string, RegExp> = {
  AE: /^[0-9]{3}[0-9]{16}$/,
  SA: /^[0-9]{2}[A-Z0-9]{18}$/,
  GB: /^[A-Z]{4}[0-9]{6}[0-9]{8}$/,
};

const ABA_PREFIXES = new Set<number>([
  ...Array.from({ length: 12 }, (_, i) => i + 1),
  ...Array.from({ length: 12 }, (_, i) => i + 21),
  ...Array.from({ length: 12 }, (_, i) => i + 61),
]);

/** Countries offered in the form: every IBAN country plus common payroll countries without IBANs. */
export const BANK_COUNTRIES: string[] = Array.from(
  new Set([...Object.keys(IBAN_LENGTHS), "IN", "US", "AU", "CA", "SG", "MY", "PH", "ID", "LK", "BD", "NP", "NG", "KE", "ZA", "JP", "CN", "HK", "NZ", "MX", "TH", "VN"]),
).sort();

export function countryName(code: string, locale?: string): string {
  try {
    const names = new Intl.DisplayNames([locale || "en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function ruleSet(country: string): RuleSet {
  const c = (country || "").toUpperCase();
  return RULE_SET_BY_COUNTRY[c] ?? (SEPA.has(c) ? "SEPA" : "INTERNATIONAL");
}

/** The IBAN prefix of accounts held in a country, or null when it does not use IBANs. */
export function ibanCountry(country: string): string | null {
  const c = (country || "").toUpperCase();
  const prefix = IBAN_TERRITORIES[c] ?? c;
  return prefix in IBAN_LENGTHS ? prefix : null;
}

/** Upper case, no spaces or hyphens ("12-34-56" → "123456"). */
export function normalizeCode(value: string): string {
  return value.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
}

export function normalizeIban(value: string): string {
  let compact = value.replace(/\s+/g, "").toUpperCase();
  if (compact.startsWith("IBAN")) compact = compact.slice(4).replace(/^:+/, "");
  return compact;
}

function mod97(text: string): number {
  let remainder = 0;
  for (const char of text) {
    const digit = parseInt(char, 36);
    remainder = (remainder * (digit > 9 ? 100 : 10) + digit) % 97;
  }
  return remainder;
}

/** First structural IBAN problem, or null when valid (ISO 13616). */
export function ibanProblem(raw: string, expected: string | null): string | null {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return "An IBAN is a country code, two check digits and up to 30 letters or digits.";
  const prefix = iban.slice(0, 2);
  if (!(prefix in IBAN_LENGTHS)) return `${prefix} is not a country in the IBAN registry.`;
  if (expected && prefix !== expected) return `The IBAN must start with ${expected} for this account.`;
  if (iban.length !== IBAN_LENGTHS[prefix]) return `${prefix} IBANs have ${IBAN_LENGTHS[prefix]} characters (you entered ${iban.length}).`;
  const check = Number(iban.slice(2, 4));
  if (check < 2 || check > 98) return "IBAN check digits must be between 02 and 98.";
  if (mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) return "The IBAN check digits don't match. Check for a typing error.";
  const bban = BBAN[prefix];
  if (bban && !bban.test(iban.slice(4))) return `The account part doesn't have the ${prefix} structure.`;
  return null;
}

export function abaProblem(raw: string): string | null {
  const aba = normalizeCode(raw);
  if (!/^[0-9]{9}$/.test(aba)) return "The ABA routing number has 9 digits.";
  if (!ABA_PREFIXES.has(Number(aba.slice(0, 2)))) return "The routing number doesn't start with a valid Federal Reserve prefix.";
  const d = aba.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + d[2] + d[5] + d[8];
  if (sum % 10 !== 0) return "The routing number check digit doesn't match.";
  return null;
}

export interface BankForm {
  country: string;
  currency: string;
  holder_name: string;
  account_number: string;
  iban: string;
  ifsc: string;
  sort_code: string;
  aba: string;
  bsb: string;
  wps_routing_code: string;
  bic: string;
  account_type: string;
  bank_name: string;
  branch_name: string;
  bank_address: string;
}

export const EMPTY_BANK_FORM: BankForm = {
  country: "",
  currency: "",
  holder_name: "",
  account_number: "",
  iban: "",
  ifsc: "",
  sort_code: "",
  aba: "",
  bsb: "",
  wps_routing_code: "",
  bic: "",
  account_type: "",
  bank_name: "",
  branch_name: "",
  bank_address: "",
};

export type BankField = keyof BankForm;

/** Which fields a country's rule set shows, and which it requires. */
export function fieldsFor(country: string): { show: BankField[]; required: BankField[]; accountTypes: string[] | null } {
  const rules = ruleSet(country);
  const base: BankField[] = ["holder_name"];
  switch (rules) {
    case "IN":
      return { show: [...base, "account_number", "ifsc", "account_type", "bank_name", "branch_name"], required: [...base, "account_number", "ifsc", "account_type"], accountTypes: ["SAVINGS", "CURRENT"] };
    case "AE":
      return { show: [...base, "iban", "wps_routing_code", "bank_name"], required: [...base, "iban"], accountTypes: null };
    case "SA":
    case "SEPA":
      return { show: [...base, "iban", "bic", "bank_name"], required: [...base, "iban"], accountTypes: null };
    case "GB":
      return { show: [...base, "sort_code", "account_number", "iban", "bank_name"], required: [...base, "sort_code", "account_number"], accountTypes: null };
    case "US":
      return { show: [...base, "aba", "account_number", "account_type", "bank_name"], required: [...base, "aba", "account_number", "account_type"], accountTypes: ["CHECKING", "SAVINGS"] };
    default: {
      const show: BankField[] = [...base, "account_number"];
      if (ibanCountry(country)) show.push("iban");
      if (country.toUpperCase() === "AU") show.push("bsb");
      show.push("bic", "bank_name", "bank_address");
      return { show, required: [...base, "bic", "bank_address"], accountTypes: null };
    }
  }
}

const LABELS: Record<BankField, string> = {
  country: "Country of the bank account",
  currency: "Account currency",
  holder_name: "Account holder's name",
  account_number: "Account number",
  iban: "IBAN",
  ifsc: "IFSC",
  sort_code: "Sort code",
  aba: "ABA routing number",
  bsb: "BSB",
  wps_routing_code: "WPS agent routing code",
  bic: "BIC / SWIFT",
  account_type: "Account type",
  bank_name: "Bank name",
  branch_name: "Branch",
  bank_address: "Bank address",
};

export function fieldLabel(field: BankField): string {
  return LABELS[field];
}

/** Field errors for the current form (empty object = format looks right). Required checks only when `submitting`. */
export function checkBankForm(form: BankForm, { submitting = false }: { submitting?: boolean } = {}): Partial<Record<BankField, string>> {
  const errors: Partial<Record<BankField, string>> = {};
  const country = form.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    if (submitting) errors.country = "Choose the country where the account is held.";
    return errors;
  }
  if (submitting && !form.currency) errors.currency = "Choose the account currency.";
  const { show, required, accountTypes } = fieldsFor(country);
  const rules = ruleSet(country);
  const value = (f: BankField) => form[f].trim();

  if (submitting) {
    required.forEach((f) => {
      if (!value(f)) errors[f] = `Enter the ${LABELS[f].toLowerCase()}.`;
    });
    if (rules === "INTERNATIONAL" && !value("iban") && !value("account_number")) errors.account_number = "Enter the IBAN or the account number.";
  }
  const holder = value("holder_name");
  if (holder && (holder.length > 140 || !/\p{L}/u.test(holder))) errors.holder_name = "Use the name on the account: letters, at most 140 characters.";

  const account = normalizeCode(form.account_number);
  if (account && show.includes("account_number")) {
    const pattern: Record<string, [RegExp, string]> = {
      IN: [/^[0-9]{9,18}$/, "Indian account numbers have 9 to 18 digits."],
      GB: [/^[0-9]{8}$/, "UK account numbers have 8 digits."],
      US: [/^[0-9]{4,17}$/, "US account numbers have 4 to 17 digits."],
      INTERNATIONAL: [/^[A-Z0-9]{1,34}$/, "The account number has 1 to 34 letters or digits."],
    };
    const rule = pattern[rules];
    if (rule && !rule[0].test(account)) errors.account_number = rule[1];
    else if (/^0+$/.test(account)) errors.account_number = "The account number can't be all zeros.";
  }
  if (value("iban") && show.includes("iban")) {
    const expected = ibanCountry(country);
    const problem = expected ? ibanProblem(form.iban, expected) : `${country} doesn't use IBANs; enter the local account details.`;
    if (problem) errors.iban = problem;
  }
  const ifsc = normalizeCode(form.ifsc);
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.ifsc = "An IFSC is 4 letters, then 0, then 6 letters or digits.";
  const sort = normalizeCode(form.sort_code);
  if (sort && !/^[0-9]{6}$/.test(sort)) errors.sort_code = "The sort code has 6 digits.";
  if (value("aba")) {
    const problem = abaProblem(form.aba);
    if (problem) errors.aba = problem;
  }
  const bsb = normalizeCode(form.bsb);
  if (bsb && !/^[0-9]{6}$/.test(bsb)) errors.bsb = "The BSB has 6 digits.";
  const wps = normalizeCode(form.wps_routing_code);
  if (wps && !/^[0-9]{9}$/.test(wps)) errors.wps_routing_code = "The WPS agent routing code has 9 digits.";
  const bic = normalizeCode(form.bic);
  if (bic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) errors.bic = "A BIC has 8 or 11 characters: bank, country, location, branch.";
  if (value("account_type") && accountTypes && !accountTypes.includes(value("account_type").toUpperCase())) {
    errors.account_type = `Choose ${accountTypes.join(" or ").toLowerCase()}.`;
  }
  if (value("bank_address").length > 300) errors.bank_address = "Use at most 300 characters.";
  // A UK IBAN, when given, must contain the sort code and account number.
  if (rules === "GB" && value("iban") && !errors.iban && sort && account && !errors.sort_code && !errors.account_number) {
    const iban = normalizeIban(form.iban);
    if (iban.slice(8, 14) !== sort || iban.slice(14, 22) !== account) errors.iban = "The IBAN doesn't contain this sort code and account number.";
  }
  return errors;
}

/** "••••4321" for the review step: the full number is never shown back once typed. */
export function maskTail(value: string): string {
  const compact = normalizeCode(value);
  if (!compact) return "—";
  return `••••${compact.slice(-4)}`;
}

/** The request body for POST /me/payroll/bank-accounts: only the fields this country uses. */
export function toBankBody(form: BankForm): {
  holder_name: string;
  country: string;
  currency: string;
  account_number: string | null;
  iban: string | null;
  routing: Record<string, string>;
  account_type: string | null;
  bank_name: string | null;
  branch_name: string | null;
  bank_address: string | null;
} {
  const country = form.country.toUpperCase();
  const { show } = fieldsFor(country);
  const pick = (f: BankField) => (show.includes(f) && form[f].trim() ? form[f].trim() : null);
  const routing: Record<string, string> = {};
  (["ifsc", "sort_code", "aba", "bsb", "wps_routing_code", "bic"] as const).forEach((f) => {
    const v = pick(f);
    if (v) routing[f] = normalizeCode(v);
  });
  return {
    holder_name: form.holder_name.trim(),
    country,
    currency: form.currency,
    account_number: pick("account_number") ? normalizeCode(form.account_number) : null,
    iban: pick("iban") ? normalizeIban(form.iban) : null,
    routing,
    account_type: pick("account_type") ? form.account_type.toUpperCase() : null,
    bank_name: pick("bank_name"),
    branch_name: pick("branch_name"),
    bank_address: pick("bank_address"),
  };
}

/** Map a server 422 field ("routing.ifsc", "account", "iban") to a form field. */
export function serverField(field: string): BankField | "form" {
  const parts = field.split(".").filter((p) => p && p !== "body");
  const last = parts[parts.length - 1] ?? "";
  if (last in EMPTY_BANK_FORM) return last as BankField;
  if (last === "account") return "account_number";
  return "form";
}
