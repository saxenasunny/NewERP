import { describe, expect, it } from "vitest";

import { EnvValidationError, getServerEnv, parseServerEnv, resetServerEnvCache } from "@/lib/env";

const validEnv = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://lms:lms_dev_password@localhost:5432/lms_dev?schema=public",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("parseServerEnv", () => {
  it("accepts a complete configuration", () => {
    const env = parseServerEnv(validEnv);
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults NODE_ENV to development", () => {
    const withoutNodeEnv: Record<string, string | undefined> = { ...validEnv };
    delete withoutNodeEnv.NODE_ENV;
    expect(parseServerEnv(withoutNodeEnv).NODE_ENV).toBe("development");
  });

  it("names missing variables without leaking values", () => {
    try {
      parseServerEnv({});
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const envError = error as EnvValidationError;
      expect(envError.variables).toEqual(
        expect.arrayContaining(["APP_BASE_URL", "DATABASE_URL", "AUTH_SECRET"]),
      );
      expect(envError.message).not.toContain("postgresql://");
    }
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => parseServerEnv({ ...validEnv, AUTH_SECRET: "too-short" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({ ...validEnv, DATABASE_URL: "mysql://localhost:3306/lms" }),
    ).toThrow(EnvValidationError);
  });

  it("rejects a relative or path-bearing APP_BASE_URL", () => {
    expect(() => parseServerEnv({ ...validEnv, APP_BASE_URL: "/" })).toThrow(EnvValidationError);
    expect(() => parseServerEnv({ ...validEnv, APP_BASE_URL: "http://localhost:3000/" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseServerEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(EnvValidationError);
  });
});

describe("getServerEnv", () => {
  it("caches the first successful parse", () => {
    resetServerEnvCache();
    Object.assign(process.env, validEnv);
    const first = getServerEnv();
    process.env.AUTH_SECRET = "a-different-secret-that-is-long-enough";
    expect(getServerEnv()).toBe(first);
    resetServerEnvCache();
  });
});
