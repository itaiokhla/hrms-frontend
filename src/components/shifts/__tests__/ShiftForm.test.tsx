/** AS-M1 WI-AS-1.7: ShiftForm validation and kind-dependent fields (03-shifts/01 §17.3), plus the pure helpers. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { shiftsApi } from "@/components/shifts/api";
import { ShiftForm } from "@/components/shifts/ShiftForm";
import { durationHours, explainSummary, timesInZone, toVersionBody, defaultValues } from "@/components/shifts/shiftModel";

jest.mock("@/components/shifts/api", () => {
  const actual = jest.requireActual("@/components/shifts/api");
  return { ...actual, shiftsApi: { ...actual.shiftsApi, create: jest.fn() } };
});

const create = shiftsApi.create as jest.Mock;

function renderForm() {
  const props = { formId: "shift-form", mode: "create" as const, idempotencyKey: "key-1", setDirty: jest.fn(),
    setSubmitting: jest.fn(), onSuccess: jest.fn() };
  render(
    <>
      <ShiftForm {...props} />
      <button type="submit" form="shift-form">Create shift</button>
    </>,
  );
  return props;
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: 31 });
});

describe("ShiftForm", () => {
  it("validates required fields and upper-cases the code as typed", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText(/Use 1–20 capital letters/)).toBeInTheDocument();
    expect(screen.getByText("Give the shift a name.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    type(/^Code/, "flex-blr");
    expect(field(/^Code/)).toHaveValue("FLEX-BLR");
  });

  it("FLEXIBLE shows the band, the core window and expected work, and sends them", async () => {
    const props = renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Flexible" }));
    expect(field(/^Band starts/)).toBeInTheDocument();
    expect(field(/^Core starts/)).toBeInTheDocument();
    expect(field(/^Core ends/)).toBeInTheDocument();
    expect(field(/^Expected work/)).toHaveValue("8:00");
    type(/^Code/, "FLEX-BLR");
    type(/^Name/, "Flexi Bengaluru");
    type(/^Band starts/, "08:00");
    type(/^Band ends/, "20:00");
    type(/^Core starts/, "11:00");
    type(/^Core ends/, "16:00");
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [body, key] = create.mock.calls[0];
    expect(key).toBe("key-1");
    expect(body).toMatchObject({ code: "FLEX-BLR", kind: "FLEXIBLE", color_token: "shift-1" });
    expect(body.version).toMatchObject({ start_time: "08:00", end_time: "20:00", core_start_time: "11:00",
      core_end_time: "16:00", expected_net_minutes: 480, long_duty: false });
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledWith({ id: 31 }));
  });

  it("OPEN hides the clock times and needs the hours to work", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Open" }));
    expect(screen.queryByLabelText(/^Start\*?$/)).toBeNull();
    expect(screen.queryByLabelText(/^End\*?$/)).toBeNull();
    expect(screen.queryByLabelText(/^Core starts/)).toBeNull();
    type(/^Expected work/, "");
    type(/^Code/, "FIELD");
    type(/^Name/, "Field sales");
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText("Enter the hours to work, e.g. 8:00.")).toBeInTheDocument();
    type(/^Expected work/, "8:00");
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].version).toMatchObject({ start_time: null, end_time: null, expected_net_minutes: 480 });
  });

  it("a FIXED start equal to the end needs the 24-hour duty confirmation", async () => {
    renderForm();
    type(/^Code/, "D24");
    type(/^Name/, "Day and night");
    expect(screen.queryByRole("checkbox", { name: "This is a 24-hour duty" })).toBeNull();
    type(/^End\*?$/, "09:00");
    const confirm = screen.getByRole("checkbox", { name: "This is a 24-hour duty" });
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText(/Confirm that this is a 24-hour duty/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Create shift" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].version).toMatchObject({ start_time: "09:00", end_time: "09:00", long_duty: true });
  });

  it("marks an end before the start as the next day", () => {
    renderForm();
    type(/^Start\*?$/, "22:00");
    type(/^End\*?$/, "06:00");
    expect(screen.getByTestId("next-day-chip")).toHaveTextContent("+1 next day");
  });

  it("shows the colour swatches with their number, never colour alone", () => {
    renderForm();
    const swatch = screen.getByRole("radio", { name: "Colour 6" });
    expect(swatch).toHaveTextContent("6");
    fireEvent.click(swatch);
    expect(swatch).toHaveAttribute("aria-checked", "true");
  });
});

describe("shift helpers", () => {
  it("computes the legacy duration across midnight (BUG-AS-23)", () => {
    expect(durationHours("09:00", "18:00")).toBe(9);
    expect(durationHours("22:00", "06:00")).toBe(8);
    expect(durationHours("08:30", "17:00")).toBe(8.5);
    expect(durationHours("09:00", "09:00")).toBe(24);
    expect(durationHours("", "06:00")).toBeNull();
  });

  it("converts an anchored shift to the work zone (US-E1 on an EST date, GV-AS-SHF-03)", () => {
    expect(timesInZone("2026-11-02", "09:00", "18:00", "America/New_York", "Asia/Kolkata"))
      .toEqual({ start: "19:30", end: "04:30", startDayOffset: 0, endDayOffset: 1 });
  });

  it("summarises the winning resolution step", () => {
    expect(explainSummary({ source: "RULE", candidates: [{ step: "RULE", won: true, priority: 500 }, { step: "PLACEMENT", won: false }] }))
      .toBe("Rule (priority 500) over placement");
    expect(explainSummary({ source: "NONE", candidates: [] })).toBe("No shift applies");
  });

  it("puts a night shift's early-morning break on the next day", () => {
    const values = { ...defaultValues("2026-11-02"), start_time: "22:00", end_time: "06:00",
      breaks: [{ kind: "LUNCH" as const, mode: "FLOATING_WINDOW" as const, minutes: "30", paid: true, start: "", end: "",
        window_start: "01:30", window_end: "03:30", auto_deduct_after_minutes: "" }] };
    expect(toVersionBody(values, "create").break_rules?.[0]).toMatchObject({ window_start: "01:30", next_day: true, paid: true });
  });
});
