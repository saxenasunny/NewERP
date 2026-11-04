import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  dayKey,
  getCalendar,
  groupEventsByDay,
  parseCalendarWindow,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarEventState,
  type CalendarView,
} from "@/modules/calendar/calendar-service";

export const metadata: Metadata = { title: "Calendar" };

const DAY_MS = 86_400_000;

const KIND_LABELS: Record<CalendarEventKind, string> = {
  session: "Live session",
  assignment: "Assignment due",
  quiz: "Quiz closes",
};

const STATE_TONES: Record<CalendarEventState, BadgeTone> = {
  scheduled: "info",
  cancelled: "danger",
  open: "success",
  closed: "neutral",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function parseMonth(value: string | undefined, now: Date): Date {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    const parsed = new Date(year!, month! - 1, 1);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function shiftMonth(month: Date, delta: number): string {
  return monthKey(new Date(month.getFullYear(), month.getMonth() + delta, 1));
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatRange(event: CalendarEvent): string {
  if (!event.endsAt) return `${formatTime(event.startsAt)}`;
  return `${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`;
}

/** The Monday-first grid that contains the whole month. */
function monthGrid(month: Date): { start: Date; cells: Date[] } {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * DAY_MS);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;

  return {
    start,
    cells: Array.from({ length: total }, (_, index) => new Date(start.getTime() + index * DAY_MS)),
  };
}

function EventLink({ event }: { event: CalendarEvent }) {
  return (
    <Link
      href={event.href}
      className="hover:bg-muted block rounded px-1 py-0.5 text-xs leading-snug"
      title={`${event.courseCode} · ${KIND_LABELS[event.kind]} · ${formatRange(event)}`}
    >
      <span className="text-muted-foreground">{formatTime(event.startsAt)}</span>{" "}
      <span className={event.state === "cancelled" ? "line-through" : undefined}>
        {event.courseCode}: {event.title}
      </span>
    </Link>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; from?: string; to?: string }>;
}) {
  const account = await requireAccountContext();
  const { month: monthParam, view: viewParam, from, to } = await searchParams;
  const view = viewParam === "list" ? "list" : "month";
  const now = new Date();
  const month = parseMonth(monthParam, now);
  const grid = monthGrid(month);

  // The grid shows leading and trailing days, so the window covers all of it.
  const gridEnd = new Date(grid.start.getTime() + (grid.cells.length - 1) * DAY_MS);
  const listFrom = new Date(month.getFullYear(), month.getMonth(), 1);
  const listTo = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  let calendar: CalendarView;
  try {
    const window =
      from && to
        ? parseCalendarWindow({ from, to })
        : view === "list"
          ? parseCalendarWindow({ from: listFrom.toISOString(), to: listTo.toISOString() })
          : parseCalendarWindow({ from: grid.start.toISOString(), to: gridEnd.toISOString() });
    calendar = await getCalendar(account, window);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Calendar" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The calendar could not be loaded. Try again."}
        </Alert>
      </div>
    );
  }

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const event of calendar.events) {
    const key = dayKey(event.startsAt);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }

  const agenda = groupEventsByDay(calendar.events);
  const todayKey = dayKey(now);
  const isStaff = calendar.scope === "staff";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        description={
          isStaff
            ? "Live sessions, assignment deadlines, and quiz closings for the courses you teach."
            : "Live sessions, assignment deadlines, and quiz closings for your enrolled courses."
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/calendar?month=${shiftMonth(month, -1)}&view=${view}`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Previous
          </Link>
          <span className="min-w-44 text-center text-sm font-semibold">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </span>
          <Link
            href={`/calendar?month=${shiftMonth(month, 1)}&view=${view}`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Next
          </Link>
          <Link
            href={`/calendar?month=${monthKey(now)}&view=${view}`}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            This month
          </Link>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">View</span>
          <Link
            href={`/calendar?month=${monthKey(month)}&view=month`}
            className={
              view === "month" ? "font-semibold underline" : "text-muted-foreground hover:underline"
            }
          >
            Month
          </Link>
          <Link
            href={`/calendar?month=${monthKey(month)}&view=list`}
            className={
              view === "list" ? "font-semibold underline" : "text-muted-foreground hover:underline"
            }
          >
            List
          </Link>
        </div>
      </div>

      {view === "month" ? (
        <section className="rounded-lg border">
          <div className="text-muted-foreground grid grid-cols-7 border-b text-center text-xs font-medium">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="px-2 py-2">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.cells.map((day) => {
              const key = dayKey(day);
              const inMonth = day.getMonth() === month.getMonth();
              const dayEvents = eventsByDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`min-h-24 border-r border-b p-1 last:border-r-0 ${
                    inMonth ? "" : "bg-muted/40"
                  }`}
                >
                  <div
                    className={`mb-1 flex items-center justify-between text-xs ${
                      key === todayKey ? "text-brand-800 font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    <span>{day.getDate()}</span>
                    {dayEvents.length > 0 ? <span>{dayEvents.length}</span> : null}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((event) => (
                      <EventLink key={`${event.kind}-${event.id}`} event={event} />
                    ))}
                    {dayEvents.length > 3 ? (
                      <span className="text-muted-foreground px-1 text-xs">
                        +{dayEvents.length - 3} more
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {view === "list" ? "Agenda" : "What is coming up"}
        </h2>
        {agenda.length === 0 ? (
          <EmptyState
            title="Nothing scheduled in this range"
            description={
              isStaff
                ? "Schedule a live session or set an assignment deadline and it appears here."
                : "Your courses have no sessions, deadlines, or quizzes in this range yet."
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {agenda.map((day) => (
              <li key={day.key} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{formatDay(day.date)}</h3>
                <ul className="flex flex-col gap-2">
                  {day.events.map((event) => (
                    <li
                      key={`${event.kind}-${event.id}`}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          <Link href={event.href} className="hover:underline">
                            {event.courseCode}: {event.title}
                          </Link>
                          <StatusBadge tone={STATE_TONES[event.state]}>{event.state}</StatusBadge>
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {KIND_LABELS[event.kind]} · {formatRange(event)} · {event.courseTitle}
                        </span>
                      </div>
                      <Link
                        href={event.href}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-semibold">Jump to a range</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Ranges are limited to a month at a time; use the arrows above to move through the term.
        </p>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="view" value="list" />
          <Input
            id="calendar-from"
            label="From"
            name="from"
            type="date"
            defaultValue={dayKey(grid.start)}
          />
          <Input id="calendar-to" label="To" name="to" type="date" defaultValue={dayKey(gridEnd)} />
          <Button type="submit" variant="secondary">
            Show range
          </Button>
        </form>
      </section>
    </div>
  );
}
