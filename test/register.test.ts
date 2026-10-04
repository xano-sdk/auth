/**
 * registerAuth / export-surface behavior on a consumer `Xano` instance:
 * turnkey install, granular registration, auth-table resolution, and the
 * guard rails (double-install, coexisting consumer auth table).
 */
import { describe, it, expect } from "vitest";
import { Xano, table, f, seedLockOverrides } from "@xano/sdk";
import { emptyLock, lockKey } from "@xano/sdk/internal";
import {
  registerAuth,
  userTable,
  authenticationGroup,
  loginQuery,
  meQuery,
  signupQuery,
  createEventLogFn,
  accountTable,
  eventLogTable,
} from "../src/index.js";
import { GUIDS } from "./constants.js";

type Bundle = {
  payload: {
    dbo: Array<{ name: string; guid: string }>;
    function: Array<{ name: string; guid: string }>;
    app: Array<{ name: string; guid: string }>;
    query: Array<{ name: string; guid: string; auth: unknown }>;
  };
};

const freshInstance = () => new Xano().registerWorkspace({ name: "consumer-app" });

describe("registerAuth (turnkey install)", () => {
  it("registers the full set and exports cleanly", () => {
    const xano = registerAuth(freshInstance());
    const bundle = xano.export() as unknown as Bundle;
    expect(bundle.payload.dbo.map((d) => d.name).sort()).toEqual(["account", "event_log", "user"]);
    expect(bundle.payload.function.map((d) => d.name)).toEqual([
      "Getting Started Template/create_event_log",
    ]);
    expect(bundle.payload.app.map((d) => d.name)).toEqual(["Authentication"]);
    expect(bundle.payload.query.map((d) => d.name).sort()).toEqual([
      "auth/login",
      "auth/me",
      "auth/signup",
    ]);
  });

  it("stamps the name-derived guid for each object (no lock seeded)", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const guids = [
      ...bundle.payload.dbo,
      ...bundle.payload.function,
      ...bundle.payload.app,
      ...bundle.payload.query,
    ].map((o) => o.guid);
    for (const derived of Object.values(GUIDS)) {
      expect(guids).toContain(derived);
    }
  });

  it("keeps an existing install's query guids when the lock carries the legacy key", () => {
    // Query guids derive from `query:<apiGroup>|<verb>|<name>`. The SDK still
    // honors a lock entry under the legacy `query:<name>` key, which is the only
    // reason an already-deployed consumer does not see its three endpoints
    // replaced. Pin that fallback here: without it the export silently emits the
    // new derivation and the consumer's live objects are orphaned.
    const lock = emptyLock();
    const legacy = "11111111111111111111111111111111";
    const key = lockKey("query", "auth/signup"); // the legacy seed shape
    lock.objects[key] = { ...(lock.objects[key] ?? {}), guid: legacy };
    seedLockOverrides(lock);

    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const signup = bundle.payload.query.find((q) => q.name === "auth/signup");
    expect(signup?.guid).toBe(legacy);
    // The unlocked siblings still take the new derivation, so this proves the
    // fallback is keyed per object rather than switching the whole encoding.
    expect(bundle.payload.query.find((q) => q.name === "auth/login")?.guid).toBe(GUIDS.login);
  });

  it("leaves the api group's canonical empty for the lock/engine to assign", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle & {
      payload: { app: Array<{ canonical: string }> };
    };
    expect(bundle.payload.app[0]?.canonical).toBe("");
  });

  it("resolves auth/me's auth table ref to the ported user table's guid", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const me = bundle.payload.query.find((q) => q.name === "auth/me");
    expect(me?.auth).toBe(GUIDS.user);
  });

  it("returns the same instance for chaining", () => {
    const xano = freshInstance();
    expect(registerAuth(xano)).toBe(xano);
  });

  it("throws a clear error when called twice on the same instance", () => {
    const xano = registerAuth(freshInstance());
    expect(() => registerAuth(xano)).toThrow(/already called on this Xano instance/);
  });
});

