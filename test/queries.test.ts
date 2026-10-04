/**
 * Encode-level port-fidelity assertions for the Authentication group and the
 * signup/login/me queries — stack order, byte-exact error contract, token
 * expiration, output column selection, and response shapes.
 */
import { describe, it, expect } from "vitest";
import { seedLockOverrides } from "@xano/sdk";
import { encodeQuery, encodeApiGroup, deriveGuid, emptyLock, lockKey } from "@xano/sdk/internal";
import { authenticationGroup } from "../src/api/authentication-group.js";
import { PUBLIC_USER_FIELDS } from "../src/tables/user.js";
import { signupQuery } from "../src/api/signup.js";
import { loginQuery } from "../src/api/login.js";
import { meQuery } from "../src/api/me.js";
import { GUIDS, QUICK_START_TAG } from "./constants.js";

type Stmt = {
  name: string;
  context: Record<string, any>;
  input: Array<{ name: string; value: string; tag: string }>;
  output?: { customize: boolean; items: Array<{ name: string }> };
};
const run = (q: ReturnType<typeof encodeQuery>) => q.run as unknown as Stmt[];
const inputEntry = (s: Stmt, name: string) => s.input.find((e) => e.name === name);
const resultShape = (q: ReturnType<typeof encodeQuery>) =>
  (q.result as Array<{ name: string; value: string; tag: string }>).map((r) => [r.name, r.value, r.tag]);

describe("Authentication api group", () => {
  it("leaves guid + canonical unset for the lock; queries still bind to it by derived guid", () => {
    const g = encodeApiGroup(authenticationGroup);
    // Empty canonical: the consumer's lock mints it (or the engine assigns it at import).
    expect(g.canonical).toBe("");
    expect(authenticationGroup.guid).toBeUndefined();
    expect(g.tag).toEqual(QUICK_START_TAG);
    // Every query binds to the group's name-derived guid — reference and target agree.
    for (const q of [signupQuery, loginQuery, meQuery]) {
      expect(encodeQuery(q).app.id).toBe(GUIDS.group);
    }
  });
});

describe("auth/signup", () => {
  const q = encodeQuery(signupQuery);

  it("has verb/path/guid/tags and three optional inputs with email filters", () => {
    expect(q.name).toBe("auth/signup");
    expect(q.verb).toBe("POST");
    expect(signupQuery.guid).toBeUndefined();
    expect(q.tag).toEqual(QUICK_START_TAG);
    expect(q.input.map((i) => [i.name, i.required])).toEqual([
      ["name", false],
      ["email", false],
      ["password", false],
    ]);
    const email = q.input.find((i) => i.name === "email") as unknown as {
      methods: Array<{ name: string }>;
    };
    expect(email.methods.map((m) => m.name)).toEqual(["trim", "lower"]);
  });

  it("keeps the exact stack order — duplicate check before password validation", () => {
    expect(run(q).map((s) => s.name)).toEqual([
      "mvp:dbo_getby",
      "mvp:precondition",
      "mvp:dbo_add",
      "mvp:create_auth",
      "mvp:function",
    ]);
  });

  it("duplicate-email precondition is accessdenied with the byte-exact message", () => {
    const pre = run(q)[1]!;
    expect(pre.context.error_type).toBe("accessdenied");
    expect(pre.context.error).toEqual({ value: "This account is already in use.", tag: "const" });
  });

  it("db.add writes created_at:'now' and role:'member'; token lives 86400s", () => {
    const add = run(q)[2]!;
    expect(add.input.map((e) => e.name)).toEqual(["created_at", "name", "email", "password", "role"]);
    expect(inputEntry(add, "created_at")?.value).toBe("now");
    expect(inputEntry(add, "role")?.value).toBe("member");
    const token = run(q)[3]!;
    expect(inputEntry(token, "expiration")?.value).toBe("86400");
    expect(inputEntry(token, "dbtable")?.value).toBe(GUIDS.user);
  });

  it("logs a signup event (account_id 0) against the pinned function guid", () => {
    const log = run(q)[4]!;
    expect(log.context.function.id).toBe(GUIDS.createEventLog);
    expect(inputEntry(log, "action")?.value).toBe("signup");
    expect(inputEntry(log, "account_id")?.value).toBe("0");
  });

  it("logs a REDACTED user into event_log.metadata — no password (issue #10)", () => {
    // Deviation from the template, which passed the whole `user` var. Asserted
    // against the exported `PUBLIC_USER_FIELDS` rather than a literal, so
    // widening that list moves this expectation with it — and adding a
    // secret-bearing column to `userTable` cannot leak here by default.
    expect(inputEntry(run(q)[4]!, "metadata")).toMatchObject({
      value: `{ ${PUBLIC_USER_FIELDS.map((f) => `${f}: $var.user.${f}`).join(", ")} }`,
      tag: "const:expr2",
    });
    expect(inputEntry(run(q)[4]!, "metadata")?.value).not.toContain("password");
  });

  it("responds {authToken, user_id}", () => {
    expect(resultShape(q)).toEqual([
      ["authToken", "authToken", "var"],
      ["user_id", "user.id", "var"],
    ]);
  });
});

