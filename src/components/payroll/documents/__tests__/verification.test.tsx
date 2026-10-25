import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import { DocumentVerification } from "@/components/payroll/documents/DocumentVerification";
import { ApiError } from "@/lib/api";

/**
 * Gate-chrome regression (24 Oct): payslip PDFs print "Verify this document at {host}/verify/{id}", but the
 * frontend had no /verify page — the link sent a reader without a session to the sign-in page and a signed-in
 * one to "This page doesn't exist". The page shows only what the public API discloses (EC-DOC-18).
 */
const mockGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { get: (...a: unknown[]) => mockGet(...a) } };
});

const DOC = {
  valid: true,
  issuer: "Alpha Technologies Pvt Ltd",
  document_type: "Payslip",
  issue_date: "2026-10-23",
  number: "PS/IN01/2026/000018",
  name: "R**** G****",
  status: "ISSUED",
};

beforeEach(() => mockGet.mockReset());

it("shows issuer, type, number, date and the masked name of a genuine document, never amounts", async () => {
  mockGet.mockResolvedValue(DOC);
  render(<DocumentVerification publicId="6hLaljMMvl4BH9H7yNtDGJkf" />);
  expect(await screen.findByText("Genuine document")).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledWith("/documents/verify/6hLaljMMvl4BH9H7yNtDGJkf");
  for (const text of ["Alpha Technologies Pvt Ltd", "Payslip", "PS/IN01/2026/000018", "23 Oct 2026", "R**** G****"]) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  expect(screen.getByTestId("verify-result").textContent).not.toMatch(/\d+\.\d{2}/);
});

it("says a superseded document is genuine but no longer current", async () => {
  mockGet.mockResolvedValue({ ...DOC, status: "SUPERSEDED" });
  render(<DocumentVerification publicId="6hLaljMMvl4BH9H7yNtDGJkf" />);
  expect(await screen.findByText("Genuine, but no longer current")).toBeInTheDocument();
  expect(screen.getByText(/replaced by a newer version/)).toBeInTheDocument();
});

it("treats an unknown id (API 404) and a malformed id the same way, without calling the API for the latter", async () => {
  mockGet.mockRejectedValue(new ApiError(404, "Document not found"));
  const { unmount } = render(<DocumentVerification publicId="6hLaljMMvl4BH9H7yNtDGJkf" />);
  expect(await screen.findByTestId("verify-not-found")).toBeInTheDocument();
  unmount();
  mockGet.mockClear();
  render(<DocumentVerification publicId="../etc" />);
  expect(await screen.findByTestId("verify-not-found")).toBeInTheDocument();
  expect(mockGet).not.toHaveBeenCalled();
});

it("shows a neutral retry message when the check fails", async () => {
  mockGet.mockRejectedValue(new ApiError(500, "boom"));
  render(<DocumentVerification publicId="6hLaljMMvl4BH9H7yNtDGJkf" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be checked right now/));
});