describe("registerAuth ({ history }) — issue #10", () => {
  // `authenticationGroup` is a module singleton, so every test here mutates
  // shared state; `test/setup.ts` clears `history` after each one.
  type HistoryBundle = {
    payload: {
      app: Array<{ history: { inherit: boolean; query_enabled: boolean; query_limit: number } }>;
      query: Array<{ name: string; history: { inherit: boolean } }>;
    };
  };
  const groupHistory = (xano: ReturnType<typeof registerAuth>) =>
    (xano.export() as unknown as HistoryBundle).payload.app[0]!.history;

  it("defaults OFF — a turnkey install captures no signup/login bodies", () => {
    // The engine's default for queries is ON, and history records the request
    // body: an inheriting auth/signup would persist the plaintext password and
    // the minted (unrevokable, 24h) token. A one-call install must not.
    const bundle = registerAuth(freshInstance()).export() as unknown as HistoryBundle;
    expect(bundle.payload.app[0]?.history).toMatchObject({
      inherit: false,
      query_enabled: false,
    });
    // The queries must keep INHERITING for the group setting to reach them —
    // an SDK change to history inheritance would otherwise silently re-enable
    // capture on all three while this group setting still read "off".
    for (const q of bundle.payload.query) expect(q.history.inherit).toBe(true);
  });

  it("opts back in on request, at default depth or an explicit one", () => {
    expect(groupHistory(registerAuth(freshInstance(), { history: true }))).toMatchObject({
      inherit: false,
      query_enabled: true,
      query_limit: 100,
    });
    delete authenticationGroup.history;
    expect(groupHistory(registerAuth(freshInstance(), { history: 25 }))).toMatchObject({
      query_enabled: true,
      query_limit: 25,
    });
    delete authenticationGroup.history;
    expect(groupHistory(registerAuth(freshInstance(), { history: "all" }))).toMatchObject({
      query_enabled: true,
      query_limit: -1,
    });
  });

  it("rejects a value outside boolean | positive int | \"all\", without mutating the def", () => {
    // A JS consumer, or a setting read out of untyped env/JSON config, can hand
    // us anything; an unrecognized value stored on the def would surface inside
    // the SDK's encoder after the shared singleton had already been mutated.
    for (const value of [0, -1, 1.5, NaN, "true", "ALL", null, {}, []]) {
      expect(() =>
        registerAuth(freshInstance(), { history: value as unknown as boolean }),
      ).toThrow(/is not a valid setting/);
      expect(authenticationGroup.history).toBeUndefined();
    }
  });

  it("honors a hand-set `authenticationGroup.history = false` (the cherry-pick path)", () => {
    // Agreement with the package default is a no-op, not a conflict — the
    // mutation the pre-#10 README documented keeps working unchanged.
    authenticationGroup.history = false;
    expect(groupHistory(registerAuth(freshInstance()))).toMatchObject({
      inherit: false,
      query_enabled: false,
    });
  });

  it("refuses to silently change a setting an earlier call in this process made", () => {
    // The group def is process-wide. Keeping the prior value would ship a
    // setting this call did not ask for; overwriting it would retarget the
    // workspace that set it first. Both directions throw.
    registerAuth(freshInstance(), { history: true });
    expect(() => registerAuth(freshInstance())).toThrow(/already set to true/);
    expect(() => registerAuth(freshInstance(), { history: 25 })).toThrow(/already set to true/);
    // Re-stating the same value is fine.
    expect(() => registerAuth(freshInstance(), { history: true })).not.toThrow();
    expect(authenticationGroup.history).toBe(true);
  });

  it("rolls the setting back when the register chain throws", () => {
    // Mirrors the canonical rollback: a failed call must not leave the
    // process-wide singleton mutated, or the corrective retry reports the wrong
    // cause. No register* call throws today, so the failure is injected.
    const xano = freshInstance();
    const boom = new Error("consumer registration failed");
    (xano as unknown as { registerTables: () => never }).registerTables = () => {
      throw boom;
    };
    expect(() => registerAuth(xano, { history: true })).toThrow(boom);
    expect(authenticationGroup.history).toBeUndefined();
  });
});

describe("consumer workspace with use_xdo:true", () => {
  it("does not flip the user table's storage mode", () => {
    type Dbo = { name: string; use_xdo: boolean; index: Array<{ type: string }> };
    const bundle = registerAuth(
      new Xano().registerWorkspace({ name: "consumer-app", use_xdo: true }),
    ).export() as unknown as { payload: { dbo: Dbo[] } };
    const user = bundle.payload.dbo.find((d) => d.name === "user");
    expect(user?.use_xdo).toBe(false);
    expect(user?.index.some((i) => i.type === "gin")).toBe(false);
  });
});

describe("granular registration", () => {
  it("a cherry-picked subset (login only) exports cleanly", () => {
    const bundle = freshInstance()
      .registerTables([userTable, accountTable, eventLogTable])
      .registerFunctions([createEventLogFn])
      .registerApiGroups([authenticationGroup])
      .registerQueries([loginQuery])
      .export() as unknown as Bundle;
    expect(bundle.payload.query.map((q) => q.name)).toEqual(["auth/login"]);
  });
});

describe("coexistence with a consumer's own auth table", () => {
  // A query's `auth` binds to a NAMED table def, not `true`, so a consumer may
  // register their own auth table alongside `user` and both resolve. Older
  // XanoScript allowed exactly one, because `auth: true` had nothing else to
  // resolve against — pinned here so a regression to that single-table coupling
  // fails in this package first.
  it("exports cleanly and keeps auth/me bound to the ported user table", () => {
    const second = table({ name: "admin_user", auth: true, schema: { email: f.email() } });
    const bundle = registerAuth(freshInstance())
      .registerTables([second])
      .export() as unknown as Bundle;
    expect(bundle.payload.dbo.map((d) => d.name).sort()).toEqual([
      "account",
      "admin_user",
      "event_log",
      "user",
    ]);
    expect(bundle.payload.query.find((q) => q.name === "auth/me")?.auth).toBe(GUIDS.user);
  });
});