describe("auth/login", () => {
  const q = encodeQuery(loginQuery);

  it("pulls the internal password hash via the output list (load-bearing)", () => {
    const get = run(q)[0]!;
    expect(get.output?.customize).toBe(true);
    expect(get.output?.items.map((i) => i.name)).toEqual([
      "id", "created_at", "name", "email", "password", "account_id", "role",
    ]);
  });

  it("keeps the exact stack order with two indistinguishable failure branches", () => {
    expect(run(q).map((s) => s.name)).toEqual([
      "mvp:dbo_getby",
      "mvp:precondition",
      "mvp:check_pass",
      "mvp:precondition",
      "mvp:create_auth",
      "mvp:function",
    ]);
    for (const idx of [1, 3]) {
      const pre = run(q)[idx]!;
      expect(pre.context.error_type).toBe("accessdenied");
      expect(pre.context.error).toEqual({ value: "Invalid Credentials.", tag: "const" });
    }
  });

  it("maps check_password args from the input password and fetched hash", () => {
    const check = run(q)[2]!;
    expect(inputEntry(check, "text_password")).toMatchObject({ value: "password", tag: "input" });
    expect(inputEntry(check, "hash_password")).toMatchObject({ value: "user.password", tag: "var" });
  });

  it("logs a REDACTED user into event_log.metadata — no password hash (issue #10)", () => {
    // Login is the sharper case: its `db.get` output list deliberately pulls
    // the `internal` password hash for `check_password`, so the template's
    // `metadata: ref("user")` persisted that hash on every successful login.
    // The hash must reach `check_password` and nothing downstream.
    const log = run(q)[5]!;
    expect(inputEntry(log, "metadata")).toMatchObject({
      value: `{ ${PUBLIC_USER_FIELDS.map((f) => `${f}: $var.user.${f}`).join(", ")} }`,
      tag: "const:expr2",
    });
    expect(inputEntry(log, "metadata")?.value).not.toContain("password");
    // ...while the check itself still reads it.
    expect(inputEntry(run(q)[2]!, "hash_password")).toMatchObject({
      value: "user.password",
      tag: "var",
    });
  });

  it("mints a 24h token and logs a login event, responding {authToken, user_id}", () => {
    expect(inputEntry(run(q)[4]!, "expiration")?.value).toBe("86400");
    expect(inputEntry(run(q)[5]!, "action")?.value).toBe("login");
    expect(resultShape(q)).toEqual([
      ["authToken", "authToken", "var"],
      ["user_id", "user.id", "var"],
    ]);
  });
});

