import { describe, expect, it } from "vitest";
import { computeAttendanceHealth } from "@/modules/attendance/health-service";

describe("Attendance Health & 75% Rule Engine", () => {
  it("handles empty or zero recorded sessions gracefully", () => {
    const health = computeAttendanceHealth({ attended: 0, recorded: 0 });
    expect(health.status).toBe("unrecorded");
    expect(health.percentage).toBeNull();
    expect(health.formattedPercentage).toBe("N/A");
    expect(health.isDebarred).toBe(false);
    expect(health.classesCanMiss).toBe(0);
    expect(health.classesNeededToSafe).toBe(0);
  });

  describe("Safe threshold (>= 75.0%)", () => {
    it("marks exactly 75.0% as safe with 0 classes can miss", () => {
      // 15 out of 20 = 75.0%
      // 4*15 - 3*20 = 60 - 60 = 0
      const health = computeAttendanceHealth({ attended: 15, recorded: 20 });
      expect(health.status).toBe("safe");
      expect(health.percentage).toBe(75.0);
      expect(health.formattedPercentage).toBe("75.0%");
      expect(health.isDebarred).toBe(false);
      expect(health.classesCanMiss).toBe(0);
      expect(health.classesNeededToSafe).toBe(0);
    });

    it("correctly computes classes can miss for 90% attendance", () => {
      // 9 out of 10 = 90.0%
      // (4*9 - 3*10) / 3 = (36 - 30)/3 = 2 classes
      // If student misses 2 classes: 9 / (10 + 2) = 9/12 = 75.0% (Safe)
      const health = computeAttendanceHealth({ attended: 9, recorded: 10 });
      expect(health.status).toBe("safe");
      expect(health.percentage).toBe(90.0);
      expect(health.classesCanMiss).toBe(2);
      expect(health.message).toContain("miss up to 2 classes");
    });

    it("handles 100% attendance correctly", () => {
      // 10 out of 10 = 100%
      // (4*10 - 3*10) / 3 = 10 / 3 = 3 classes can miss
      // If student misses 3 classes: 10 / 13 = 76.9% >= 75%
      const health = computeAttendanceHealth({ attended: 10, recorded: 10 });
      expect(health.status).toBe("safe");
      expect(health.percentage).toBe(100.0);
      expect(health.classesCanMiss).toBe(3);
    });
  });

  describe("Warning threshold (70.0% to 74.9%)", () => {
    it("flags 74.0% as warning and calculates consecutive classes needed", () => {
      // 74 attended out of 100 = 74.0%
      // 3*100 - 4*74 = 300 - 296 = 4 classes needed
      // Check: (74 + 4) / (100 + 4) = 78 / 104 = 75.0%
      const health = computeAttendanceHealth({ attended: 74, recorded: 100 });
      expect(health.status).toBe("warning");
      expect(health.percentage).toBe(74.0);
      expect(health.isDebarred).toBe(false);
      expect(health.classesCanMiss).toBe(0);
      expect(health.classesNeededToSafe).toBe(4);
      expect(health.message).toContain("Attend next 4 classes");
    });

    it("flags exactly 70.0% as warning", () => {
      // 7 out of 10 = 70.0%
      // 3*10 - 4*7 = 30 - 28 = 2 classes needed
      // (7 + 2) / (10 + 2) = 9 / 12 = 75.0%
      const health = computeAttendanceHealth({ attended: 7, recorded: 10 });
      expect(health.status).toBe("warning");
      expect(health.percentage).toBe(70.0);
      expect(health.isDebarred).toBe(false);
      expect(health.classesNeededToSafe).toBe(2);
    });
  });

  describe("Critical / Debarment threshold (< 70.0%)", () => {
    it("flags 60.0% as critical with isDebarred = true", () => {
      // 6 out of 10 = 60.0%
      // 3*10 - 4*6 = 30 - 24 = 6 classes needed
      // Check: (6 + 6) / (10 + 6) = 12 / 16 = 75.0%
      const health = computeAttendanceHealth({ attended: 6, recorded: 10 });
      expect(health.status).toBe("critical");
      expect(health.percentage).toBe(60.0);
      expect(health.isDebarred).toBe(true);
      expect(health.classesNeededToSafe).toBe(6);
      expect(health.message).toContain("Critical! Attendance is below 70%");
    });

    it("handles extreme low attendance", () => {
      // 2 out of 10 = 20.0%
      // 3*10 - 4*2 = 30 - 8 = 22 classes needed
      // (2 + 22) / (10 + 22) = 24 / 32 = 75.0%
      const health = computeAttendanceHealth({ attended: 2, recorded: 10 });
      expect(health.status).toBe("critical");
      expect(health.percentage).toBe(20.0);
      expect(health.isDebarred).toBe(true);
      expect(health.classesNeededToSafe).toBe(22);
    });
  });
});
