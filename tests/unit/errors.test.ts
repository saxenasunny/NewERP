import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  PermissionDeniedError,
  ResourceNotFoundError,
  UnauthenticatedError,
  toApiError,
} from "@/lib/errors";

describe("toApiError", () => {
  it("maps expected application errors to stable codes and statuses", () => {
    expect(toApiError(new UnauthenticatedError(), "req-1")).toEqual({
      status: 401,
      body: { code: "UNAUTHENTICATED", message: "Authentication required.", requestId: "req-1" },
    });

    expect(toApiError(new PermissionDeniedError(), "req-2").status).toBe(403);
    expect(toApiError(new ResourceNotFoundError(), "req-3").body.code).toBe("NOT_FOUND");
  });

  it("maps validation errors to field-level details", () => {
    const schema = z.object({ name: z.string().min(2), code: z.string().min(2) });
    const result = schema.safeParse({ name: "", code: "A" });
    expect(result.success).toBe(false);

    const mapped = toApiError(result.error, "req-4");
    expect(mapped.status).toBe(422);
    expect(mapped.body.code).toBe("VALIDATION_ERROR");
    expect(mapped.body.fieldErrors?.name).toBeDefined();
    expect(mapped.body.fieldErrors?.code).toBeDefined();
    expect(mapped.body.requestId).toBe("req-4");
  });

  it("does not leak unexpected error details", () => {
    const mapped = toApiError(new Error("password=secret connection string"), "req-5");
    expect(mapped.status).toBe(500);
    expect(mapped.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(mapped.body)).not.toContain("secret");
  });
});
