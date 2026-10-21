import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { StatusChip } from "../StatusChip";
import { Stepper } from "../Stepper";
import { Timeline } from "../Timeline";

describe("StatusChip", () => {
  it("renders the vocabulary label, tone and an icon", () => {
    const { container } = render(<StatusChip vocabulary="run" code="REVIEW_REQUIRED" />);
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "warning");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the exact state code on request", () => {
    render(<StatusChip vocabulary="run" code="APPROVAL_PENDING" showCode />);
    expect(screen.getByText("APPROVAL_PENDING")).toBeInTheDocument();
  });

  it("links a glossary tooltip shown on focus and dismissed with Escape", () => {
    render(<StatusChip vocabulary="instruction" code="SUBMITTED" />);
    const tooltip = screen.getByRole("tooltip", { hidden: true });
    expect(tooltip).toHaveTextContent("Not confirmed as paid");
    const trigger = document.querySelector(`[aria-describedby="${tooltip.id}"]`) as HTMLElement;
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(tooltip).toHaveClass("hidden");
    fireEvent.focus(trigger);
    expect(tooltip).toHaveClass("block");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tooltip).toHaveClass("hidden");
  });

  it("shows unknown codes neutrally", () => {
    const { container } = render(<StatusChip vocabulary="batch" code="SOMETHING_NEW" />);
    expect(screen.getByText("Something new")).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "neutral");
  });

  it("covers employee payment and job vocabularies", () => {
    render(
      <>
        <StatusChip vocabulary="employee_payment" code="SUBMITTED_MANUAL_UNVERIFIED" />
        <StatusChip vocabulary="job" code="RUNNING" />
      </>,
    );
    expect(screen.getByText("Submitted — unverified")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  const steps = () => screen.getAllByRole("listitem");

  it("marks earlier stages complete and the current stage", () => {
    render(<Stepper state="REVIEW_REQUIRED" />);
    expect(steps()).toHaveLength(6);
    expect(steps()[0]).toHaveTextContent("Stage 1 of 6, completed");
    expect(steps()[1]).toHaveAttribute("aria-current", "step");
    expect(steps()[1]).toHaveTextContent("current, needs attention");
    expect(steps()[2]).toHaveTextContent("not started");
    expect(screen.getByText("REVIEW_REQUIRED")).toBeInTheDocument();
  });

  it("has no current stage for side states and explains them", () => {
    render(<Stepper state="CANCELLED" />);
    expect(steps().some((li) => li.getAttribute("aria-current"))).toBe(false);
    expect(screen.getAllByText(/never be paid/).length).toBeGreaterThan(0);
  });

  it("shows every stage done for a reconciled run", () => {
    render(<Stepper state="RECONCILED" />);
    expect(steps().every((li) => li.textContent?.includes("completed"))).toBe(true);
  });
});

describe("Timeline", () => {
  it("renders events with machine-readable times", () => {
    render(
      <Timeline
        items={[
          { id: 1, at: "2026-11-26T14:05:00", title: "Calculated", actor: "R. Mehta", tone: "info" },
          { id: 2, at: "2026-11-27T09:00:00", title: "Approved", body: "Looks good" },
        ]}
        label="Run history"
      />,
    );
    const list = screen.getByRole("list", { name: "Run history" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("R. Mehta")).toBeInTheDocument();
    expect(list.querySelector("time")).toHaveAttribute("dateTime", "2026-11-26T14:05:00");
  });

  it("shows an empty state", () => {
    render(<Timeline items={[]} />);
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });
});
