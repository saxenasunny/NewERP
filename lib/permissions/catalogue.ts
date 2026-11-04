/**
 * Central permission catalogue. This file is the single source of truth: the
 * database `permissions` and `roles` tables are seeded from it, and every
 * server check imports the same keys. Never compare permission strings inline.
 */

export type PermissionDefinition = {
  key: string;
  description: string;
};

export const PERMISSIONS = [
  { key: "tenant.manage", description: "Create, suspend, and configure tenants." },
  {
    key: "institution.settings.read",
    description: "View institution settings and configuration.",
  },
  {
    key: "institution.settings.manage",
    description: "Change institution settings and configuration.",
  },
  { key: "users.read", description: "View users and memberships in scope." },
  { key: "users.create", description: "Invite or create users." },
  { key: "users.update", description: "Update user profiles and memberships." },
  { key: "users.deactivate", description: "Deactivate users and revoke access." },
  { key: "roles.assign", description: "Assign and remove institution roles for users." },
  { key: "users.import", description: "Import users from CSV." },
  { key: "academic_structure.manage", description: "Manage academic years, terms, and structure." },
  { key: "courses.create", description: "Create courses and course offerings." },
  { key: "courses.read", description: "View courses the actor is entitled to." },
  { key: "courses.update", description: "Edit course settings and metadata." },
  { key: "courses.publish", description: "Publish or schedule courses." },
  { key: "courses.archive", description: "Archive courses." },
  { key: "enrolments.manage", description: "Assign instructors and enrol learners." },
  { key: "content.create", description: "Create and edit course content." },
  { key: "content.publish", description: "Publish course content." },
  { key: "content.delete", description: "Delete course content." },
  { key: "assessments.manage", description: "Create and configure assessments." },
  { key: "submissions.submit", description: "Submit work as an enrolled learner." },
  { key: "submissions.grade", description: "Grade submissions and provide feedback." },
  { key: "grades.read", description: "View grades in scope." },
  { key: "grades.update", description: "Change grades or apply overrides." },
  { key: "grades.publish", description: "Release grades and feedback to learners." },
  { key: "attendance.manage", description: "Record and correct attendance." },
  { key: "attendance.read", description: "View attendance records in scope." },
  { key: "sessions.manage", description: "Schedule, reschedule, and cancel live sessions." },
  {
    key: "announcements.manage",
    description: "Draft, publish, and withdraw course announcements.",
  },
  {
    key: "discussions.moderate",
    description: "Pin, lock, hide, and restore course discussions.",
  },
  { key: "reports.course.read", description: "View course-level reports." },
  { key: "reports.institution.read", description: "View institution-level reports." },
  { key: "obe.manage", description: "Manage outcomes, mappings, and attainment policies." },
  {
    key: "certificates.manage",
    description: "Configure completion rules and issue, reissue, or revoke certificates.",
  },
  { key: "audit.read", description: "Read audit events in scope." },
  { key: "integrations.manage", description: "Configure external integrations." },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map(
  (permission) => permission.key,
);

const permissionKeySet: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeySet.has(value);
}

export type RoleScopeName = "platform" | "tenant";

export type RoleDefinition = {
  key: string;
  name: string;
  scope: RoleScopeName;
  permissions: readonly PermissionKey[];
};

/**
 * Platform roles are global (tenantId = null) and never grant access to a
 * tenant's learning records.
 */
export const PLATFORM_ROLES: readonly RoleDefinition[] = [
  {
    key: "platform_super_admin",
    name: "Platform super admin",
    scope: "platform",
    permissions: ["tenant.manage", "audit.read"],
  },
];

export const TENANT_ROLES: readonly RoleDefinition[] = [
  {
    key: "institution_admin",
    name: "Institution admin",
    scope: "tenant",
    permissions: [
      "institution.settings.read",
      "institution.settings.manage",
      "users.read",
      "users.create",
      "users.update",
      "users.deactivate",
      "roles.assign",
      "users.import",
      "academic_structure.manage",
      "courses.create",
      "courses.read",
      "courses.update",
      "courses.publish",
      "courses.archive",
      "enrolments.manage",
      "content.create",
      "content.publish",
      "content.delete",
      "assessments.manage",
      "submissions.grade",
      "grades.read",
      "grades.update",
      "grades.publish",
      "attendance.manage",
      "attendance.read",
      "sessions.manage",
      "announcements.manage",
      "discussions.moderate",
      "reports.course.read",
      "reports.institution.read",
      "obe.manage",
      "certificates.manage",
      "audit.read",
      "integrations.manage",
    ],
  },
  {
    key: "academic_coordinator",
    name: "Academic coordinator",
    scope: "tenant",
    permissions: [
      "users.read",
      "courses.read",
      "attendance.read",
      "grades.read",
      "reports.course.read",
      "reports.institution.read",
      "obe.manage",
      "audit.read",
    ],
  },
  {
    key: "faculty",
    name: "Faculty",
    scope: "tenant",
    permissions: [
      "users.read",
      "courses.read",
      "content.create",
      "content.publish",
      "content.delete",
      "assessments.manage",
      "submissions.grade",
      "grades.read",
      "grades.update",
      "grades.publish",
      "attendance.manage",
      "attendance.read",
      "sessions.manage",
      "announcements.manage",
      "discussions.moderate",
      "reports.course.read",
      "obe.manage",
      "certificates.manage",
    ],
  },
  {
    key: "teaching_assistant",
    name: "Teaching assistant",
    scope: "tenant",
    permissions: [
      "users.read",
      "courses.read",
      "content.create",
      "submissions.grade",
      "attendance.read",
      "grades.read",
    ],
  },
  {
    key: "student",
    name: "Student",
    scope: "tenant",
    permissions: ["courses.read", "submissions.submit", "grades.read", "attendance.read"],
  },
];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [...PLATFORM_ROLES, ...TENANT_ROLES];

export function roleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((role) => role.key === key);
}
