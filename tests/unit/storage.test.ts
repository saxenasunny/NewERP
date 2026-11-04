import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertSafeStorageKey,
  getStorage,
  resetStorageCache,
  StorageObjectNotFoundError,
} from "@/lib/storage";
import { EMPTY_PAYLOAD_HASH, signAwsRequest } from "@/lib/storage/sigv4";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lms-storage-test-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_ROOT = root;
  resetStorageCache();
});

afterAll(async () => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.STORAGE_LOCAL_ROOT;
  resetStorageCache();
  await rm(root, { recursive: true, force: true });
});

describe("storage keys", () => {
  it("accepts tenant-scoped keys", () => {
    expect(() => assertSafeStorageKey("tenants/abc/offerings/def/items/ghi")).not.toThrow();
  });

  it("rejects traversal, absolute paths, and empty segments", () => {
    for (const key of ["../secrets", "tenants/../../etc/passwd", "/absolute", "a//b", ""]) {
      expect(() => assertSafeStorageKey(key)).toThrow();
    }
  });
});

describe("local storage adapter", () => {
  it("writes, reads, copies, and deletes an object", async () => {
    const storage = getStorage();
    const key = "tenants/t1/offerings/o1/items/i1";
    const copyKey = "tenants/t1/offerings/o2/items/i2";

    await storage.put(key, Buffer.from("hello material"));
    expect((await storage.get(key)).toString()).toBe("hello material");

    await storage.copy(key, copyKey);
    expect((await storage.get(copyKey)).toString()).toBe("hello material");

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    // Deleting twice is not an error, so cleanup can be best-effort.
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("overwrites an existing object atomically", async () => {
    const storage = getStorage();
    const key = "tenants/t1/offerings/o1/items/replaced";
    await storage.put(key, Buffer.from("old"));
    await storage.put(key, Buffer.from("new"));
    expect((await storage.get(key)).toString()).toBe("new");
  });
});

describe("SigV4 signing", () => {
  const base = {
    method: "GET" as const,
    url: new URL("https://s3.example.com/lms-bucket/tenants/t1/notes.txt"),
    payloadHash: EMPTY_PAYLOAD_HASH,
    region: "eu-west-1",
    service: "s3",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-example",
    now: new Date("2026-10-31T12:00:00.000Z"),
  };

  it("produces a deterministic Authorization header", () => {
    const first = signAwsRequest(base);
    const second = signAwsRequest(base);
    expect(first.authorization).toBe(second.authorization);
    expect(first.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261031\/eu-west-1\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/,
    );
  });

  it("includes the payload hash and date in the signed headers", () => {
    const headers = signAwsRequest(base);
    expect(headers["x-amz-content-sha256"]).toBe(EMPTY_PAYLOAD_HASH);
    expect(headers["x-amz-date"]).toBe("20261031T120000Z");
  });

  it("changes the signature when the request changes", () => {
    const other = signAwsRequest({
      ...base,
      url: new URL("https://s3.example.com/lms-bucket/tenants/t1/other.txt"),
    });
    expect(other.authorization).not.toBe(signAwsRequest(base).authorization);
  });

  it("uses a different signature for a different secret", () => {
    const other = signAwsRequest({ ...base, secretAccessKey: "another-secret" });
    expect(other.authorization).not.toBe(signAwsRequest(base).authorization);
  });
});
