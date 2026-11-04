import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import type { AuthoringItem, AuthoringModule } from "@/modules/content/content-service";

import {
  createItemAction,
  createModuleAction,
  deleteItemAction,
  deleteModuleAction,
  moveItemAction,
  moveModuleAction,
  updateItemAction,
  updateModuleAction,
} from "./actions";

function toLocalInput(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 16);
}

const KIND_LABELS = {
  RICH_TEXT: "Rich text lesson",
  FILE: "File download",
  LINK: "External link",
  VIDEO_LINK: "Video link",
} as const;

export function ModuleForm({
  offeringId,
  module,
  modules,
  returnTo,
}: {
  offeringId: string;
  module?: AuthoringModule;
  modules: AuthoringModule[];
  returnTo: string;
}) {
  const others = modules.filter((candidate) => candidate.id !== module?.id);

  return (
    <details className="rounded-card border-border bg-surface shadow-card border">
      <summary className="text-ink cursor-pointer px-4 py-3 text-sm font-medium">
        {module ? `Edit “${module.title}”` : "Add a module"}
      </summary>
      <form
        action={module ? updateModuleAction : createModuleAction}
        className="border-border flex flex-col gap-3 border-t p-4"
      >
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {module ? <input type="hidden" name="moduleId" value={module.id} /> : null}

        <Input
          id={`module-title-${module?.id ?? "new"}`}
          name="title"
          label="Module title"
          defaultValue={module?.title ?? ""}
          required
          maxLength={160}
        />
        <Textarea
          id={`module-description-${module?.id ?? "new"}`}
          name="description"
          label="Summary"
          hint="Optional. Shown above the module's lessons."
          defaultValue={module?.description ?? ""}
          rows={2}
        />
        <Select
          id={`module-status-${module?.id ?? "new"}`}
          name="status"
          label="Visibility"
          defaultValue={module?.status ?? "DRAFT"}
        >
          <option value="DRAFT">Draft — only staff can see it</option>
          <option value="PUBLISHED">
            Published — learners see it once the course is published
          </option>
        </Select>

        {others.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink text-sm font-medium">Prerequisite modules</legend>
            <p className="text-ink-muted text-sm">
              The module stays locked until every selected module is complete.
            </p>
            <div className="flex flex-col gap-1.5">
              {others.map((candidate) => (
                <label key={candidate.id} className="text-ink flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="prerequisiteModuleIds"
                    value={candidate.id}
                    defaultChecked={module?.prerequisiteModuleIds.includes(candidate.id)}
                    className="h-4 w-4"
                  />
                  {candidate.title}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div>
          <Button type="submit" size="sm">
            {module ? "Save module" : "Add module"}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function ItemForm({
  offeringId,
  moduleId,
  item,
  returnTo,
}: {
  offeringId: string;
  moduleId: string;
  item?: AuthoringItem;
  returnTo: string;
}) {
  const suffix = item?.id ?? moduleId;
  return (
    <details className="rounded-lg border border-dashed">
      <summary className="text-ink cursor-pointer px-3 py-2 text-sm font-medium">
        {item ? `Edit “${item.title}”` : "Add a lesson or resource"}
      </summary>
      <form
        action={item ? updateItemAction : createItemAction}
        className="border-border flex flex-col gap-3 border-t p-3"
      >
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="moduleId" value={moduleId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

        <Input
          id={`item-title-${suffix}`}
          name="title"
          label="Title"
          defaultValue={item?.title ?? ""}
          required
          maxLength={160}
        />
        <Select
          id={`item-kind-${suffix}`}
          name="kind"
          label="Type"
          defaultValue={item?.kind ?? "RICH_TEXT"}
          hint="Choose the type first; only the matching field below is used."
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Textarea
          id={`item-body-${suffix}`}
          name="body"
          label="Lesson text (rich text)"
          hint="Used by “Rich text lesson”. Formatting is saved as HTML and sanitised before it is shown."
          defaultValue={item?.body ?? ""}
          rows={6}
          maxLength={40000}
        />
        <Input
          id={`item-url-${suffix}`}
          name="url"
          type="url"
          label="Link URL"
          hint="Used by “External link” and “Video link”. Must start with http:// or https://."
          defaultValue={item?.url ?? ""}
        />
        <Input
          id={`item-file-${suffix}`}
          name="file"
          type="file"
          label={item?.fileName ? `Replace file (current: ${item.fileName})` : "File"}
          hint="Used by “File download”. Up to 25 MB, stored privately."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id={`item-from-${suffix}`}
            name="availableFrom"
            type="datetime-local"
            label="Opens"
            hint="Optional."
            defaultValue={toLocalInput(item?.availableFrom ?? null)}
          />
          <Input
            id={`item-until-${suffix}`}
            name="availableUntil"
            type="datetime-local"
            label="Closes"
            hint="Optional."
            defaultValue={toLocalInput(item?.availableUntil ?? null)}
          />
        </div>

        <Select
          id={`item-status-${suffix}`}
          name="status"
          label="Visibility"
          defaultValue={item?.status ?? "DRAFT"}
        >
          <option value="DRAFT">Draft — only staff can see it</option>
          <option value="PUBLISHED">
            Published — learners see it once the course is published
          </option>
        </Select>

        <div>
          <Button type="submit" size="sm">
            {item ? "Save item" : "Add item"}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function ModuleControls({
  offeringId,
  module,
  index,
  total,
  returnTo,
}: {
  offeringId: string;
  module: AuthoringModule;
  index: number;
  total: number;
  returnTo: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={moveModuleAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="moduleId" value={module.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="direction" value="up" />
        <Button type="submit" variant="ghost" size="sm" disabled={index === 0}>
          Move up
        </Button>
      </form>
      <form action={moveModuleAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="moduleId" value={module.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="direction" value="down" />
        <Button type="submit" variant="ghost" size="sm" disabled={index === total - 1}>
          Move down
        </Button>
      </form>
      <form action={deleteModuleAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="moduleId" value={module.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Button type="submit" variant="ghost" size="sm">
          Delete module
        </Button>
      </form>
    </div>
  );
}

export function ItemControls({
  offeringId,
  item,
  index,
  total,
  returnTo,
}: {
  offeringId: string;
  item: AuthoringItem;
  index: number;
  total: number;
  returnTo: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={moveItemAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="direction" value="up" />
        <Button type="submit" variant="ghost" size="sm" disabled={index === 0}>
          Move up
        </Button>
      </form>
      <form action={moveItemAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="direction" value="down" />
        <Button type="submit" variant="ghost" size="sm" disabled={index === total - 1}>
          Move down
        </Button>
      </form>
      <form action={deleteItemAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Button type="submit" variant="ghost" size="sm">
          Delete
        </Button>
      </form>
    </div>
  );
}
