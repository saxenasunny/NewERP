import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import {
  DAY_ORDER,
  DAY_LABELS,
  DayOfWeek,
  getFacultyWeeklyTimetable,
  STANDARD_PERIODS,
  type TimetableSlotView,
} from "@/modules/timetable/timetable-service";

export const metadata: Metadata = { title: "My Teaching Schedule · Faculty" };

const SLOT_TYPE_COLORS = {
  LECTURE: "bg-blue-50 text-blue-700 border-blue-200",
  TUTORIAL: "bg-purple-50 text-purple-700 border-purple-200",
  PRACTICAL: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default async function FacultyTimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const { day: selectedDayParam } = await searchParams;
  const timetable = await getFacultyWeeklyTimetable(account);

  const todaySchedule = timetable.days.find((d) => d.isToday);
  const activeDay: DayOfWeek = (
    selectedDayParam && Object.values(DayOfWeek).includes(selectedDayParam as DayOfWeek)
      ? (selectedDayParam as DayOfWeek)
      : todaySchedule
      ? todaySchedule.day
      : DayOfWeek.MONDAY
  );

  const activeDaySchedule = timetable.days.find((d) => d.day === activeDay) ?? timetable.days[0]!;
  const totalSlotsCount = timetable.days.reduce((acc, d) => acc + d.slots.length, 0);

  return (
    <div className="flex flex-col gap-8 pb-12">
      <Breadcrumbs items={[{ label: "Faculty", href: "/faculty/courses" }, { label: "My teaching schedule" }]} />

      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="Teaching Schedule"
        description="Your scheduled lectures, lab practicals, and tutorial periods across all assigned courses for the current academic term."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/faculty/courses">
              <Button variant="secondary" size="sm">
                My Courses
              </Button>
            </Link>
            <Link href="/admin/rooms">
              <Button variant="secondary" size="sm">
                Campus Rooms
              </Button>
            </Link>
          </div>
        }
      />

      {totalSlotsCount === 0 ? (
        <EmptyState
          title="No teaching periods scheduled yet"
          description="You are not currently assigned to any timetable slots. Visit your courses to schedule weekly class periods."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Day Navigation Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {timetable.days.map((dayItem) => {
              const isSelected = dayItem.day === activeDay;
              const slotCount = dayItem.slots.length;

              return (
                <Link
                  key={dayItem.day}
                  href={`/faculty/timetable?day=${dayItem.day}`}
                  className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold transition-all shrink-0 ${
                    isSelected
                      ? "bg-brand-600 text-white shadow-md shadow-brand-500/20"
                      : "bg-surface text-ink-muted border border-border hover:bg-surface-muted hover:text-ink"
                  }`}
                >
                  <span>{dayItem.dayLabel}</span>
                  {dayItem.isToday ? (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] uppercase font-extrabold ${
                        isSelected ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      Today
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[11px] ${
                      isSelected ? "bg-white/20 text-white" : "bg-surface-muted text-ink-muted"
                    }`}
                  >
                    {slotCount}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Active Day Period Cards */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-ink text-lg font-bold">
                {activeDaySchedule.dayLabel} Lectures & Labs
              </h2>
              <span className="text-xs text-ink-muted">
                {activeDaySchedule.slots.length}{" "}
                {activeDaySchedule.slots.length === 1 ? "Period" : "Periods"} scheduled
              </span>
            </div>

            {activeDaySchedule.slots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-muted">
                <p className="text-2xl mb-2">✨</p>
                <p className="font-bold text-ink">No lectures scheduled on {activeDaySchedule.dayLabel}</p>
                <p className="mt-1 text-xs text-ink-muted">No teaching periods allocated for this day.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeDaySchedule.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand-200 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs font-extrabold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-lg">
                          Period {slot.periodNumber} · {slot.startTime}–{slot.endTime}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                            SLOT_TYPE_COLORS[slot.slotType]
                          }`}
                        >
                          {slot.slotType}
                        </span>
                      </div>

                      <h3 className="mt-3 text-base font-bold text-ink hover:text-brand-700 transition-colors">
                        <Link href={`/faculty/courses/${slot.offeringId}`}>
                          {slot.courseCode}: {slot.courseTitle}
                        </Link>
                      </h3>

                      <p className="mt-1 text-xs text-ink-muted">
                        Room:{" "}
                        {slot.room ? (
                          <span className="font-semibold text-ink">
                            {slot.room.code} ({slot.room.building}
                            {slot.room.isLab ? " · Lab" : ""})
                          </span>
                        ) : (
                          <span className="italic">Online / TBA</span>
                        )}
                      </p>
                    </div>

                    <div className="mt-5 pt-3 border-t border-border flex items-center justify-between text-xs">
                      <Link
                        href={`/faculty/courses/${slot.offeringId}/timetable`}
                        className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        Course Timetable →
                      </Link>
                      <Link
                        href={`/faculty/courses/${slot.offeringId}/attendance`}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline"
                      >
                        Attendance →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Master Weekly Grid View */}
          <section className="mt-8 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-ink text-lg font-bold">Faculty Teaching Grid</h2>
                <p className="text-xs text-ink-muted">Overview of your teaching workload across all periods</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
              <table className="w-full min-w-[850px] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-surface-muted border-b border-border">
                    <th className="p-3.5 font-bold text-ink w-28">Day</th>
                    {STANDARD_PERIODS.map((period) => (
                      <th key={period.periodNumber} className="p-3 font-semibold text-ink border-l border-border text-center">
                        <div>Period {period.periodNumber}</div>
                        <div className="text-[10px] font-normal text-ink-muted mt-0.5">
                          {period.defaultStartTime}–{period.defaultEndTime}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {timetable.days.map((dayItem) => {
                    const slotMap = new Map<number, TimetableSlotView>();
                    for (const s of dayItem.slots) {
                      slotMap.set(s.periodNumber, s);
                    }

                    return (
                      <tr
                        key={dayItem.day}
                        className={`transition-colors ${
                          dayItem.isToday ? "bg-emerald-50/30" : "hover:bg-surface-muted/30"
                        }`}
                      >
                        <th className="p-3.5 font-bold text-ink whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{dayItem.dayLabel}</span>
                            {dayItem.isToday ? (
                              <span className="rounded-full bg-emerald-100 text-emerald-800 text-[9px] px-1.5 py-0.2 font-extrabold uppercase">
                                Today
                              </span>
                            ) : null}
                          </div>
                        </th>

                        {STANDARD_PERIODS.map((period) => {
                          const slot = slotMap.get(period.periodNumber);

                          return (
                            <td
                              key={period.periodNumber}
                              className="p-2 border-l border-border align-top h-20"
                            >
                              {slot ? (
                                <div className="h-full rounded-xl border border-border bg-surface p-2 shadow-2xs flex flex-col justify-between hover:border-brand-300 transition-colors">
                                  <div>
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-mono font-bold text-brand-700 text-[11px]">
                                        {slot.courseCode}
                                      </span>
                                      <span className="text-[9px] font-bold uppercase text-ink-muted">
                                        {slot.slotType[0]}
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-medium text-ink line-clamp-1 mt-0.5">
                                      {slot.courseTitle}
                                    </p>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between text-[10px] text-ink-muted">
                                    <span>{slot.room ? slot.room.code : "Online"}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="h-full rounded-xl border border-dashed border-border/50 flex items-center justify-center text-[10px] text-ink-muted/50 select-none">
                                  —
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
