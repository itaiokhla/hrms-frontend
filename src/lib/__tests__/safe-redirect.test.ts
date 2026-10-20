import { safeNext } from "../safe-redirect";

const ORIGIN = "https://alpha-technologies.example.com";

describe("safeNext", () => {
  it("keeps same-origin paths with their query and fragment", () => {
    expect(safeNext("/employees?q=Rohan#top", ORIGIN)).toBe("/employees?q=Rohan#top");
    expect(safeNext("/settings/branding", ORIGIN)).toBe("/settings/branding");
  });

  it.each([
    null,
    "",
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "\\/evil.example",
    "javascript:alert(1)",
    "/login",
    "/login?next=/x",
  ])("falls back to the dashboard for %j", (next) => {
    expect(safeNext(next, ORIGIN)).toBe("/dashboard");
  });
});
