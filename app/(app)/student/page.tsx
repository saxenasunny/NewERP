import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";
import { listLearnerCourses } from "@/modules/content/delivery-service";

export const metadata: Metadata = { title: "Student Portal · My Learning" };

function formatSessionTime(startsAt: Date, endsAt: Date): string {
  const dateStr = startsAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startStr = startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endStr = endsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateStr} · ${startStr} – ${endStr}`;
}

export default async function StudentDashboardPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const canReadCourses = account.permissions.has("courses.read");
  const courses = canReadCourses ? await listLearnerCourses(account) : [];

  const db = getDb();
  const upcomingSessions = canReadCourses
    ? await db.liveSession.findMany({
        where: {
          tenantId: account.tenant.tenantId,
          status: "SCHEDULED",
          endsAt: { gte: new Date() },
          offering: {
            enrolments: {
              some: {
                userId: account.user.id,
                status: "ACTIVE",
              },
            },
          },
        },
        orderBy: { startsAt: "asc" },
        take: 3,
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          joinUrl: true,
          offeringId: true,
          offering: { select: { course: { select: { code: true, title: true } } } },
        },
      })
    : [];

  const totalLessons = courses.reduce((acc, c) => acc + c.itemCount, 0);
  const totalCompleted = courses.reduce((acc, c) => acc + c.completedCount, 0);
  const overallPercent = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* Motivational Student Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-600 to-violet-800 p-6 sm:p-10 text-white shadow-xl shadow-brand-500/15">
        <div className="absolute -right-12 -top-12 size-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute right-1/4 -bottom-16 size-48 rounded-full bg-indigo-400/20 blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur-xs ring-1 ring-white/20">
              🎓 Student Learning Space
            </span>
            <h1 className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tight">
              Welcome back, {account.user.name}! 👋
            </h1>
            <p className="mt-2 text-brand-100 text-sm sm:text-base leading-relaxed">
              Track your coursework, join live classes, and achieve your learning goals for this semester.
            </p>
          </div>

          {courses.length > 0 && courses[0] ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Link href={`/student/courses/${courses[0].offeringId}`}>
                <Button
                  variant="primary"
                  size="md"
                  className="bg-white text-brand-800 hover:bg-brand-50 shadow-lg shadow-black/10 font-bold border-none"
                >
                  Resume {courses[0].courseCode} →
                </Button>
              </Link>
              <Link href="/student/courses">
                <Button
                  variant="secondary"
                  size="md"
                  className="bg-white/10 text-white border-white/25 hover:bg-white/20 hover:text-white"
                >
                  View All Courses
                </Button>
              </Link>
            </div>
          ) : null}
        </div>

        {/* Quick Stats Grid inside Hero */}
        <div className="relative z-10 mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 border-t border-white/15 pt-6">
          <div className="rounded-2xl bg-white/10 p-3.5 sm:p-4 backdrop-blur-xs ring-1 ring-white/10">
            <p className="text-brand-200 text-xs font-medium uppercase tracking-wider">Active Courses</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold">{courses.length}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3.5 sm:p-4 backdrop-blur-xs ring-1 ring-white/10">
            <p className="text-brand-200 text-xs font-medium uppercase tracking-wider">Completed Lessons</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold">{totalCompleted}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3.5 sm:p-4 backdrop-blur-xs ring-1 ring-white/10">
            <p className="text-brand-200 text-xs font-medium uppercase tracking-wider">Overall Progress</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold">{overallPercent}%</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3.5 sm:p-4 backdrop-blur-xs ring-1 ring-white/10">
            <p className="text-brand-200 text-xs font-medium uppercase tracking-wider">Live Classes</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold">{upcomingSessions.length}</p>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column: My Active Courses (2 cols) */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-ink text-xl font-bold tracking-tight">Continue Learning</h2>
              <p className="text-ink-muted text-sm">Pick up right where you left off</p>
            </div>
            <Link
              href="/student/courses"
              className="text-brand-600 hover:text-brand-700 text-sm font-semibold hover:underline"
            >
              All Courses ({courses.length}) →
            </Link>
          </div>

          {courses.length === 0 ? (
            <EmptyState
              title="No course enrolments yet"
              description="You will see your enrolled courses here once added by an administrator or faculty."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {courses.map((course, idx) => {
                const percent =
                  course.itemCount > 0
                    ? Math.round((course.completedCount / course.itemCount) * 100)
                    : 0;

                // Color accent variants based on index
                const accents = [
                  { stripe: "from-brand-500 to-indigo-600", badge: "info" as const },
                  { stripe: "from-emerald-500 to-teal-600", badge: "success" as const },
                  { stripe: "from-violet-500 to-purple-600", badge: "brand" as const },
                  { stripe: "from-amber-500 to-orange-600", badge: "warning" as const },
                ];
                const accent = accents[idx % accents.length] ?? accents[0]!;

                return (
                  <div
                    key={course.offeringId}
                    className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-md"
                  >
                    {/* Color Accent Bar */}
                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${accent.stripe}`} />

                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-bold text-ink">
                          {course.courseCode}
                        </span>
                        <StatusBadge tone={percent === 100 ? "success" : percent > 0 ? "brand" : "neutral"}>
                          {percent}% Complete
                        </StatusBadge>
                      </div>

                      <h3 className="text-ink group-hover:text-brand-700 mt-3 text-base font-bold transition-colors line-clamp-1">
                        <Link href={`/student/courses/${course.offeringId}`}>
                          {course.courseTitle}
                        </Link>
                      </h3>

                      <p className="text-ink-muted mt-1 text-xs line-clamp-1">
                        {course.academicYearName} · {course.termName}
                        {course.instructorNames.length > 0 ? ` · ${course.instructorNames.join(", ")}` : ""}
                      </p>
                    </div>

                    <div className="mt-5 flex flex-col gap-3">
                      {/* Smooth Progress Meter */}
                      <div>
                        <div className="flex justify-between text-xs font-medium text-ink-muted mb-1.5">
                          <span>Progress</span>
                          <span>
                            {course.completedCount} / {course.itemCount} lessons
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${accent.stripe} transition-all duration-500`}
                            style={{ width: `${Math.max(percent, 4)}%` }}
                          />
                        </div>
                      </div>

                      <Link href={`/student/courses/${course.offeringId}`} className="w-full">
                        <Button variant="secondary" size="sm" className="w-full justify-between font-semibold group-hover:border-brand-300">
                          <span>Enter Classroom</span>
                          <span>→</span>
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Upcoming Live Sessions & Shortcuts (1 col) */}
        <div className="flex flex-col gap-6">
          {/* Upcoming Live Sessions Card */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-ink text-base font-bold flex items-center gap-2">
                <span>🔴</span> Upcoming Live Sessions
              </h2>
              <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                {upcomingSessions.length} Scheduled
              </span>
            </div>

            {upcomingSessions.length === 0 ? (
              <p className="text-ink-muted text-xs py-4 text-center">
                No upcoming live classes right now. Check back later or review past recordings.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcomingSessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-col gap-2 rounded-xl bg-surface-muted/60 p-3.5 border border-border/80 transition-colors hover:border-brand-300"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-brand-700 text-xs font-bold">
                        {session.offering.course.code}
                      </span>
                      <span className="text-ink-muted text-[11px] font-medium">
                        {formatSessionTime(session.startsAt, session.endsAt)}
                      </span>
                    </div>

                    <p className="text-ink text-sm font-semibold">{session.title}</p>

                    {session.joinUrl ? (
                      <a
                        href={session.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                      >
                        <span>Join Meeting</span>
                        <span>↗</span>
                      </a>
                    ) : (
                      <span className="text-ink-muted text-xs italic">Meeting link will be shared by instructor</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quick Learning Shortcuts */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-3">
            <h2 className="text-ink text-base font-bold">Learning Hub</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/student/courses"
                className="flex flex-col gap-1 rounded-xl bg-surface-muted/60 p-3 border border-border/60 hover:bg-brand-50 hover:border-brand-200 transition-all group"
              >
                <span className="text-xl">📚</span>
                <span className="text-ink font-semibold text-xs group-hover:text-brand-700">My Courses</span>
                <span className="text-ink-muted text-[11px]">All enrolled classes</span>
              </Link>
              <Link
                href="/student/assignments"
                className="flex flex-col gap-1 rounded-xl bg-surface-muted/60 p-3 border border-border/60 hover:bg-brand-50 hover:border-brand-200 transition-all group"
              >
                <span className="text-xl">📝</span>
                <span className="text-ink font-semibold text-xs group-hover:text-brand-700">Assignments</span>
                <span className="text-ink-muted text-[11px]">Tasks & deadlines</span>
              </Link>
              <Link
                href="/calendar"
                className="flex flex-col gap-1 rounded-xl bg-surface-muted/60 p-3 border border-border/60 hover:bg-brand-50 hover:border-brand-200 transition-all group"
              >
                <span className="text-xl">📅</span>
                <span className="text-ink font-semibold text-xs group-hover:text-brand-700">Calendar</span>
                <span className="text-ink-muted text-[11px]">Schedules & events</span>
              </Link>
              <Link
                href="/student/certificates"
                className="flex flex-col gap-1 rounded-xl bg-surface-muted/60 p-3 border border-border/60 hover:bg-brand-50 hover:border-brand-200 transition-all group"
              >
                <span className="text-xl">🏆</span>
                <span className="text-ink font-semibold text-xs group-hover:text-brand-700">Certificates</span>
                <span className="text-ink-muted text-[11px]">Your credentials</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
