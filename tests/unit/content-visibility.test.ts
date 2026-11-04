import { describe, expect, it } from "vitest";

import {
  availabilityState,
  computeModuleLocks,
  isLearnerVisible,
  wouldCreateCycle,
} from "@/modules/content/visibility";

const now = new Date("2026-10-31T12:00:00.000Z");

describe("content availability", () => {
  it("treats an unbounded window as open", () => {
    expect(availabilityState({ availableFrom: null, availableUntil: null }, now)).toBe("open");
  });

  it("reports a future window as not yet open", () => {
    expect(
      availabilityState(
        { availableFrom: new Date("2026-11-01T00:00:00.000Z"), availableUntil: null },
        now,
      ),
    ).toBe("not_yet");
  });

  it("reports a past window as closed", () => {
    expect(
      availabilityState(
        { availableFrom: null, availableUntil: new Date("2026-10-30T00:00:00.000Z") },
        now,
      ),
    ).toBe("closed");
  });

  it("is open at the exact boundaries", () => {
    expect(
      availabilityState(
        {
          availableFrom: new Date("2026-10-31T12:00:00.000Z"),
          availableUntil: new Date("2026-10-31T12:00:00.000Z"),
        },
        now,
      ),
    ).toBe("open");
  });

  it("requires the item to be published as well as open", () => {
    expect(
      isLearnerVisible({ status: "DRAFT", availableFrom: null, availableUntil: null }, now),
    ).toBe(false);
    expect(
      isLearnerVisible({ status: "PUBLISHED", availableFrom: null, availableUntil: null }, now),
    ).toBe(true);
  });
});

describe("module locks", () => {
  const modules = [
    { id: "m1", status: "PUBLISHED" as const, prerequisiteModuleIds: [] },
    { id: "m2", status: "PUBLISHED" as const, prerequisiteModuleIds: ["m1"] },
    { id: "m3", status: "PUBLISHED" as const, prerequisiteModuleIds: ["m1", "m2"] },
  ];

  const visible = new Map<string, string[]>([
    ["m1", ["i1", "i2"]],
    ["m2", ["i3"]],
    ["m3", ["i4"]],
  ]);

  it("locks a module until its prerequisite is complete", () => {
    const locks = computeModuleLocks({
      modules,
      visibleItemIdsByModule: visible,
      completedItemIds: new Set(["i1"]),
    });
    expect(locks.get("m1")).toEqual({ locked: false, unmetPrerequisiteIds: [] });
    expect(locks.get("m2")).toEqual({ locked: true, unmetPrerequisiteIds: ["m1"] });
    expect(locks.get("m3")?.locked).toBe(true);
  });

  it("unlocks once every visible item in the prerequisite is complete", () => {
    const locks = computeModuleLocks({
      modules,
      visibleItemIdsByModule: visible,
      completedItemIds: new Set(["i1", "i2"]),
    });
    expect(locks.get("m2")?.locked).toBe(false);
    expect(locks.get("m3")?.locked).toBe(true);
  });

  it("does not treat a module with no visible items as complete", () => {
    const locks = computeModuleLocks({
      modules,
      visibleItemIdsByModule: new Map([["m1", []]]),
      completedItemIds: new Set(),
    });
    expect(locks.get("m2")?.locked).toBe(true);
  });

  it("does not let an unpublished prerequisite unlock anything", () => {
    const locks = computeModuleLocks({
      modules: [
        { id: "m1", status: "DRAFT", prerequisiteModuleIds: [] },
        { id: "m2", status: "PUBLISHED", prerequisiteModuleIds: ["m1"] },
      ],
      visibleItemIdsByModule: new Map([
        ["m1", ["i1"]],
        ["m2", ["i2"]],
      ]),
      completedItemIds: new Set(["i1"]),
    });
    expect(locks.get("m2")).toEqual({ locked: true, unmetPrerequisiteIds: ["m1"] });
  });

  it("treats a missing prerequisite as unmet", () => {
    const locks = computeModuleLocks({
      modules: [{ id: "m2", status: "PUBLISHED", prerequisiteModuleIds: ["gone"] }],
      visibleItemIdsByModule: new Map([["m2", ["i2"]]]),
      completedItemIds: new Set(),
    });
    expect(locks.get("m2")?.locked).toBe(true);
  });
});

describe("prerequisite cycles", () => {
  it("rejects a module depending on itself", () => {
    expect(wouldCreateCycle(new Map(), "m1", "m1")).toBe(true);
  });

  it("detects an indirect cycle", () => {
    const edges = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("allows a new edge that does not loop", () => {
    const edges = new Map([["a", ["b"]]]);
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
  });
});