describe("auth/me", () => {
  const q = encodeQuery(meQuery);

  it("is an authenticated GET with an empty input block", () => {
    expect(q.verb).toBe("GET");
    expect(meQuery.guid).toBeUndefined();
    // The SDK resolves a query's `auth` table def to that table's guid.
    expect(q.auth).toBe(GUIDS.user);
    expect(q.input).toEqual([]);
  });

  it("selects the auth user's columns — password absent from the output list", () => {
    const get = run(q)[0]!;
    expect(inputEntry(get, "field_name")?.value).toBe("id");
    expect(inputEntry(get, "field_value")).toMatchObject({ value: "id", tag: "auth" });
    // Asserted against the exported array, not a copy: `PublicUser` derives
    // from the same constant, so the type and the selected columns cannot drift.
    expect(get.output?.items.map((i) => i.name)).toEqual([...PUBLIC_USER_FIELDS]);
    expect(get.output?.items.some((i) => i.name === "password")).toBe(false);
  });

  it("has NO null-user precondition and logs the read", () => {
    // Only the absence of a precondition is asserted here — the *observable*
    // deleted-user outcome (null 200 vs. an error out of the event_log write,
    // whose user_id/account_id inputs are required) is unverified against a live
    // instance and deliberately not claimed. See the note in src/api/me.ts.
    expect(run(q).map((s) => s.name)).toEqual(["mvp:dbo_getby", "mvp:function"]);
    expect(inputEntry(run(q)[1]!, "action")?.value).toBe("get_auth_user");
  });

  it("responds with the bare user record (not an object wrapper)", () => {
    expect(resultShape(q)).toEqual([["", "user", "var"]]);
  });
});

describe("identity invariants", () => {
  it("no def pins a guid — identity is left to the consumer's lock / name-derivation", () => {
    expect(signupQuery.guid).toBeUndefined();
    expect(loginQuery.guid).toBeUndefined();
    expect(meQuery.guid).toBeUndefined();
    expect(authenticationGroup.guid).toBeUndefined();
  });

  it("the group binding resolves to the name-derived guid when no lock is seeded", () => {
    expect(encodeQuery(signupQuery).app.id).toBe(deriveGuid("app", "Authentication"));
  });
});

describe("responseShape is compile-time only", () => {
  // The declared shapes carry real runtime values (`{}` for signup/login, `null`
  // for me). The SDK reads only their type today, but if a future version started
  // serializing unknown def keys those values would land in the XanoScript — a
  // silent, deploy-breaking contract change. Pin it out of the payload.
  it("never reaches the encoded query", () => {
    for (const query of [signupQuery, loginQuery, meQuery]) {
      expect(Object.keys(encodeQuery(query))).not.toContain("responseShape");
      expect(JSON.stringify(encodeQuery(query))).not.toContain("responseShape");
    }
  });
});

describe("getPath() canonical resolution", () => {
  // This package pins no canonical, so `getPath()` has nothing to resolve until
  // the consumer supplies one. These assertions pin the two documented paths
  // (README › "Resolving the path") — the bare-call throw is the behavior the
  // docs must keep warning about, not a bug to paper over. Both the lock
  // overrides and the group's canonical are reset in `test/setup.ts`.

  it("throws when no canonical is available", () => {
    for (const q of [signupQuery, loginQuery, meQuery]) {
      expect(() => q.getPath()).toThrow(/canonical/i);
    }
  });

  it("resolves from an explicit per-call canonical", () => {
    expect(loginQuery.getPath({ canonical: "a1b2c3d4" })).toBe("/api:a1b2c3d4/auth/login");
    expect(meQuery.getPath({ canonical: "a1b2c3d4" })).toBe("/api:a1b2c3d4/auth/me");
  });

  it("resolves from a seeded lock, so a bare getPath() works", () => {
    const lock = emptyLock();
    const key = lockKey("app", "Authentication");
    lock.objects[key] = { ...(lock.objects[key] ?? {}), canonical: "zz99xx88" };
    seedLockOverrides(lock);
    expect(signupQuery.getPath()).toBe("/api:zz99xx88/auth/signup");
    expect(loginQuery.getPath()).toBe("/api:zz99xx88/auth/login");
    expect(meQuery.getPath()).toBe("/api:zz99xx88/auth/me");
  });
});
