import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  DAY_LABELS,
  DAY_ORDER,
  DayOfWeek,
  listRooms,
  listTenantTimetableSlots,
  STANDARD_PERIODS,
  type TimetableSlotView,
} from "@/modules/timetable/timetable-service";

export const metadata: Metadata = { title: "Institution Master Timetable · Admin" };

const SLOT_TYPE_COLORS = {
  LECTURE: "bg-blue-50 text-blue-700 border-blue-200",
  TUTORIAL: "bg-purple-50 text-purple-700 border-purple-200",
  PRACTICAL: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default async function AdminTimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (!account.permissions.has("academic_structure.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Institution Master Timetable" />
        <PermissionDenied message="Your role cannot view or manage the master institution timetable. Ask an institution administrator for access." />
      </div>
    );
  }

  const { day: selectedDayParam } = await searchParams;
  const [allSlots, rooms] = await Promise.all([
    listTenantTimetableSlots(account),
    listRooms(account),
  ]);

  const activeDay: DayOfWeek =
    selectedDayParam && Object.values(DayOfWeek).includes(selectedDayParam as DayOfWeek)
      ? (selectedDayParam as DayOfWeek)
      : DayOfWeek.MONDAY;

  const daySlots = allSlots.filter((s) => s.dayOfWeek === activeDay);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Academic setup", href: "/admin/offerings" },
          { label: "Master timetable", href: "/admin/timetable" },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Institution Master Timetable"
          description="View and verify scheduled weekly classes and room allocations across all academic offerings."
        />
        <div className="flex items-center gap-3">
          <Link href="/admin/rooms">
            <Button variant="secondary">Manage Rooms ({rooms.length})</Button>
          </Link>
          <Link href="/admin/offerings">
            <Button>Manage Offerings</Button>
          </Link>
        </div>
      </div>

      {/* Day Selector Pills */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {DAY_ORDER.map((day) => {
          const isSelected = day === activeDay;
          const count = allSlots.filter((s) => s.dayOfWeek === day).length;
          return (
            <Link
              key={day}
              href={`/admin/timetable?day=${day}`}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                isSelected
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-surface-muted text-ink-muted hover:bg-surface-muted/80 hover:text-ink"
              }`}
            >
              <span>{DAY_LABELS[day]}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isSelected ? "bg-white/20 text-white" : "bg-border text-ink-muted"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Slots Matrix for Active Day */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">
            {DAY_LABELS[activeDay]} Schedule ({daySlots.length}{" "}
            {daySlots.length === 1 ? "Slot" : "Slots"})
          </h2>
          <span className="text-xs text-ink-muted">
            Total campus slots across week: {allSlots.length}
          </span>
        </div>

        {daySlots.length === 0 ? (
          <EmptyState
            title={`No classes scheduled on ${DAY_LABELS[activeDay]}`}
            description="Go to Course Offerings > Timetable to assign periods and rooms to course sections."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {daySlots.map((slot) => (
              <div
                key={slot.id}
                className="flex flex-col justify-between rounded-2xl border border-border bg-surface p-4 shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                      P{slot.periodNumber} · {slot.startTime}–{slot.endTime}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        SLOT_TYPE_COLORS[slot.slotType]
                      }`}
                    >
                      {slot.slotType}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-ink">
                    <Link
                      href={`/faculty/courses/${slot.offeringId}/timetable`}
                      className="hover:text-brand-700 transition-colors"
                    >
                      {slot.courseCode}: {slot.courseTitle}
                    </Link>
                  </h3>

                  <p className="mt-1 text-xs text-ink-muted">Instructor: {slot.instructorName}</p>
                </div>

                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                  {slot.room ? (
                    <span className="font-medium text-ink bg-surface-muted px-2 py-0.5 rounded">
                      📍 {slot.room.code} ({slot.room.building})
                    </span>
                  ) : (
                    <span className="italic text-ink-muted">No room assigned</span>
                  )}
                  <Link
                    href={`/faculty/courses/${slot.offeringId}/timetable`}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                  >
                    View offering →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
