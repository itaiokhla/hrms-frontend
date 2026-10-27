import { nextDayIso, zonedIso } from "../timezone";

describe("zonedIso (BUG-AS-21)", () => {
  it("adds the zone's offset to a wall time", () => {
    expect(zonedIso("2026-10-26", "18:30", "Asia/Kolkata")).toBe("2026-10-26T18:30:00+05:30");
    expect(zonedIso("2026-10-26", "22:00", "America/New_York")).toBe("2026-10-26T22:00:00-04:00");
  });

  it("follows DST: New York is on EST after Sun 2026-11-01", () => {
    expect(zonedIso("2026-11-02", "06:00", "America/New_York")).toBe("2026-11-02T06:00:00-05:00");
    expect(zonedIso("2026-11-01", "00:30", "America/New_York")).toBe("2026-11-01T00:30:00-04:00");
  });

  it("an overnight end is the next calendar day, independent of the device zone", () => {
    expect(nextDayIso("2026-10-31")).toBe("2026-11-01");
    expect(nextDayIso("2026-12-31")).toBe("2027-01-01");
  });
});
