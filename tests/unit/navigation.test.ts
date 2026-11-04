import { describe, expect, it } from "vitest";

import {
  NAVIGATION,
  ROLE_KEYS,
  ROLES,
  plannedNavigation,
  visibleNavigation,
  type RoleKey,
} from "@/lib/navigation";

describe("role-aware navigation", () => {
  it("defines configuration for every supported role", () => {
    expect(Object.keys(NAVIGATION).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it("only exposes destinations that exist and never empty sections", () => {
    for (const role of ROLE_KEYS) {
      const sections = visibleNavigation(role);
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        expect(section.entries.length).toBeGreaterThan(0);
        for (const entry of section.entries) {
          expect(entry.href.startsWith("/")).toBe(true);
        }
      }
    }
  });

  it("lists the role dashboard as a reachable destination", () => {
    for (const role of ROLE_KEYS) {
      const hrefs = visibleNavigation(role).flatMap((section) =>
        section.entries.map((entry) => entry.href),
      );
      expect(hrefs).toContain(ROLES[role].dashboardPath);
    }
  });

  it("does not duplicate destinations within a role", () => {
    for (const role of ROLE_KEYS) {
      const hrefs = visibleNavigation(role).flatMap((section) =>
        section.entries.map((entry) => entry.href),
      );
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it("keeps planned entries out of navigation and assigns them a phase", () => {
    for (const role of ROLE_KEYS) {
      for (const section of plannedNavigation(role)) {
        for (const entry of section.entries) {
          expect(entry.href).toBeUndefined();
          expect(entry.phase).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("gives each role a distinct dashboard path", () => {
    const paths = ROLE_KEYS.map((role: RoleKey) => ROLES[role].dashboardPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
