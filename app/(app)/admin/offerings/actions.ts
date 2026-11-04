"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { attempt, safeReturnTo, withMessage } from "@/lib/forms/server-action";
import {
  addInstructor,
  createOffering,
  enrolStudent,
  removeInstructor,
  setEnrolmentStatus,
  updateOffering,
} from "@/modules/academics/course-service";

const PREFIXES = ["/admin/offerings"] as const;

function path(formData: FormData, fallback = "/admin/offerings"): string {
  return safeReturnTo(formData.get("returnTo"), PREFIXES, fallback);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function createOfferingAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    createOffering(
      account,
      {
        courseId: text(formData, "courseId"),
        termId: text(formData, "termId"),
        sectionId: text(formData, "sectionId"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
        status: text(formData, "status") || "DRAFT",
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Course offering created.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function updateOfferingAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    updateOffering(
      account,
      text(formData, "id"),
      {
        courseId: text(formData, "courseId"),
        termId: text(formData, "termId"),
        sectionId: text(formData, "sectionId"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
        status: text(formData, "status") || "DRAFT",
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Course offering updated.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function addInstructorAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    addInstructor(
      account,
      {
        courseOfferingId: text(formData, "courseOfferingId"),
        email: text(formData, "email"),
        assignmentRole: text(formData, "assignmentRole") || "PRIMARY",
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Instructor assigned.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function removeInstructorAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    removeInstructor(account, text(formData, "id"), {
      requestId: await currentRequestId(),
    }),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", "Instructor removed.")
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function enrolStudentAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);

  const outcome = await attempt(async () =>
    enrolStudent(
      account,
      {
        courseOfferingId: text(formData, "courseOfferingId"),
        email: text(formData, "email"),
      },
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(
          returnTo,
          "notice",
          outcome.value.reactivated
            ? "Enrolment reactivated."
            : "Learner enrolled in this offering.",
        )
      : withMessage(returnTo, "error", outcome.message),
  );
}

export async function setEnrolmentStatusAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = path(formData);
  const status = text(formData, "status");

  const outcome = await attempt(async () =>
    setEnrolmentStatus(
      account,
      text(formData, "id"),
      status as "ACTIVE" | "WITHDRAWN" | "COMPLETED",
      { requestId: await currentRequestId() },
    ),
  );

  redirect(
    outcome.ok
      ? withMessage(returnTo, "notice", `Enrolment marked ${status.toLowerCase()}.`)
      : withMessage(returnTo, "error", outcome.message),
  );
}
