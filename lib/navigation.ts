/**
 * Role-aware navigation configuration.
 *
 * This is presentation metadata only. It is never an access control: every
 * destination is protected on the server by authentication and permission
 * checks (see docs/decisions/0002). Entries without an `href` describe planned
 * modules and are deliberately not rendered as links.
 *
 * Phase 1 defines the four primary roles. Coordinator, evaluator, and observer
 * roles arrive with the permission catalogue in Phase 2 and extend this file.
 */

export const ROLE_KEYS = ["platform_admin", "institution_admin", "faculty", "student"] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleMeta = {
  label: string;
  dashboardPath: string;
  summary: string;
};

export const ROLES: Record<RoleKey, RoleMeta> = {
  platform_admin: {
    label: "Platform super admin",
    dashboardPath: "/platform",
    summary: "Manages institutions, platform health, and global policy — not their learning data.",
  },
  institution_admin: {
    label: "Institution admin",
    dashboardPath: "/admin",
    summary: "Configures the institution, people, academic structure, and course operations.",
  },
  faculty: {
    label: "Faculty",
    dashboardPath: "/faculty",
    summary: "Teaches assigned courses, publishes content, and assesses enrolled learners.",
  },
  student: {
    label: "Student",
    dashboardPath: "/student",
    summary: "Learns in enrolled courses and sees only their own submissions and released grades.",
  },
};

export type NavEntry = {
  key: string;
  label: string;
  /** Present only for destinations that exist today. */
  href?: string;
  /** Build phase that delivers this module. */
  phase: number;
  description?: string;
};

export type NavSection = {
  key: string;
  label: string;
  entries: readonly NavEntry[];
};

