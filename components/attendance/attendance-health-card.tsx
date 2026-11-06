import Link from "next/link";
import type { AttendanceHealth } from "@/modules/attendance/health-service";
import { AttendanceHealthBadge } from "./attendance-health-badge";

export function AttendanceHealthCard({
  health,
  title = "Attendance Health Meter",
  subtitle = "UGC 75% Mandatory Examination Policy",
  viewDetailsHref,
}: {
  health: AttendanceHealth;
  title?: string;
  subtitle?: string;
  viewDetailsHref?: string;
}) {
  const percentage = health.percentage ?? 0;
  const isUnrecorded = health.status === "unrecorded";

  // Circular gauge calculations (r = 42, circumference = 2 * PI * 42 ~= 263.89)
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = isUnrecorded
    ? circumference
    : circumference - (Math.min(Math.max(percentage, 0), 100) / 100) * circumference;

  const colorStyles = {
    safe: {
      ring: "stroke-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      bg: "bg-emerald-50/70 dark:bg-emerald-950/20",
      border: "border-emerald-200 dark:border-emerald-900/50",
      alertBg: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
    warning: {
      ring: "stroke-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-50/70 dark:bg-amber-950/20",
      border: "border-amber-200 dark:border-amber-900/50",
      alertBg: "bg-amber-50 text-amber-800 border-amber-200",
    },
    critical: {
      ring: "stroke-rose-500",
      text: "text-rose-700 dark:text-rose-400",
      bg: "bg-rose-50/70 dark:bg-rose-950/20",
      border: "border-rose-200 dark:border-rose-900/50",
      alertBg: "bg-rose-50 text-rose-800 border-rose-200",
    },
    unrecorded: {
      ring: "stroke-slate-300 dark:stroke-slate-700",
      text: "text-ink-muted",
      bg: "bg-surface",
      border: "border-border",
      alertBg: "bg-surface-muted text-ink-muted border-border",
    },
  }[health.status];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${colorStyles.border} ${colorStyles.bg} p-5 shadow-sm transition-all duration-200`}
    >
      <div className="flex flex-col gap-4">
        {/* Header with Title and Badge */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold tracking-tight">{title}</h2>
            <p className="text-ink-muted text-xs">{subtitle}</p>
          </div>
          <AttendanceHealthBadge health={health} />
        </div>

        {/* Circular Gauge & Core Metrics */}
        <div className="flex items-center gap-6">
          {/* Radial Progress Ring */}
          <div className="relative flex items-center justify-center shrink-0">
            <svg className="size-24 -rotate-90 transform" viewBox="0 0 100 100">
              {/* Background track */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="stroke-surface-muted"
                strokeWidth="9"
                fill="transparent"
              />
              {/* 75% benchmark indicator notch (at 75% = 270 deg) */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="stroke-border-strong/40"
                strokeWidth="11"
                strokeDasharray={`2 ${circumference - 2}`}
                strokeDashoffset={circumference - 0.75 * circumference}
                fill="transparent"
              />
              {/* Active progress arc */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className={`${colorStyles.ring} transition-all duration-700 ease-out`}
                strokeWidth="9"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>

            {/* Centered Label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className={`text-xl font-extrabold tracking-tight ${colorStyles.text}`}>
                {health.formattedPercentage}
              </span>
              <span className="text-[10px] font-semibold uppercase text-ink-muted tracking-wider">
                Overall
              </span>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid flex-1 grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-border/70 bg-surface/80 p-2.5 backdrop-blur-xs">
              <p className="text-ink-muted text-[11px] font-medium">Attended</p>
              <p className="text-ink text-base font-extrabold mt-0.5">
                {health.attended}{" "}
                <span className="text-xs font-normal text-ink-muted">
                  / {health.recorded} recorded
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface/80 p-2.5 backdrop-blur-xs">
              <p className="text-ink-muted text-[11px] font-medium">Missed (Absent)</p>
              <p className="text-ink text-base font-extrabold mt-0.5">
                {health.absent}{" "}
                <span className="text-xs font-normal text-ink-muted">
                  {health.excused > 0 ? `(${health.excused} excused)` : ""}
                </span>
              </p>
            </div>

            <div className="col-span-2 rounded-xl border border-border/70 bg-surface/80 p-2.5 backdrop-blur-xs">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted">Threshold Benchmark</span>
                <span className="font-bold text-ink">75.0% Required</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={`h-full rounded-full ${
                    percentage >= 75 ? "bg-emerald-500" : percentage >= 70 ? "bg-amber-500" : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(Math.max(percentage, 5), 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Recovery & Eligibility Advisory Alert */}
        <div
          className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs font-medium leading-relaxed ${colorStyles.alertBg}`}
        >
          <span className="text-base select-none shrink-0">
            {health.status === "safe"
              ? "🛡️"
              : health.status === "warning"
              ? "⚠️"
              : health.status === "critical"
              ? "🚨"
              : "ℹ️"}
          </span>
          <div className="flex-1">
            <p className="font-semibold">{health.message}</p>
            {health.status === "critical" ? (
              <p className="mt-1 text-[11px] opacity-90">
                Debarment Notice: Students with attendance below 75% are ineligible to sit for end-term examinations under academic guidelines.
              </p>
            ) : null}
          </div>
        </div>

        {viewDetailsHref ? (
          <div className="flex justify-end pt-1">
            <Link
              href={viewDetailsHref}
              className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline"
            >
              View detailed attendance report →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
