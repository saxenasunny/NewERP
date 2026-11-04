import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { config as loadEnv } from "dotenv";
import { afterEach, vi } from "vitest";

loadEnv({ path: [".env.local", ".env"], quiet: true });

// Integration tests run against TEST_DATABASE_URL. Point the application at it
// for the whole test process; the integration helper refuses to touch a
// database whose name does not end in "_test".
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement the native dialog API. Components call these
// methods, so provide minimal, observable behaviour for tests that use them.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
