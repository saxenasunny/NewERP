import { describe, expect, it } from "vitest";
import { generateNextEnrollmentNumber } from "@/modules/identity/enrollment-number";

describe("generateNextEnrollmentNumber", () => {
  it("starts at 2026001 when no existing enrollment numbers exist", async () => {
    const mockDb = {
      tenantMembership: {
        findMany: async () => [],
      },
    };
    const enrollment = await generateNextEnrollmentNumber(mockDb as any, "tenant_1", 2026);
    expect(enrollment).toBe("2026001");
  });

  it("increments to 2026002 after 2026001 exists", async () => {
    const mockDb = {
      tenantMembership: {
        findMany: async () => [{ institutionalId: "2026001" }],
      },
    };
    const enrollment = await generateNextEnrollmentNumber(mockDb as any, "tenant_1", 2026);
    expect(enrollment).toBe("2026002");
  });

  it("handles gaps and picks highest serial correctly", async () => {
    const mockDb = {
      tenantMembership: {
        findMany: async () => [
          { institutionalId: "2026001" },
          { institutionalId: "2026005" },
          { institutionalId: "2026002" },
        ],
      },
    };
    const enrollment = await generateNextEnrollmentNumber(mockDb as any, "tenant_1", 2026);
    expect(enrollment).toBe("2026006");
  });

  it("handles numbers above 999 smoothly without losing digits", async () => {
    const mockDb = {
      tenantMembership: {
        findMany: async () => [{ institutionalId: "2026999" }],
      },
    };
    const enrollment = await generateNextEnrollmentNumber(mockDb as any, "tenant_1", 2026);
    expect(enrollment).toBe("20261000");
  });

  it("contains no dashes, hyphens, or special characters", async () => {
    const mockDb = {
      tenantMembership: {
        findMany: async () => [{ institutionalId: "2026042" }],
      },
    };
    const enrollment = await generateNextEnrollmentNumber(mockDb as any, "tenant_1", 2026);
    expect(enrollment).toMatch(/^[0-9]{7,}$/);
    expect(enrollment).toBe("2026043");
  });
});
