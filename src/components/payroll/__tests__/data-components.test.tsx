import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DiffView } from "../DiffView";
import { FileDropzone, validateFile } from "../FileDropzone";
import { MaskedValue } from "../MaskedValue";

describe("DiffView", () => {
  const rows = [
    { key: "ifsc", label: "IFSC", before: "HDFC0001234", after: "ICIC0000456" },
    { key: "name", label: "Holder name", before: "Priya Shah", after: "Priya Shah" },
    { key: "branch", label: "Branch", before: null, after: "Andheri" },
    { key: "nick", label: "Nickname", before: "Salary", after: null },
  ];

  it("labels changes in words and hides unchanged rows behind a toggle", () => {
    render(<DiffView rows={rows} beforeLabel="Current" afterLabel="Requested" />);
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.queryByText("Holder name")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 unchanged field" }));
    expect(screen.getByText("Holder name")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Requested" })).toBeInTheDocument();
  });

  it("says when nothing changed", () => {
    render(<DiffView rows={[{ key: "a", label: "A", before: "1", after: "1" }]} />);
    expect(screen.getByText("No changes.")).toBeInTheDocument();
  });
});

describe("MaskedValue", () => {
  afterEach(() => jest.useRealTimers());

  it("is masked by default and offers no reveal without permission", () => {
    render(<MaskedValue masked="••••4321" label="account number" />);
    expect(screen.getByText("••••4321")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requires a reason, reveals, then hides again after 30 seconds", async () => {
    jest.useFakeTimers();
    const onReveal = jest.fn().mockResolvedValue("50100012344321");
    render(<MaskedValue masked="••••4321" label="account number" onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal account number" }));
    const dialog = await screen.findByRole("dialog", { name: "Reveal account number?" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByText("Enter why you need to see it.")).toBeInTheDocument();
    expect(onReveal).not.toHaveBeenCalled();
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Verify failed payment" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    });
    expect(onReveal).toHaveBeenCalledWith("Verify failed payment");
    expect(screen.getByText("50100012344321")).toBeInTheDocument();
    expect(screen.getByText("Hides in 30 s")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(29_000);
    });
    expect(screen.getByText("Hides in 1 s")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText("50100012344321")).not.toBeInTheDocument();
    expect(screen.getByText("••••4321")).toBeInTheDocument();
  });

  it("shows the server's error and stays masked", async () => {
    const onReveal = jest.fn().mockRejectedValue(new Error("boom"));
    render(<MaskedValue masked="••••4321" onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /Reveal/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "x" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("••••4321")).toBeInTheDocument();
  });
});

describe("FileDropzone", () => {
  const csv = (name = "inputs.csv", size = 10) => new File(["x".repeat(size)], name, { type: "text/csv" });

  it("validates type and size", () => {
    expect(validateFile(csv(), [".csv"], 100)).toBeNull();
    expect(validateFile(csv("a.exe"), [".csv"], 100)).toMatch(/isn't allowed/);
    expect(validateFile(csv("a.csv", 200), [".csv"], 100)).toMatch(/limit is 100 B/);
    expect(validateFile(new File(["x"], "p.png", { type: "image/png" }), ["image/*"], 100)).toBeNull();
    expect(validateFile(csv("a.csv", 0), [".csv"], 100)).toMatch(/empty/);
  });

  it("reports invalid files and passes valid ones on", () => {
    const onFiles = jest.fn();
    const { container } = render(<FileDropzone accept={[".csv"]} maxBytes={100} multiple onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csv(), csv("bad.pdf")] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "inputs.csv" })]);
    expect(screen.getByRole("alert")).toHaveTextContent("bad.pdf: this file type isn't allowed");
  });

  it("accepts dropped files and shows upload progress", async () => {
    let progress: (p: number) => void = () => {};
    let finish: () => void = () => {};
    const upload = jest.fn((_file: File, onProgress: (p: number) => void) => {
      progress = onProgress;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const { container } = render(<FileDropzone accept={[".csv"]} maxBytes={100} upload={upload} />);
    const zone = container.querySelector(".border-dashed") as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(zone, { dataTransfer: { files: [csv()] } });
    expect(upload).toHaveBeenCalled();
    act(() => progress(40));
    expect(screen.getByRole("progressbar", { name: "Uploading inputs.csv" })).toHaveAttribute("aria-valuenow", "40");
    await act(async () => finish());
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeInTheDocument());
  });

  it("opens the file picker from a real button", () => {
    const { container } = render(<FileDropzone accept={[".csv"]} maxBytes={100} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = jest.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));
    expect(click).toHaveBeenCalled();
  });
});
