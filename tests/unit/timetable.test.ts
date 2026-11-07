import { describe, expect, it } from "vitest";
import {
  DAY_LABELS,
  DAY_ORDER,
  DayOfWeek,
  SlotType,
  STANDARD_PERIODS,
  getCurrentDayOfWeek,
  timeSlotsOverlap,
  timeToMinutes,
} from "@/modules/timetable/timetable-service";

describe("Timetable Conflict & Time Utilities", () => {
  describe("timeToMinutes", () => {
    it("converts valid 24h time strings to total minutes", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("09:00")).toBe(540);
      expect(timeToMinutes("09:55")).toBe(595);
      expect(timeToMinutes("13:45")).toBe(825);
      expect(timeToMinutes("23:59")).toBe(1439);
    });

    it("rejects invalid formats or out-of-range times", () => {
      expect(() => timeToMinutes("invalid")).toThrow();
      expect(() => timeToMinutes("25:00")).toThrow();
      expect(() => timeToMinutes("09:60")).toThrow();
      expect(() => timeToMinutes("-1:00")).toThrow();
    });
  });

  describe("timeSlotsOverlap", () => {
    it("detects identical intervals as overlapping", () => {
      expect(timeSlotsOverlap("09:00", "09:55", "09:00", "09:55")).toBe(true);
    });

    it("detects partially overlapping intervals", () => {
      // Slot A starts earlier, ends during Slot B
      expect(timeSlotsOverlap("09:00", "10:15", "10:00", "11:00")).toBe(true);
      // Slot B starts earlier, ends during Slot A
      expect(timeSlotsOverlap("10:00", "11:00", "09:30", "10:30")).toBe(true);
    });

    it("detects completely enclosed intervals", () => {
      expect(timeSlotsOverlap("09:00", "13:00", "10:00", "11:00")).toBe(true);
      expect(timeSlotsOverlap("10:00", "11:00", "09:00", "13:00")).toBe(true);
    });

    it("treats strictly adjacent boundary times as non-overlapping", () => {
      // Period 1 ends at 09:55, Period 2 starts at 09:55
      expect(timeSlotsOverlap("09:00", "09:55", "09:55", "10:50")).toBe(false);
      expect(timeSlotsOverlap("09:55", "10:50", "09:00", "09:55")).toBe(false);
    });

    it("treats distant intervals as non-overlapping", () => {
      expect(timeSlotsOverlap("09:00", "09:55", "11:00", "11:55")).toBe(false);
    });
  });

  describe("Day & Period Config", () => {
    it("preserves standard university period structure", () => {
      expect(STANDARD_PERIODS.length).toBe(8);
      expect(STANDARD_PERIODS[0]!.periodNumber).toBe(1);
      expect(STANDARD_PERIODS[0]!.defaultStartTime).toBe("09:00");
      expect(STANDARD_PERIODS[0]!.defaultEndTime).toBe("09:55");
    });

    it("maintains Monday through Saturday day order", () => {
      expect(DAY_ORDER).toEqual([
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
      ]);
      expect(DAY_LABELS[DayOfWeek.MONDAY]).toBe("Monday");
      expect(DAY_LABELS[DayOfWeek.FRIDAY]).toBe("Friday");
    });

    it("correctly identifies day of week from standard date objects", () => {
      // 2026-11-02 was a Monday
      const monday = new Date("2026-11-02T10:00:00Z");
      expect(getCurrentDayOfWeek(monday)).toBe(DayOfWeek.MONDAY);

      // 2026-11-07 is Saturday
      const saturday = new Date("2026-11-07T10:00:00Z");
      expect(getCurrentDayOfWeek(saturday)).toBe(DayOfWeek.SATURDAY);

      // 2026-11-08 is Sunday
      const sunday = new Date("2026-11-08T10:00:00Z");
      expect(getCurrentDayOfWeek(sunday)).toBe(DayOfWeek.SUNDAY);
    });
  });
});
