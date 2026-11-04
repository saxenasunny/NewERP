import { describe, expect, it } from "vitest";

import {
  BASE_RETRY_DELAY_MS,
  MAX_DELIVERY_ATTEMPTS,
  retryDelayMs,
} from "@/modules/notifications/delivery-queue";
import { renderNotification } from "@/modules/notifications/templates";

describe("notification templates", () => {
  it("renders the in-app text and the email from one payload", () => {
    const rendered = renderNotification("announcement.published", {
      recipientName: "Ada Learner",
      href: "/student/courses/off-1/announcements",
      courseCode: "CS101",
      courseTitle: "Introduction to Programming",
      announcementTitle: "Lab moved",
      announcementBody: "Lab 3 moves to Thursday 10:00 in B204.",
    });

    expect(rendered.title).toBe("CS101: Lab moved");
    expect(rendered.body).toBe("Lab 3 moves to Thursday 10:00 in B204.");
    expect(rendered.subject).toBe("CS101: Lab moved");
    expect(rendered.emailBody).toContain("Hello Ada Learner,");
    expect(rendered.emailBody).toContain("Lab 3 moves to Thursday 10:00 in B204.");
  });

  it("shortens a long in-app preview without truncating the email", () => {
    const long = "x".repeat(400);
    const rendered = renderNotification("announcement.published", {
      recipientName: "Ada Learner",
      href: "/student/courses/off-1/announcements",
      courseCode: "CS101",
      courseTitle: "Introduction to Programming",
      announcementTitle: "Long notice",
      announcementBody: long,
    });

    expect(rendered.body.length).toBeLessThanOrEqual(240);
    expect(rendered.body.endsWith("…")).toBe(true);
    expect(rendered.emailBody).toContain(long);
  });

  it("rejects a payload that is missing a field, so a broken queue row is held", () => {
    expect(() =>
      renderNotification("session.reminder", {
        recipientName: "Ada Learner",
        href: "/student/courses/off-1/sessions",
        courseCode: "CS101",
      }),
    ).toThrow();
  });

  it("backs off exponentially and stops after the last attempt", () => {
    expect(retryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
    expect(retryDelayMs(2)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(retryDelayMs(3)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS + 10)).toBe(6 * 60 * 60_000);
  });
});
