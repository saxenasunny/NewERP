import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import type { AttendanceHealth, AttendanceHealthStatus } from "@/modules/attendance/health-service";

const STATUS_CONFIG: Record<
  AttendanceHealthStatus,
  { tone: BadgeTone; label: string; icon: string }
> = {
  safe: { tone: "success", label: "Safe", icon: "✓" },
  warning: { tone: "warning", label: "At Risk", icon: "⚠" },
  critical: { tone: "danger", label: "Debarred Risk", icon: "✕" },
  unrecorded: { tone: "neutral", label: "Unrecorded", icon: "—" },
};

export function AttendanceHealthBadge({
  health,
  showPercentage = true,
  className = "",
}: {
  health: AttendanceHealth;
  showPercentage?: boolean;
  className?: string;
}) {
  const config = STATUS_CONFIG[health.status];

  return (
    <StatusBadge tone={config.tone} className={className}>
      <span>{config.icon}</span>
      <span>
        {config.label}
        {showPercentage && health.percentage !== null ? ` · ${health.formattedPercentage}` : ""}
      </span>
    </StatusBadge>
  );
}
