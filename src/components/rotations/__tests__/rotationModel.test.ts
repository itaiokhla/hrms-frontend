/** Pure helpers of the rotation editor (03-shifts/02 §2.1-§2.2, §3.5): crew rows, client checks, the save body and the
 * last auto-publish line. */
import {
  autoPublishText, crewRow, draftBody, draftFromVersion, switchMode, usedTokens, validateDraft,
} from "@/components/rotations/rotationModel";

const pune = draftFromVersion({
  tokens: "MMMMMMOOAAAAAAOONNNNNNOO", crew_rows: null, crew_offsets: { A: 0, B: 6, C: 12, D: 18 },
  token_map: { M: { shift_id: 5 }, A: { shift_id: 6 } }, coverage: { M: 1, A: 1, N: 1 }, week_anchor_weekday: 0, lints_muted: [],
});

test("a base-row crew follows tokens[(i + offset) mod L] (PUNE-6ON2OFF; GV-AS-ROT-01: crew B day 3 is index 8 = A)", () => {
  expect(crewRow(pune, "A")).toBe("MMMMMMOOAAAAAAOONNNNNNOO");
  expect(crewRow(pune, "B")).toBe("OOAAAAAAOONNNNNNOOMMMMMM");
  expect(crewRow(pune, "D")).toBe("MMMMMMOOAAAAAAOONNNNNNOO".slice(18) + "MMMMMMOOAAAAAAOONNNNNNOO".slice(0, 18));
  expect(usedTokens(pune)).toEqual(["M", "A", "N"]);
});

test("the client checks list unmapped letters and out-of-range offsets; the body maps letters to shift ids", () => {
  expect(validateDraft(pune)).toEqual({ "map-N": "Choose what N means." });
  const bad = { ...pune, crewOffsets: [...pune.crewOffsets, { code: "E", offset: "24" }], tokenMap: { ...pune.tokenMap, N: "OFF" } };
  expect(Object.keys(validateDraft(bad))).toEqual(["crew-4"]);
  const body = draftBody({ ...pune, tokenMap: { ...pune.tokenMap, N: "7" } });
  expect(body).toEqual({
    cycle_days: 24, tokens: "MMMMMMOOAAAAAAOONNNNNNOO", crew_rows: null, crew_offsets: { A: 0, B: 6, C: 12, D: 18 },
    token_map: { M: { shift_id: 5 }, A: { shift_id: 6 }, N: { shift_id: 7 } }, coverage: { M: 1, A: 1, N: 1 },
    week_anchor_weekday: 0, lints_muted: [],
  });
});

test("switching to one row per crew writes each crew's shifted row and keeps the cycle", () => {
  const rows = switchMode(pune, "ROWS");
  expect(rows.crewRows.map((r) => r.code)).toEqual(["A", "B", "C", "D"]);
  expect(rows.crewRows[1].row).toBe(crewRow(pune, "B"));
  expect(draftBody({ ...rows, tokenMap: { ...rows.tokenMap, N: "7" } })).toEqual(expect.objectContaining({
    tokens: null, crew_offsets: {}, cycle_days: 24 }));
  expect(validateDraft({ ...rows, crewRows: [...rows.crewRows, { code: "E", row: "MMO" }], tokenMap: { ...rows.tokenMap, N: "7" } }))
    .toEqual({ "row-4": "Every row needs the same length (24 days)." });
});

test("the last auto-publish line shows progress while running and the chunk summary after", () => {
  expect(autoPublishText(null)).toBe("Not run yet.");
  const base = { job_id: 1, local_date: "2026-10-30", created_at: null, finished_at: null, error: null, summary: null };
  expect(autoPublishText({ ...base, status: "RUNNING", progress_done: 2, progress_total: 17 })).toBe("Running: 2 of 17 chunks done.");
  expect(autoPublishText({ ...base, status: "SUCCEEDED", progress_done: 17, progress_total: 17,
    summary: { publications: 15, entries: 84000, blocked_employees: 0, chunks: 17, failed_chunks: 2 } }))
    .toBe("Finished: 84000 entries published · 2 of 17 chunks failed.");
  expect(autoPublishText({ ...base, status: "FAILED", progress_done: 0, progress_total: null, error: "Timed out" }))
    .toBe("Failed: Timed out");
});
