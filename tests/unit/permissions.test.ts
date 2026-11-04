import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLES,
  ROLE_DEFINITIONS,
  TENANT_ROLES,
  isPermissionKey,
  roleDefinition,
} from "@/lib/permissions/catalogue";

describe("permission catalogue", () => {
  it("has unique keys with descriptions", () => {
    const keys = PERMISSIONS.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const permission of PERMISSIONS) {
      expect(permission.description.length).toBeGreaterThan(10);
    }
  });

  it("recognises only catalogue keys", () => {
    expect(isPermissionKey("grades.update")).toBe(true);
    expect(isPermissionKey("grades.delete_everything")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
  });

  it("grants only known permissions from role definitions", () => {
    for (const role of ROLE_DEFINITIONS) {
      expect(role.permissions.length).toBeGreaterThan(0);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const permission of role.permissions) {
        expect(PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  it("keeps role keys unique and findable", () => {
    const keys = ROLE_DEFINITIONS.map((role) => role.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(roleDefinition(key)?.key).toBe(key);
    }
    expect(roleDefinition("not_a_role")).toBeUndefined();
  });

  it("does not give students grading, publishing, or management capabilities", () => {
    const student = TENANT_ROLES.find((role) => role.key === "student");
    expect(student).toBeDefined();
    for (const forbidden of [
      "grades.update",
      "grades.publish",
      "submissions.grade",
      "users.read",
      "content.publish",
      "academic_structure.manage",
    ] as const) {
      expect(student?.permissions).not.toContain(forbidden);
    }
  });

  it("gives faculty grading but not institution administration", () => {
    const faculty = TENANT_ROLES.find((role) => role.key === "faculty");
    expect(faculty?.permissions).toContain("submissions.grade");
    expect(faculty?.permissions).toContain("grades.publish");
    expect(faculty?.permissions).not.toContain("institution.settings.manage");
    expect(faculty?.permissions).not.toContain("users.deactivate");
  });

  it("keeps platform roles out of tenant learning data", () => {
    for (const role of PLATFORM_ROLES) {
      expect(role.scope).toBe("platform");
      expect(role.permissions).not.toContain("courses.read");
      expect(role.permissions).not.toContain("grades.read");
      expect(role.permissions).not.toContain("users.read");
    }
  });
});