export const NAVIGATION: Record<RoleKey, readonly NavSection[]> = {
  platform_admin: [
    {
      key: "overview",
      label: "Overview",
      entries: [{ key: "dashboard", label: "Platform overview", href: "/platform", phase: 1 }],
    },
    {
      key: "tenancy",
      label: "Tenancy",
      entries: [
        {
          key: "institutions",
          label: "Institutions",
          phase: 12,
          description: "Create, suspend, and configure tenants.",
        },
        {
          key: "support-access",
          label: "Support access",
          phase: 12,
          description: "Time-boxed, audited access grants for tenant support.",
        },
        {
          key: "platform-audit",
          label: "Platform audit",
          phase: 12,
          description: "Aggregate security and operations events.",
        },
      ],
    },
  ],
  institution_admin: [
    {
      key: "overview",
      label: "Overview",
      entries: [{ key: "dashboard", label: "Institution overview", href: "/admin", phase: 1 }],
    },
    {
      key: "people",
      label: "People",
      entries: [
        {
          key: "people-directory",
          label: "People directory",
          href: "/admin/users",
          phase: 3,
          description: "Members, roles, and invitations.",
        },
        { key: "students", label: "Student views", phase: 5 },
        { key: "roles", label: "Roles and permissions", phase: 3 },
        {
          key: "imports",
          label: "Imports",
          href: "/admin/imports",
          phase: 4,
          description: "CSV previews, commits, and import history.",
        },
      ],
    },
    {
      key: "academic-setup",
      label: "Academic setup",
      entries: [
        {
          key: "years",
          label: "Academic years and terms",
          href: "/admin/academics",
          phase: 4,
        },
        {
          key: "departments",
          label: "Departments and programmes",
          href: "/admin/academics/departments",
          phase: 4,
        },
        {
          key: "sections",
          label: "Cohorts and sections",
          href: "/admin/academics/cohorts",
          phase: 4,
        },
        {
          key: "courses",
          label: "Course catalogue",
          href: "/admin/courses",
          phase: 4,
        },
        {
          key: "offerings",
          label: "Course offerings and rosters",
          href: "/admin/offerings",
          phase: 4,
        },
      ],
    },
    {
      key: "course-operations",
      label: "Course operations",
      entries: [{ key: "publication", label: "Publication status", phase: 5 }],
    },
    {
      key: "assessment",
      label: "Assessment",
      entries: [
        { key: "grade-release", label: "Grade release", phase: 6 },
        { key: "question-banks", label: "Question banks", phase: 7 },
      ],
    },
    {
      key: "operations",
      label: "Operations",
      entries: [
        { key: "attendance", label: "Attendance and live classes", phase: 9 },
        { key: "calendar", label: "Calendar", href: "/calendar", phase: 9 },
        { key: "analytics", label: "Learning analytics", phase: 8 },
        { key: "obe", label: "OBE and accreditation", phase: 10 },
        { key: "settings", label: "Institution settings", phase: 3 },
      ],
    },
  ],
  faculty: [
    {
      key: "overview",
      label: "Overview",
      entries: [{ key: "dashboard", label: "My dashboard", href: "/faculty", phase: 1 }],
    },
    {
      key: "teaching",
      label: "Teaching",
      entries: [
        {
          key: "courses",
          label: "My courses",
          href: "/faculty/courses",
          phase: 5,
          description: "Modules, lessons, publication, and preview.",
        },
        { key: "announcements", label: "Announcements and discussions", phase: 9 },
      ],
    },
    {
      key: "assessment",
      label: "Assessment",
      entries: [
        {
          key: "assignments",
          label: "Assignments",
          href: "/faculty/assignments",
          phase: 6,
          description: "Create assignments, grade submissions, and release results.",
        },
        { key: "quizzes", label: "Quizzes and question banks", phase: 7 },
        { key: "gradebook", label: "Gradebook", phase: 8 },
      ],
    },
    {
      key: "delivery",
      label: "Delivery",
      entries: [
        { key: "live-classes", label: "Live classes", phase: 9 },
        { key: "attendance", label: "Attendance", phase: 9 },
        { key: "calendar", label: "Calendar", href: "/calendar", phase: 9 },
      ],
    },
    {
      key: "insights",
      label: "Insights",
      entries: [
        { key: "progress", label: "Learner progress", phase: 8 },
        { key: "reports", label: "Reports", phase: 8 },
        { key: "outcomes", label: "Course outcomes", phase: 10 },
      ],
    },
  ],
  student: [
    {
      key: "overview",
      label: "Overview",
      entries: [{ key: "dashboard", label: "My learning", href: "/student", phase: 1 }],
    },
    {
      key: "learning",
      label: "Learning",
      entries: [
        {
          key: "courses",
          label: "My courses",
          href: "/student/courses",
          phase: 5,
          description: "Published lessons you are enrolled in.",
        },
        { key: "calendar", label: "Calendar and to-do", href: "/calendar", phase: 9 },
      ],
    },
    {
      key: "assessment",
      label: "Assessment",
      entries: [
        {
          key: "assignments",
          label: "Assignments",
          href: "/student/assignments",
          phase: 6,
          description: "Deadlines, submissions, and released feedback.",
        },
        { key: "quizzes", label: "Quizzes", phase: 7 },
      ],
    },
    {
      key: "community",
      label: "Community",
      entries: [
        { key: "discussions", label: "Discussions", phase: 9 },
        { key: "live-classes", label: "Live classes", phase: 9 },
      ],
    },
    {
      key: "progress",
      label: "Progress",
      entries: [
        {
          key: "certificates",
          label: "Certificates",
          href: "/student/certificates",
          phase: 11,
          description: "Awards issued to you and how close each course is to eligibility.",
        },
        { key: "notifications", label: "Notifications", href: "/notifications", phase: 9 },
      ],
    },
  ],
};

type ImplementedNavEntry = NavEntry & { href: string };

/** Sections with their currently reachable destinations only. */
export function visibleNavigation(role: RoleKey): Array<{
  key: string;
  label: string;
  entries: ImplementedNavEntry[];
}> {
  return NAVIGATION[role]
    .map((section) => ({
      key: section.key,
      label: section.label,
      entries: section.entries.filter(
        (entry): entry is ImplementedNavEntry => typeof entry.href === "string",
      ),
    }))
    .filter((section) => section.entries.length > 0);
}

/** Modules that are configured but not built yet, grouped by section. */
export function plannedNavigation(role: RoleKey): Array<{
  key: string;
  label: string;
  entries: NavEntry[];
}> {
  return NAVIGATION[role]
    .map((section) => ({
      key: section.key,
      label: section.label,
      entries: section.entries.filter((entry) => entry.href === undefined),
    }))
    .filter((section) => section.entries.length > 0);
}
