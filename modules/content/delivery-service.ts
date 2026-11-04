import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";

import { availabilityState, computeModuleLocks, type ModuleLock } from "./visibility";

/**
 * Learner-facing course delivery.
 *
 * A learner sees a course only when all of these hold: they have an ACTIVE
 * enrolment in that offering, the offering is published, the item is published,
 * the item is inside its availability window, and every prerequisite module is
 * complete. Teachers and administrators can preview the same course while it is
 * still a draft.
 *
 * Every check is repeated on the server for each request; the viewer's locked
 * badges are explanation, not enforcement.
 */

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

async function offeringForLearner(account: AccountContext, offeringId: string, db: DatabaseClient) {
  const tenantId = tenantIdOf(account);
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: {
      id: true,
      status: true,
      startsOn: true,
      endsOn: true,
      course: { select: { code: true, title: true, credits: true } },
      term: { select: { name: true, academicYear: { select: { name: true } } } },
      section: { select: { name: true } },
      instructors: { select: { userId: true, user: { select: { name: true } } } },
      enrolments: {
        where: { userId: account.user.id },
        select: { status: true },
      },
      _count: { select: { enrolments: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!offering) throw new ResourceNotFoundError();

  const enrolment = offering.enrolments[0];
  const isEnrolled = enrolment?.status === "ACTIVE";
  const isInstructor = offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");

  return {
    offering,
    isEnrolled,
    canPreview: isInstructor || isAdministrator,
  };
}

type LoadedModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  status: "DRAFT" | "PUBLISHED";
  prerequisiteModuleIds: string[];
  items: Array<{
    id: string;
    title: string;
    kind: "RICH_TEXT" | "FILE" | "LINK" | "VIDEO_LINK";
    body: string | null;
    url: string | null;
    fileName: string | null;
    fileSize: number | null;
    hasFile: boolean;
    position: number;
    status: "DRAFT" | "PUBLISHED";
    availableFrom: Date | null;
    availableUntil: Date | null;
  }>;
};

async function loadModules(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
): Promise<LoadedModule[]> {
  const modules = await db.courseModule.findMany({
    where: { tenantId, courseOfferingId: offeringId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      position: true,
      status: true,
      prerequisites: { select: { prerequisiteModuleId: true } },
      items: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          kind: true,
          body: true,
          url: true,
          fileName: true,
          fileSize: true,
          storageKey: true,
          position: true,
          status: true,
          availableFrom: true,
          availableUntil: true,
        },
      },
    },
  });

  return modules.map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    position: module.position,
    status: module.status,
    prerequisiteModuleIds: module.prerequisites.map((edge) => edge.prerequisiteModuleId),
    items: module.items.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      body: item.body,
      url: item.url,
      fileName: item.fileName,
      fileSize: item.fileSize,
      hasFile: Boolean(item.storageKey),
      position: item.position,
      status: item.status,
      availableFrom: item.availableFrom,
      availableUntil: item.availableUntil,
    })),
  }));
}

/** Everything the delivery layer needs to decide visibility for one learner. */
type DeliveryState = {
  modules: LoadedModule[];
  locks: Map<string, ModuleLock>;
  completedItemIds: Set<string>;
  titlesById: Map<string, string>;
};

async function deliveryState(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
  userId: string,
  now: Date,
): Promise<DeliveryState> {
  const [modules, progress] = await Promise.all([
    loadModules(db, tenantId, offeringId),
    db.contentProgress.findMany({
      where: {
        tenantId,
        userId,
        status: "COMPLETED",
        item: { module: { courseOfferingId: offeringId } },
      },
      select: { contentItemId: true },
    }),
  ]);

  const completedItemIds = new Set(progress.map((row) => row.contentItemId));
  const visibleItemIdsByModule = new Map(
    modules.map((module) => [
      module.id,
      module.items
        .filter((item) => item.status === "PUBLISHED" && availabilityState(item, now) === "open")
        .map((item) => item.id),
    ]),
  );

  const locks = computeModuleLocks({
    modules: modules.map((module) => ({
      id: module.id,
      status: module.status,
      prerequisiteModuleIds: module.prerequisiteModuleIds,
    })),
    visibleItemIdsByModule,
    completedItemIds,
  });

  return {
    modules,
    locks,
    completedItemIds,
    titlesById: new Map(modules.map((module) => [module.id, module.title])),
  };
}

