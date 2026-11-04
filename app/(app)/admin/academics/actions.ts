"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  addCohortMember,
  createAcademicYear,
  createCohort,
  createDepartment,
  createProgramme,
  createSection,
  createTerm,
  removeCohortMember,
  setAcademicYearStatus,
  setProgrammeStatus,
  updateAcademicYear,
  updateCohort,
  updateDepartment,
  updateProgramme,
  updateSection,
  updateTerm,
} from "@/modules/academics/structure-service";

const PREFIXES = ["/admin/academics"] as const;

function path(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, "/admin/academics");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function createYearAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createAcademicYear(
      account,
      {
        name: text(formData, "name"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Academic year created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateYearAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateAcademicYear(
      account,
      text(formData, "id"),
      {
        name: text(formData, "name"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Academic year updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function setYearStatusAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const status = text(formData, "status");

  const outcome = await attempt(async () =>
    setAcademicYearStatus(
      account,
      text(formData, "id"),
      status as "PLANNED" | "ACTIVE" | "ARCHIVED",
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Academic year marked ${status.toLowerCase()}.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function createTermAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createTerm(
      account,
      {
        academicYearId: text(formData, "academicYearId"),
        name: text(formData, "name"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Term created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateTermAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateTerm(
      account,
      text(formData, "id"),
      {
        academicYearId: text(formData, "academicYearId"),
        name: text(formData, "name"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Term updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function createDepartmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createDepartment(
      account,
      {
        name: text(formData, "name"),
        code: text(formData, "code"),
        parentDepartmentId: text(formData, "parentDepartmentId"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Department created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateDepartmentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateDepartment(
      account,
      text(formData, "id"),
      {
        name: text(formData, "name"),
        code: text(formData, "code"),
        parentDepartmentId: text(formData, "parentDepartmentId"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Department updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function createProgrammeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createProgramme(
      account,
      {
        departmentId: text(formData, "departmentId"),
        name: text(formData, "name"),
        code: text(formData, "code"),
        level: text(formData, "level"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Programme created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateProgrammeAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateProgramme(
      account,
      text(formData, "id"),
      {
        departmentId: text(formData, "departmentId"),
        name: text(formData, "name"),
        code: text(formData, "code"),
        level: text(formData, "level"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Programme updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function setProgrammeStatusAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const status = text(formData, "status");

  const outcome = await attempt(async () =>
    setProgrammeStatus(account, text(formData, "id"), status as "ACTIVE" | "ARCHIVED", {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Programme marked ${status.toLowerCase()}.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function createCohortAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createCohort(
      account,
      {
        programmeId: text(formData, "programmeId"),
        academicYearId: text(formData, "academicYearId"),
        name: text(formData, "name"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Cohort created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateCohortAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateCohort(
      account,
      text(formData, "id"),
      {
        programmeId: text(formData, "programmeId"),
        academicYearId: text(formData, "academicYearId"),
        name: text(formData, "name"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Cohort updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function createSectionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createSection(
      account,
      {
        cohortId: text(formData, "cohortId"),
        name: text(formData, "name"),
        capacity: text(formData, "capacity"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Section created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateSectionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateSection(
      account,
      text(formData, "id"),
      {
        cohortId: text(formData, "cohortId"),
        name: text(formData, "name"),
        capacity: text(formData, "capacity"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Section updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function addCohortMemberAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    addCohortMember(
      account,
      { cohortId: text(formData, "cohortId"), email: text(formData, "email") },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Person added to the cohort.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function removeCohortMemberAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    removeCohortMember(account, text(formData, "id"), { requestId: await currentRequestId() }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Person removed from the cohort.")
      : withMessage(returnTo, "error", outcome.message),
  );
}
