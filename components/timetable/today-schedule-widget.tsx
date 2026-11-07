import Link from "next/link";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import type { TodaySchedule, TimetableSlotView } from "@/modules/timetable/timetable-service";

const STATUS_CONFIG: Record<
  "UPCOMING" | "IN_PROGRESS" | "COMPLETED",
  { tone: BadgeTone; label: string; icon: string }
> = {
  IN_PROGRESS: { tone: "success", label: "Ongoing Now", icon: "🟢" },
  UPCOMING: { tone: "brand", label: "Upcoming", icon: "⏳" },
  COMPLETED: { tone: "neutral", label: "Completed", icon: "✓" },
};

const SLOT_TYPE_LABELS = {
  LECTURE: "Lecture",
  TUTORIAL: "Tutorial",
  PRACTICAL: "Lab / Practical",
};

export function TodayScheduleWidget({
  schedule,
  viewAllHref = "/student/timetable",
  title = "Today's Schedule",
}: {
  schedule: TodaySchedule;
  viewAllHref?: string;
  title?: string;
}) {
  const hasClasses = schedule.slots.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <div>
            <h2 className="text-ink text-base font-bold tracking-tight">{title}</h2>
            <p className="text-ink-muted text-xs">{schedule.dayLabel}</p>
          </div>
        </div>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">
          {schedule.slots.length} {schedule.slots.length === 1 ? "Period" : "Periods"}
        </span>
      </div>

      {/* Slots List */}
      {!hasClasses ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-ink-muted">
          <p className="text-base mb-1">🎉</p>
          <p className="font-semibold text-ink">No classes scheduled for today!</p>
          <p className="mt-0.5 text-ink-muted">Enjoy your day or review upcoming coursework.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {schedule.slots.map((slot) => {
            const statusConfig = STATUS_CONFIG[slot.status ?? "UPCOMING"];
            const isOngoing = slot.status === "IN_PROGRESS";

            return (
              <li
                key={slot.id}
                className={`relative overflow-hidden rounded-xl border p-3 transition-all ${
                  isOngoing
                    ? "border-emerald-300 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-300"
                    : "border-border/80 bg-surface-muted/40 hover:border-brand-300"
                }`}
              >
                {isOngoing ? (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
                ) : null}

                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                      P{slot.periodNumber} · {slot.startTime}–{slot.endTime}
                    </span>
                    <span className="text-[11px] font-semibold text-ink-muted bg-surface px-1.5 py-0.5 rounded border border-border">
                      {SLOT_TYPE_LABELS[slot.slotType]}
                    </span>
                  </div>

                  <StatusBadge tone={statusConfig.tone} className="text-[10px] py-0 px-2">
                    <span>{statusConfig.icon}</span>
                    <span>{statusConfig.label}</span>
                  </StatusBadge>
                </div>

                <div className="mt-2">
                  <h3 className="text-sm font-bold text-ink">
                    <Link
                      href={`/student/courses/${slot.offeringId}`}
                      className="hover:text-brand-700 transition-colors"
                    >
                      {slot.courseCode}: {slot.courseTitle}
                    </Link>
                  </h3>

                  <div className="mt-1 flex items-center justify-between text-xs text-ink-muted flex-wrap gap-1">
                    <span>👤 {slot.instructorName}</span>
                    {slot.room ? (
                      <span className="font-medium text-ink bg-surface px-2 py-0.5 rounded-md border border-border/80">
                        📍 {slot.room.code} ({slot.room.building})
                        {slot.room.isLab ? " · Lab" : ""}
                      </span>
                    ) : (
                      <span className="italic text-[11px]">Online / TBA</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* View full schedule link */}
      <div className="border-t border-border pt-2 flex justify-end">
        <Link
          href={viewAllHref}
          className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline"
        >
          View Full Weekly Timetable →
        </Link>
      </div>
    </div>
  );
}