export type LearnerItemState = "open" | "not_yet" | "closed" | "locked";

export type LearnerItem = {
  id: string;
  title: string;
  kind: "RICH_TEXT" | "FILE" | "LINK" | "VIDEO_LINK";
  position: number;
  state: LearnerItemState;
  completed: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  fileName: string | null;
  fileSize: number | null;
  /** Content is present only for the item currently being viewed, when open. */
  body: string | null;
  url: string | null;
};

export type LearnerModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  locked: boolean;
  unmetPrerequisiteTitles: string[];
  items: LearnerItem[];
};

export type LearnerCourse = {
  offering: {
    id: string;
    courseCode: string;
    courseTitle: string;
    credits: string;
    termName: string;
    academicYearName: string;
    sectionName: string | null;
    status: "DRAFT" | "PUBLISHED" | "CLOSED";
    startsOn: Date | null;
    endsOn: Date | null;
    instructorNames: string[];
    activeLearners: number;
  };
  mode: "learner" | "preview";
  modules: LearnerModule[];
  activeItem: LearnerItem | null;
  progress: { completed: number; total: number };
};

/**
 * The learner course view. `preview` opens the same page for a teacher before
 * publication: drafts become visible, and every item is openable.
 */
export async function getCourseView(
  account: AccountContext,
  offeringId: string,
  options: { itemId?: string; now?: Date; mode?: "auto" | "preview" } = {},
  db: DatabaseClient = getDb(),
): Promise<LearnerCourse> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const now = options.now ?? new Date();
  const { offering, isEnrolled, canPreview } = await offeringForLearner(account, offeringId, db);

  const wantsPreview = options.mode === "preview";
  if (wantsPreview && !canPreview) {
    throw new PermissionDeniedError("Only teaching staff can preview this course.");
  }
  if (!wantsPreview) {
    if (offering.status !== "PUBLISHED") {
      // A learner reaching an unpublished course is told it does not exist;
      // staff can still preview it through the editor.
      if (!canPreview) throw new ResourceNotFoundError();
    } else if (!isEnrolled && !canPreview) {
      throw new PermissionDeniedError("You are not enrolled in this course.");
    }
  }

  const mode: "learner" | "preview" =
    wantsPreview || (!isEnrolled && canPreview) ? "preview" : "learner";
  const state = await deliveryState(db, tenantId, offeringId, account.user.id, now);

  const visibleModules = state.modules.filter(
    (module) => mode === "preview" || module.status === "PUBLISHED",
  );
  const lockOf = (moduleId: string) =>
    state.locks.get(moduleId) ?? { locked: false, unmetPrerequisiteIds: [] };

  const itemIsOpen = (module: LoadedModule, item: LoadedModule["items"][number]): boolean => {
    if (mode === "preview") return true;
    if (module.status !== "PUBLISHED" || item.status !== "PUBLISHED") return false;
    if (lockOf(module.id).locked) return false;
    return availabilityState(item, now) === "open";
  };

  const candidates = visibleModules.flatMap((module) =>
    module.items.map((item) => ({ module, item })),
  );
  // An explicit item is honoured only when it is actually open to this viewer;
  // otherwise the page shows a clear "not available" message instead of the
  // content. Without an explicit item, the first open lesson is selected.
  const activeEntry = options.itemId
    ? candidates.find(({ module, item }) => item.id === options.itemId && itemIsOpen(module, item))
    : candidates.find(({ module, item }) => itemIsOpen(module, item));
  const activeId = activeEntry?.item.id ?? null;

  const modules: LearnerModule[] = visibleModules.map((module) => {
    const lock = lockOf(module.id);
    const items = module.items
      .filter((item) => mode === "preview" || item.status === "PUBLISHED")
      .map((item): LearnerItem => {
        const availability = availabilityState(item, now);
        const itemState: LearnerItemState =
          mode === "preview" ? "open" : lock.locked ? "locked" : availability;
        const isActive = activeId === item.id;
        return {
          id: item.id,
          title: item.title,
          kind: item.kind,
          position: item.position,
          state: itemState,
          completed: state.completedItemIds.has(item.id),
          opensAt: item.availableFrom,
          closesAt: item.availableUntil,
          fileName: item.fileName,
          fileSize: item.fileSize,
          body: isActive ? item.body : null,
          url: isActive ? item.url : null,
        };
      });

    return {
      id: module.id,
      title: module.title,
      description: module.description,
      position: module.position,
      locked: mode === "preview" ? false : lock.locked,
      unmetPrerequisiteTitles: lock.unmetPrerequisiteIds.map(
        (id) => state.titlesById.get(id) ?? "an earlier module",
      ),
      items,
    };
  });

  const allItems = modules.flatMap((module) => module.items);
  const activeItem = activeId
    ? (allItems.find((item) => item.id === activeId && item.state === "open") ?? null)
    : null;

  return {
    offering: {
      id: offering.id,
      courseCode: offering.course.code,
      courseTitle: offering.course.title,
      credits: offering.course.credits.toFixed(1),
      termName: offering.term.name,
      academicYearName: offering.term.academicYear.name,
      sectionName: offering.section?.name ?? null,
      status: offering.status,
      startsOn: offering.startsOn,
      endsOn: offering.endsOn,
      instructorNames: offering.instructors.map((instructor) => instructor.user.name),
      activeLearners: offering._count.enrolments,
    },
    mode,
    modules,
    activeItem,
    progress: {
      completed: allItems.filter((item) => item.completed).length,
      total: allItems.length,
    },
  };
}

