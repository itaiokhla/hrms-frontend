import { CURRENCIES, CURRENCY_LIST, EMPLOYEE_PAYMENT_LABELS, RUN_STATE_STAGE, VOCABULARIES } from "../payroll/catalogues.generated";
import {
  RUN_STAGES,
  employeePaymentLabel,
  formatDays,
  formatDecimalHours,
  inheritanceLabel,
  isSideState,
  percentChange,
  runStage,
  statusEntry,
} from "../payroll/labels";

describe("generated catalogues", () => {
  it("lists every currency with ISO data", () => {
    expect(CURRENCY_LIST.length).toBeGreaterThan(170);
    expect(CURRENCIES.INR).toMatchObject({ numeric: "356", minor_unit: 2, payroll_allowed: true });
    expect(CURRENCIES.AUD.cash_rounding_increment).toBe("0.05");
  });

  it("labels every state of every vocabulary with a tone and glossary", () => {
    const tones = new Set(["neutral", "primary", "success", "warning", "danger", "info"]);
    for (const vocab of Object.values(VOCABULARIES)) {
      for (const [code, entry] of Object.entries(vocab.states)) {
        expect(entry.label).toBeTruthy();
        expect(entry.glossary).toBeTruthy();
        expect(tones.has(entry.tone)).toBe(true);
        expect(code).toMatch(/^[A-Z_]+$/);
      }
    }
    for (const name of ["run", "instruction", "batch", "bank_account", "verification", "document", "invoice", "task", "wage_input", "claim", "loan", "compensation", "setting_value", "policy_version", "pack_version", "statutory_report", "pay_period", "employee_payment", "job"] as const) {
      expect(Object.keys(VOCABULARIES[name].states).length).toBeGreaterThan(1);
    }
  });

  it("maps run states to six stages", () => {
    expect(RUN_STAGES.map((s) => s.label)).toEqual(["Prepare", "Calculate", "Approve", "Finalize", "Pay", "Close"]);
    expect(runStage("REVIEW_REQUIRED")).toBe(2);
    expect(runStage("FINALIZED")).toBe(4);
    expect(runStage("CANCELLED")).toBeNull();
    expect(runStage("NOPE")).toBeNull();
    expect(isSideState("run", "REOPENED_FOR_CORRECTION")).toBe(true);
    for (const state of Object.keys(VOCABULARIES.run.states)) {
      if (!VOCABULARIES.run.side.includes(state)) expect(RUN_STATE_STAGE[state]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("statusEntry", () => {
  it("returns the vocabulary entry", () => {
    expect(statusEntry("run", "APPROVAL_PENDING")).toMatchObject({ label: "Awaiting approval", tone: "warning", known: true });
  });
  it("shows unknown codes neutrally, never as success", () => {
    expect(statusEntry("run", "MYSTERY_STATE")).toMatchObject({ label: "Mystery state", tone: "neutral", known: false });
    expect(statusEntry("run", null).label).toBe("—");
  });
});

describe("employeePaymentLabel (never Paid without verified evidence)", () => {
  it("says Paid only for settled instructions with verified evidence", () => {
    expect(employeePaymentLabel("SETTLED", "API", "VERIFIED", { date: "30 Nov" })).toMatchObject({ key: "PAID", text: "Paid on 30 Nov", tone: "success" });
    expect(employeePaymentLabel("SETTLED", "API", "UNVERIFIED").key).toBe("PROCESSING");
    expect(employeePaymentLabel("SETTLED", "MANUAL_UPLOAD", "UNVERIFIED").key).toBe("SUBMITTED_MANUAL_UNVERIFIED");
    expect(employeePaymentLabel("SETTLED", null, "VERIFIED").key).toBe("PROCESSING");
    expect(employeePaymentLabel("WHATEVER", "API", "VERIFIED").key).toBe("PROCESSING");
  });
  it("keeps pre-submission and side-state labels, and badges sandbox", () => {
    expect(employeePaymentLabel("READY", null).key).toBe("SCHEDULED");
    expect(employeePaymentLabel("ON_HOLD", null).text).toBe("On hold — HR will contact you");
    expect(employeePaymentLabel("SUBMITTED", "SANDBOX", "UNVERIFIED").badge).toBe("SANDBOX");
    expect(employeePaymentLabel("PARTIALLY_SETTLED", "API", "VERIFIED", { amount: "₹10.00" }).text).toBe("Partly paid — ₹10.00 received");
  });
  it("never maps any unverified combination to a paid label", () => {
    for (const channels of Object.values(EMPLOYEE_PAYMENT_LABELS)) {
      for (const evidence of Object.values(channels)) {
        const unverified = evidence.UNVERIFIED;
        if (unverified) expect(["PAID", "PARTLY_PAID"]).not.toContain(unverified.key);
      }
    }
  });
});

describe("small formatters", () => {
  it("formats inheritance labels", () => {
    expect(inheritanceLabel("INHERITED", "TENANT")).toBe("Inherited from tenant");
    expect(inheritanceLabel("OVERRIDDEN")).toBe("Overridden here");
    expect(inheritanceLabel("LOCKED", "TENANT")).toBe("Locked by tenant");
    expect(inheritanceLabel("LEGAL")).toBe("Required by law");
    expect(inheritanceLabel("INHERITED", "LEGAL_ENTITY")).toBe("Inherited from legal entity");
  });
  it("formats percentages with arrows and words", () => {
    expect(percentChange(31)).toMatchObject({ text: "▲ 31.0%", direction: "up", spoken: "up 31.0 percent" });
    expect(percentChange("-2.54")).toMatchObject({ text: "▼ 2.5%", direction: "down" });
    expect(percentChange(0.01).text).toBe("0.0%");
    expect(percentChange(null).text).toBe("—");
  });
  it("formats days and decimal hours", () => {
    expect(formatDays("26.50")).toBe("26.5 days");
    expect(formatDays("1")).toBe("1 day");
    expect(formatDays(100)).toBe("100 days");
    expect(formatDecimalHours("7.75")).toEqual({ text: "7.75 h", title: "7 h 45 m" });
    expect(formatDecimalHours(8)).toEqual({ text: "8 h", title: "8 h 0 m" });
    expect(formatDecimalHours(null).text).toBe("—");
  });
});
