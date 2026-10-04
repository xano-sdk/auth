/**
 * Global test hygiene. Two pieces of state in this package are process-wide
 * rather than per-instance — the `authenticationGroup` module singleton (which
 * `registerAuth` mutates: `canonical` when passed, `history` on every call) and
 * the SDK's lock overrides. Vitest's per-file isolation happens to hide
 * leaks between files, but describe-scoped cleanup left ordering inside a file
 * load-bearing. Reset both after every test so no case depends on which one ran
 * before it.
 */
import { afterEach } from "vitest";
import { resetLockOverrides } from "@xano/sdk";
import { authenticationGroup } from "../src/api/authentication-group.js";

afterEach(() => {
  delete authenticationGroup.canonical;
  delete authenticationGroup.history;
  resetLockOverrides();
});
