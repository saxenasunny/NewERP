import { ZodError } from "zod";

/** Base class for expected, mapped application errors. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required.") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("PERMISSION_DENIED", message, 403);
  }
}

/**
 * Used for records in another tenant as well as genuinely missing records, so a
 * response cannot confirm that a foreign record exists.
 */
export class ResourceNotFoundError extends AppError {
  constructor(message = "The requested record was not found.") {
    super("NOT_FOUND", message, 404);
  }
}

export class TenantAccessDeniedError extends AppError {
  constructor(message = "You do not have access to this institution.") {
    super("TENANT_ACCESS_DENIED", message, 403);
  }
}

export class TenantSelectionRequiredError extends AppError {
  constructor(message = "Select an institution before continuing.") {
    super("TENANT_SELECTION_REQUIRED", message, 409);
  }
}

export class ConflictError extends AppError {
  constructor(message = "That action conflicts with the current state.") {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input.") {
    super("VALIDATION_ERROR", message, 400);
  }
}

/** Invalid, expired, revoked, or already-used single-use link. */
export class InvalidLinkError extends AppError {
  constructor(message = "This link is invalid or has expired.") {
    super("INVALID_LINK", message, 400);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", "Too many attempts. Try again shortly.", 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ApiErrorBody = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
};

/**
 * Maps any thrown value to a stable API shape. Unexpected errors are logged by
 * the caller and never returned to the client.
 */
export function toApiError(
  error: unknown,
  requestId: string,
): { status: number; body: ApiErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.httpStatus,
      body: { code: error.code, message: error.message, requestId },
    };
  }

  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join(".") || "_root";
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return {
      status: 422,
      body: {
        code: "VALIDATION_ERROR",
        message: "The submitted data is invalid.",
        fieldErrors,
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", requestId },
  };
}