describe("registerAuth ({ canonical }) — issue #2", () => {
  // `authenticationGroup` is a module singleton, so every test here mutates
  // shared state. The reset lives in `test/setup.ts` so it applies to every
  // file unconditionally, rather than depending on describe ordering here.

  it("pins the group's canonical so a bare getPath() resolves with no lock", () => {
    const xano = registerAuth(freshInstance(), { canonical: "authn" });
    // The deployed path and the client-derived path agree — the point of #2.
    const app = (xano.export() as unknown as Bundle).payload.app[0] as unknown as {
      canonical: string;
    };
    expect(app.canonical).toBe("authn");
    expect(loginQuery.getPath()).toBe("/api:authn/auth/login");
    expect(meQuery.getPath()).toBe("/api:authn/auth/me");
    expect(signupQuery.getPath()).toBe("/api:authn/auth/signup");
  });

  it("leaves the canonical unpinned when no option is passed", () => {
    registerAuth(freshInstance());
    expect(authenticationGroup.canonical).toBeUndefined();
  });

  it("rejects a canonical that is not a url-safe segment, without mutating the def", () => {
    const bad = [
      "", // empty
      "auth/n", // path separator — would split the URL segment
      "auth n",
      "auth?x", // query separator
      "authn!",
      "..", // path traversal
      "authn\n", // `$` is strict without the /m flag; pinned so a future edit can't relax it
      "auth\nn",
      "authn٣", // non-ASCII digit — \d-style classes would let this through
    ];
    for (const value of bad) {
      expect(() => registerAuth(freshInstance(), { canonical: value })).toThrow(
        /not a valid URL segment/,
      );
      expect(authenticationGroup.canonical).toBeUndefined();
    }
  });

  it("rejects a non-string canonical instead of coercing it", () => {
    // `RegExp.test` stringifies, so `123` and `["authn"]` match the pattern via
    // their string form and would then be stored unconverted. JS consumers, and
    // TS consumers reading a canonical out of env/JSON config, hit this.
    for (const value of [123, ["authn"], { toString: () => "authn" }, true, null]) {
      expect(() =>
        registerAuth(freshInstance(), { canonical: value as unknown as string }),
      ).toThrow(/not a valid URL segment/);
      expect(authenticationGroup.canonical).toBeUndefined();
    }
  });

  it("refuses to let a later workspace silently inherit an earlier pin", () => {
    // The group def is process-wide, so omitting the option does not unpin it.
    // Without this guard workspace B would ship A's segment and collide at
    // import — the exact failure the conflicting-value guard exists to prevent.
    registerAuth(freshInstance(), { canonical: "authn" });
    expect(() => registerAuth(freshInstance())).toThrow(/already pinned to "authn"/);
    expect(authenticationGroup.canonical).toBe("authn");
  });

  it("an in-code canonical wins over the lock, and a per-call one wins over both", () => {
    const lock = emptyLock();
    const key = lockKey("app", "Authentication");
    lock.objects[key] = { ...(lock.objects[key] ?? {}), canonical: "fromlock" };
    seedLockOverrides(lock);

    const xano = registerAuth(freshInstance(), { canonical: "pinned" });
    const app = (xano.export() as unknown as Bundle).payload.app[0] as unknown as {
      canonical: string;
    };
    expect(app.canonical).toBe("pinned");
    expect(loginQuery.getPath()).toBe("/api:pinned/auth/login");
    expect(loginQuery.getPath({ canonical: "percall" })).toBe("/api:percall/auth/login");
  });

  it("rejects a double install before touching the shared group def", () => {
    const xano = registerAuth(freshInstance(), { canonical: "authn" });
    // The idempotency guard runs first, so a repeat call cannot re-pin or unpin.
    expect(() => registerAuth(xano, { canonical: "other" })).toThrow(/already called/);
    expect(authenticationGroup.canonical).toBe("authn");
  });

  it("reports canonical validation, not double-install, on a fresh instance", () => {
    // Ordering check: the `installed` guard precedes validation, so this only
    // holds for an instance that has not been registered yet.
    expect(() => registerAuth(freshInstance(), { canonical: "bad!" })).toThrow(
      /not a valid URL segment/,
    );
  });

  // NOTE: `registerAuth` rolls the canonical back if the register* chain throws
  // (src/register.ts), but no current register* call has a throwing path — a
  // duplicate table name is accepted, and the second-auth-table conflict only
  // surfaces at export(). The rollback is defensive and deliberately untested;
  // if a future SDK version makes registration fail, add a case here.

  it("accepts re-pinning the same value, but refuses a conflicting one", () => {
    registerAuth(freshInstance(), { canonical: "authn" });
    // Same value on another instance is a no-op, not an error.
    expect(() => registerAuth(freshInstance(), { canonical: "authn" })).not.toThrow();
    // A different value would silently retarget the first workspace's group.
    expect(() => registerAuth(freshInstance(), { canonical: "other" })).toThrow(
      /already pinned to "authn"/,
    );
    expect(authenticationGroup.canonical).toBe("authn");
  });
});
