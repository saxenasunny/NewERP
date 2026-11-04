/**
 * Learner-visibility rules for course content.
 *
 * These are pure functions so the rules are unit-tested without a database and
 * reused by both the delivery service and the file-download route. The server
 * is the control: the UI mirrors the same rules for explanation only.
 */

export type PublishStatus = "DRAFT" | "PUBLISHED";

export type AvailabilityWindow = {
  availableFrom: Date | null;
  availableUntil: Date | null;
};

export type AvailabilityState = "open" | "not_yet" | "closed";

export function availabilityState(window: AvailabilityWindow, now: Date): AvailabilityState {
  if (window.availableFrom && now < window.availableFrom) return "not_yet";
  if (window.availableUntil && now > window.availableUntil) return "closed";
  return "open";
}

/** A learner may see an item only when it is published and inside its window. */
export function isLearnerVisible(
  item: AvailabilityWindow & { status: PublishStatus },
  now: Date,
): boolean {
  return item.status === "PUBLISHED" && availabilityState(item, now) === "open";
}

export type ModuleGraphNode = {
  id: string;
  status: PublishStatus;
  prerequisiteModuleIds: readonly string[];
};

export type ModuleLock = {
  /** Module is published and at least one prerequisite is not complete. */
  locked: boolean;
  /** Prerequisites that are not complete yet, in title order at the call site. */
  unmetPrerequisiteIds: string[];
};

/**
 * Computes which modules are locked for one learner.
 *
 * A module counts as complete when it is published, has at least one
 * learner-visible item, and every learner-visible item is completed. A module
 * with nothing visible yet therefore unlocks nothing, and an unpublished
 * prerequisite never satisfies a lock.
 */
export function computeModuleLocks({
  modules,
  visibleItemIdsByModule,
  completedItemIds,
}: {
  modules: readonly ModuleGraphNode[];
  visibleItemIdsByModule: ReadonlyMap<string, readonly string[]>;
  completedItemIds: ReadonlySet<string>;
}): Map<string, ModuleLock> {
  const byId = new Map(modules.map((module) => [module.id, module]));

  const completeModuleIds = new Set(
    modules
      .filter((module) => {
        if (module.status !== "PUBLISHED") return false;
        const visible = visibleItemIdsByModule.get(module.id) ?? [];
        return visible.length > 0 && visible.every((id) => completedItemIds.has(id));
      })
      .map((module) => module.id),
  );

  const locks = new Map<string, ModuleLock>();
  for (const courseModule of modules) {
    const unmet = courseModule.prerequisiteModuleIds.filter((id) => {
      const prerequisite = byId.get(id);
      return !prerequisite || prerequisite.status !== "PUBLISHED" || !completeModuleIds.has(id);
    });
    locks.set(courseModule.id, {
      locked: unmet.length > 0,
      unmetPrerequisiteIds: [...unmet],
    });
  }
  return locks;
}

/**
 * Adds one prerequisite edge and reports whether it would create a cycle.
 * Used by the authoring service before writing, so a module can never be its
 * own ancestor.
 */
export function wouldCreateCycle(
  edges: ReadonlyMap<string, readonly string[]>,
  moduleId: string,
  prerequisiteModuleId: string,
): boolean {
  if (moduleId === prerequisiteModuleId) return true;
  const seen = new Set<string>();
  const stack = [prerequisiteModuleId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === moduleId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of edges.get(current) ?? []) stack.push(next);
  }
  return false;
}