export type LearnerCourseCard = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  instructorNames: string[];
  itemCount: number;
  completedCount: number;
  lastActivityAt: Date | null;
};

/** Published courses the signed-in learner is actively enrolled in. */
export async function listLearnerCourses(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<LearnerCourseCard[]> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const offerings = await db.courseOffering.findMany({
    where: {
      tenantId,
      status: "PUBLISHED",
      enrolments: { some: { userId: account.user.id, status: "ACTIVE" } },
    },
    orderBy: [{ term: { startsOn: "desc" } }, { course: { code: "asc" } }],
    select: {
      id: true,
      course: { select: { code: true, title: true } },
      term: { select: { name: true, academicYear: { select: { name: true } } } },
      instructors: { select: { user: { select: { name: true } } } },
      modules: {
        select: {
          status: true,
          items: {
            where: { status: "PUBLISHED" },
            select: {
              id: true,
              progress: {
                where: { userId: account.user.id },
                select: { status: true, lastViewedAt: true },
              },
            },
          },
        },
      },
    },
  });

  return offerings.map((offering) => {
    const items = offering.modules
      .filter((module) => module.status === "PUBLISHED")
      .flatMap((module) => module.items);
    const completed = items.filter((item) => item.progress[0]?.status === "COMPLETED").length;
    const lastActivity = items
      .map((item) => item.progress[0]?.lastViewedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      offeringId: offering.id,
      courseCode: offering.course.code,
      courseTitle: offering.course.title,
      termName: offering.term.name,
      academicYearName: offering.term.academicYear.name,
      instructorNames: offering.instructors.map((instructor) => instructor.user.name),
      itemCount: items.length,
      completedCount: completed,
      lastActivityAt: lastActivity ?? null,
    };
  });
}

/**
 * Authorisation for a single stored file. Teachers and administrators may read
 * any item of an offering they manage; a learner needs an active enrolment, a
 * published offering, a published and available item, and an unlocked module.
 */
