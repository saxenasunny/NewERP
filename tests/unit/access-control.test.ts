import { describe, expect, it } from "vitest";

import { TENANT_ROLES, type PermissionKey } from "@/lib/permissions/catalogue";

describe("RBAC access control and route boundary enforcement", () => {
  const getRolePermissions = (roleKey: string): Set<PermissionKey> => {
    const role = TENANT_ROLES.find((r) => r.key === roleKey);
    return new Set(role?.permissions ?? []);
  };

  describe("Administrative course offerings (/admin/offerings)", () => {
    // Admin offerings management guard:
    // Requires: enrolments.manage || courses.create || academic_structure.manage
    const canManageOfferings = (permissions: Set<PermissionKey>) =>
      permissions.has("enrolments.manage") ||
      permissions.has("courses.create") ||
      permissions.has("academic_structure.manage");

    it("allows institution admin to manage offerings", () => {
      const adminPerms = getRolePermissions("institution_admin");
      expect(canManageOfferings(adminPerms)).toBe(true);
    });

    it("STRICTLY BLOCKS faculty from accessing admin offerings", () => {
      const facultyPerms = getRolePermissions("faculty");
      // Faculty has courses.read, but MUST NOT be allowed to manage offerings
      expect(facultyPerms.has("courses.read")).toBe(true);
      expect(canManageOfferings(facultyPerms)).toBe(false);
    });

    it("STRICTLY BLOCKS students from accessing admin offerings", () => {
      const studentPerms = getRolePermissions("student");
      expect(canManageOfferings(studentPerms)).toBe(false);
    });
  });

  describe("Administrative course catalogue (/admin/courses)", () => {
    // Admin catalogue guard:
    // Requires: courses.create || courses.update || academic_structure.manage
    const canManageCatalogue = (permissions: Set<PermissionKey>) =>
      permissions.has("courses.create") ||
      permissions.has("courses.update") ||
      permissions.has("academic_structure.manage");

    it("allows institution admin to manage course catalogue", () => {
      const adminPerms = getRolePermissions("institution_admin");
      expect(canManageCatalogue(adminPerms)).toBe(true);
    });

    it("STRICTLY BLOCKS faculty from modifying course catalogue", () => {
      const facultyPerms = getRolePermissions("faculty");
      expect(canManageCatalogue(facultyPerms)).toBe(false);
    });

    it("STRICTLY BLOCKS students from modifying course catalogue", () => {
      const studentPerms = getRolePermissions("student");
      expect(canManageCatalogue(studentPerms)).toBe(false);
    });
  });

  describe("Administrative people directory (/admin/users)", () => {
    // Directory management guard:
    // Requires: users.create || roles.assign || users.import || users.update || users.deactivate
    const canManageDirectory = (permissions: Set<PermissionKey>) =>
      permissions.has("users.create") ||
      permissions.has("roles.assign") ||
      permissions.has("users.import") ||
      permissions.has("users.update") ||
      permissions.has("users.deactivate");

    it("allows institution admin to manage directory and assign roles", () => {
      const adminPerms = getRolePermissions("institution_admin");
      expect(canManageDirectory(adminPerms)).toBe(true);
    });

    it("STRICTLY BLOCKS faculty from managing directory or assigning roles", () => {
      const facultyPerms = getRolePermissions("faculty");
      // Even though faculty has users.read for roster viewing, they cannot manage directory
      expect(facultyPerms.has("users.read")).toBe(true);
      expect(canManageDirectory(facultyPerms)).toBe(false);
    });

    it("STRICTLY BLOCKS students from managing directory", () => {
      const studentPerms = getRolePermissions("student");
      expect(canManageDirectory(studentPerms)).toBe(false);
    });
  });

  describe("Campus rooms and timetable (/admin/rooms & /admin/timetable)", () => {
    // Campus rooms and timetable guard:
    // Requires: academic_structure.manage
    const canManageRoomsAndTimetable = (permissions: Set<PermissionKey>) =>
      permissions.has("academic_structure.manage");

    it("allows institution admin to manage rooms and master timetable", () => {
      const adminPerms = getRolePermissions("institution_admin");
      expect(canManageRoomsAndTimetable(adminPerms)).toBe(true);
    });

    it("STRICTLY BLOCKS faculty from configuring rooms or master timetable", () => {
      const facultyPerms = getRolePermissions("faculty");
      expect(canManageRoomsAndTimetable(facultyPerms)).toBe(false);
    });

    it("STRICTLY BLOCKS students from configuring rooms or master timetable", () => {
      const studentPerms = getRolePermissions("student");
      expect(canManageRoomsAndTimetable(studentPerms)).toBe(false);
    });
  });

  describe("Route-level layout role barriers", () => {
    type AccountMock = {
      isPlatformAdmin: boolean;
      navRole: "platform_admin" | "institution_admin" | "faculty" | "student";
      roleKeys: string[];
    };

    const isAuthorizedForAdminLayout = (account: AccountMock) =>
      account.isPlatformAdmin ||
      account.navRole === "institution_admin" ||
      account.roleKeys.includes("institution_admin") ||
      account.roleKeys.includes("academic_coordinator");

    const isAuthorizedForFacultyLayout = (account: AccountMock) =>
      account.isPlatformAdmin ||
      account.navRole === "faculty" ||
      account.navRole === "institution_admin" ||
      account.roleKeys.includes("faculty") ||
      account.roleKeys.includes("teaching_assistant") ||
      account.roleKeys.includes("institution_admin");

    it("admin layout allows admins and coordinators, blocks faculty and students", () => {
      expect(
        isAuthorizedForAdminLayout({
          isPlatformAdmin: false,
          navRole: "institution_admin",
          roleKeys: ["institution_admin"],
        }),
      ).toBe(true);

      expect(
        isAuthorizedForAdminLayout({
          isPlatformAdmin: false,
          navRole: "institution_admin",
          roleKeys: ["academic_coordinator"],
        }),
      ).toBe(true);

      expect(
        isAuthorizedForAdminLayout({
          isPlatformAdmin: true,
          navRole: "platform_admin",
          roleKeys: [],
        }),
      ).toBe(true);

      // Faculty is rejected
      expect(
        isAuthorizedForAdminLayout({
          isPlatformAdmin: false,
          navRole: "faculty",
          roleKeys: ["faculty"],
        }),
      ).toBe(false);

      // Student is rejected
      expect(
        isAuthorizedForAdminLayout({
          isPlatformAdmin: false,
          navRole: "student",
          roleKeys: ["student"],
        }),
      ).toBe(false);
    });

    it("faculty layout allows faculty and admins, blocks students", () => {
      expect(
        isAuthorizedForFacultyLayout({
          isPlatformAdmin: false,
          navRole: "faculty",
          roleKeys: ["faculty"],
        }),
      ).toBe(true);

      expect(
        isAuthorizedForFacultyLayout({
          isPlatformAdmin: false,
          navRole: "faculty",
          roleKeys: ["teaching_assistant"],
        }),
      ).toBe(true);

      expect(
        isAuthorizedForFacultyLayout({
          isPlatformAdmin: false,
          navRole: "institution_admin",
          roleKeys: ["institution_admin"],
        }),
      ).toBe(true);

      // Student is strictly rejected from faculty layout
      expect(
        isAuthorizedForFacultyLayout({
          isPlatformAdmin: false,
          navRole: "student",
          roleKeys: ["student"],
        }),
      ).toBe(false);
    });
  });
});
