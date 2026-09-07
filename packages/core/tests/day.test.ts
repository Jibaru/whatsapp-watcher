import { describe, expect, it } from "bun:test";
import { dayKey, dayKeysBetween, noteDayPartition } from "../src/day.js";

const LIMA = "America/Lima";

describe("dayKey", () => {
  it("answers the local day, not the UTC one", () => {
    // 02:00 UTC is still the previous evening in Lima, which is where the note was written.
    expect(dayKey(new Date("2026-09-08T02:00:00.000Z"), LIMA)).toBe("2026-09-07");
    expect(dayKey(new Date("2026-09-08T02:00:00.000Z"), "UTC")).toBe("2026-09-08");
  });

  it("prefixes the partition so notes never collide with reminders in the index", () => {
    expect(noteDayPartition(new Date("2026-09-07T15:00:00.000Z"), LIMA)).toBe("NOTE#2026-09-07");
  });
});

describe("dayKeysBetween", () => {
  it("returns the two days a 24 hour window normally touches", () => {
    const keys = dayKeysBetween(
      new Date("2026-09-06T13:00:00.000Z"),
      new Date("2026-09-07T13:00:00.000Z"),
      LIMA,
    );

    expect(keys).toEqual(["2026-09-06", "2026-09-07"]);
  });

  it("returns a single day for a window that stays inside one", () => {
    const keys = dayKeysBetween(
      new Date("2026-09-07T14:00:00.000Z"),
      new Date("2026-09-07T20:00:00.000Z"),
      LIMA,
    );

    expect(keys).toEqual(["2026-09-07"]);
  });

  it("covers every day of a longer window without repeating one", () => {
    const keys = dayKeysBetween(
      new Date("2026-09-05T13:00:00.000Z"),
      new Date("2026-09-08T13:00:00.000Z"),
      LIMA,
    );

    expect(keys).toEqual(["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
  });

  it("always includes the day the window ends on", () => {
    const to = new Date("2026-09-07T05:30:00.000Z");
    const keys = dayKeysBetween(new Date("2026-09-07T04:00:00.000Z"), to, LIMA);

    expect(keys.at(-1)).toBe(dayKey(to, LIMA));
  });
});