export async function canAccessOfferingItem(
  account: AccountContext,
  offeringId: string,
  itemId: string,
  db: DatabaseClient = getDb(),
): Promise<boolean> {
  const tenantId = tenantIdOf(account);
  const { isEnrolled, canPreview } = await offeringForLearner(account, offeringId, db);
  if (canPreview) return true;
  if (!isEnrolled) return false;

  const now = new Date();
  const state = await deliveryState(db, tenantId, offeringId, account.user.id, now);
  const courseModule = state.modules.find((candidate) =>
    candidate.items.some((item) => item.id === itemId),
  );
  if (!courseModule) return false;
  if (courseModule.status !== "PUBLISHED") return false;
  if (state.locks.get(courseModule.id)?.locked) return false;

  const item = courseModule.items.find((candidate) => candidate.id === itemId);
  if (!item) return false;
  return item.status === "PUBLISHED" && availabilityState(item, now) === "open";
}

async function assertItemAccess(
  account: AccountContext,
  itemId: string,
  db: DatabaseClient,
): Promise<{ offeringId: string; itemTitle: string }> {
  const tenantId = tenantIdOf(account);
  const item = await db.contentItem.findFirst({
    where: { id: itemId, tenantId },
    select: {
      id: true,
      title: true,
      module: { select: { courseOfferingId: true } },
    },
  });
  if (!item) throw new ResourceNotFoundError();

  const allowed = await canAccessOfferingItem(account, item.module.courseOfferingId, item.id, db);
  if (!allowed) throw new PermissionDeniedError("This lesson is not available to you.");
  return { offeringId: item.module.courseOfferingId, itemTitle: item.title };
}

/** Records that a learner opened an item. Idempotent per item per learner. */
export async function recordItemViewed(
  account: AccountContext,
  itemId: string,
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const { offeringId } = await assertItemAccess(account, itemId, db);
  const now = new Date();

  await db.$transaction(async (tx) => {
    const existing = await tx.contentProgress.findUnique({
      where: { contentItemId_userId: { contentItemId: itemId, userId: account.user.id } },
      select: { id: true, status: true, firstViewedAt: true },
    });

    if (existing) {
      await tx.contentProgress.update({
        where: { id: existing.id },
        data: {
          // Viewing again never undoes a completion.
          status: existing.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
          lastViewedAt: now,
          firstViewedAt: existing.firstViewedAt ?? now,
        },
      });
    } else {
      await tx.contentProgress.create({
        data: {
          tenantId,
          contentItemId: itemId,
          userId: account.user.id,
          status: "IN_PROGRESS",
          firstViewedAt: now,
          lastViewedAt: now,
        },
      });
    }

    await tx.learningEvent.create({
      data: {
        tenantId,
        userId: account.user.id,
        courseOfferingId: offeringId,
        contentItemId: itemId,
        type: "content.viewed",
        metadata: { source: "viewer" },
      },
    });
  });
}

/** Marks a lesson complete or reopens it. Completion is learner-declared in Phase 5. */
export async function setItemCompleted(
  account: AccountContext,
  itemId: string,
  completed: boolean,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const { offeringId, itemTitle } = await assertItemAccess(account, itemId, db);
  const now = new Date();

  await db.$transaction(async (tx) => {
    const existing = await tx.contentProgress.findUnique({
      where: { contentItemId_userId: { contentItemId: itemId, userId: account.user.id } },
      select: { id: true },
    });

    const status = completed ? "COMPLETED" : "IN_PROGRESS";
    if (existing) {
      await tx.contentProgress.update({
        where: { id: existing.id },
        data: {
          status,
          completedAt: completed ? now : null,
          lastViewedAt: now,
        },
      });
    } else {
      await tx.contentProgress.create({
        data: {
          tenantId,
          contentItemId: itemId,
          userId: account.user.id,
          status,
          firstViewedAt: now,
          lastViewedAt: now,
          completedAt: completed ? now : null,
        },
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: completed ? "content.item_completed" : "content.item_reopened",
      resourceType: "content_item",
      resourceId: itemId,
      after: { itemTitle },
      requestId: context.requestId,
    });

    await tx.learningEvent.create({
      data: {
        tenantId,
        userId: account.user.id,
        courseOfferingId: offeringId,
        contentItemId: itemId,
        type: completed ? "content.completed" : "content.reopened",
        metadata: {},
      },
    });
  });
}
