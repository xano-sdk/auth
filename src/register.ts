/**
 * One-call install: registers the full auth set (tables, function, api group,
 * queries) onto a consumer's `Xano` instance.
 *
 * Constraints (enforced/documented):
 * - Call it once per instance — a second call would register duplicate defs.
 *   Guarded by a WeakSet.
 * - The consumer may register their own `auth: true` table alongside this one:
 *   `auth/me` names the ported `user` table, so it is unaffected.
 * - Do not additionally pass this package's defs to your own register* calls.
 * - It writes to the process-wide `authenticationGroup` singleton: `canonical`
 *   when one is passed, and `history` on every call (it has a package default —
 *   off — rather than deferring to the engine's inherit-on). Both refuse to
 *   change a value an earlier call in the same process set.
 */
import type { HistoryInput, Xano } from "@xano/sdk";
import { userTable } from "./tables/user.js";
import { accountTable } from "./tables/account.js";
import { eventLogTable } from "./tables/event-log.js";
import { createEventLogFn } from "./functions/create-event-log.js";
import { authenticationGroup } from "./api/authentication-group.js";
import { signupQuery } from "./api/signup.js";
import { loginQuery } from "./api/login.js";
import { meQuery } from "./api/me.js";

const installed = new WeakSet<Xano>();

/**
 * The alphabet `mintCanonical()` emits (url-safe base64). Anything outside it
 * would land in the URL path unescaped and produce a broken endpoint — the SDK
 * does not validate a hand-supplied canonical, so this package does.
 */
const CANONICAL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The group's request-history setting when the caller does not pass one.
 *
 * `false`, not the engine's inherit-on default: request history captures the
 * request body, so an inheriting `auth/signup` / `auth/login` writes the
 * submitted plaintext password — and the minted 24h token, which this package
 * cannot revoke — into the workspace's history store on every call (issue #10).
 * A one-call install must not do that; `{ history: true }` opts back in.
 */
const DEFAULT_HISTORY: HistoryInput = false;

/**
 * Render a history value for an error message. Numbers go through `String` so
 * `NaN` and `Infinity` — both rejected below — name themselves; `JSON.stringify`
 * renders each as `null`, which reads as a different bad value than the one
 * passed.
 */
const showHistory = (value: unknown) =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

/**
 * `HistoryInput` is `boolean | number | "all"`, but a JS consumer (or a value
 * read out of untyped env/JSON config) can hand us anything. Reject early: an
 * unrecognized value stored on the def would reach the SDK's encoder and either
 * throw there — after the group singleton was mutated — or coerce into a
 * capture depth nobody asked for.
 */
function assertHistoryInput(value: unknown): asserts value is HistoryInput {
  if (typeof value === "boolean" || value === "all") return;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return;
  throw new Error(
    `registerAuth: history ${showHistory(value)} is not a valid setting — pass \`false\` (off, the ` +
      "default), `true` (on at the engine's default capture depth), a positive integer (capture depth), " +
      'or "all" (unlimited depth). Note that the depth caps statements captured per record, not retention.',
  );
}

/** Options for {@link registerAuth}. */
export interface RegisterAuthOptions {
  /**
   * Pin the Authentication group's canonical — the `<canonical>` in
   * `/api:<canonical>/auth/login`.
   *
   * By default this package pins none, so identity comes from the consumer's
   * `xano.lock` and `getPath()` throws until that lock is seeded (unavailable
   * in a browser bundle). Passing one here sets it as an explicit in-code
   * value, which takes precedence over the lock, so the deployed path is
   * stable *and* a bare `getPath()` resolves with no lock:
   *
   * ```ts
   * // xano/index.ts
   * export default registerAuth(workspace("my-app"), { canonical: "authn" });
   * ```
   *
   * ```ts
   * // downstream — the import is what pins the canonical
   * import "./xano/index.js";
   * import { loginQuery } from "@xano-sdk/auth";
   *
   * loginQuery.getPath();   // → /api:authn/auth/login
   * ```
   *
   * The pin is a *side effect of this call running*, not a property of the
   * imported defs: it lands on the process-wide `authenticationGroup` singleton
   * when `registerAuth` executes. Importing `@xano-sdk/auth` on its own pins
   * nothing, so a bare `getPath()` still throws — the module that calls
   * `registerAuth` must be evaluated in the same module graph first.
   *
   * That makes this option a poor fit for a browser bundle, since importing
   * `xano/index.ts` there drags in `workspace()` and every def's full statement
   * stack. Clients should carry the segment as build config and pass it per
   * call — `loginQuery.getPath({ canonical: "authn" })` — which needs no
   * registration and no lock.
   *
   * Must be a url-safe segment (`[A-Za-z0-9_-]+`); `registerAuth` rejects
   * anything else. It must *also* be unique per Xano instance across all
   * workspaces, which `registerAuth` cannot check — it sees only this group, so
   * a collision with an unrelated group surfaces at import, not here.
   *
   * The group def is a process-wide singleton, so once any `registerAuth` pins
   * it, every later call in the same process must pass the same value; both a
   * conflicting value and an omitted one throw rather than silently retarget or
   * inherit.
   */
  canonical?: string;

  /**
   * Request-history capture for the Authentication group — the container tier
   * `auth/signup`, `auth/login`, and `auth/me` inherit from.
   *
   * **Defaults to `false`, unlike the engine**, whose queries inherit history
   * ON. Xano's request history records the request body, so an inheriting
   * `auth/signup` / `auth/login` persists the caller's plaintext password
   * alongside the minted token — and this package's tokens live 24h with no
   * revocation, so a history reader holds working credentials, not just a
   * record of one. A turnkey `registerAuth(workspace("app"))` must not ship
   * that (issue #10).
   *
   * Opt back in for local debugging:
   *
   * ```ts
   * registerAuth(workspace("my-app"), { history: true });   // default depth
   * registerAuth(workspace("my-app"), { history: 25 });     // capture depth 25
   * registerAuth(workspace("my-app"), { history: "all" });  // unlimited depth
   * ```
   *
   * The depth caps how many statement executions a single history record's
   * stack trace keeps — it is not a retention limit. There is no "inherit from
   * the workspace" value here on purpose: inheriting is what leaks, so asking
   * for it means asking for `true`.
   *
   * Like `canonical`, this writes to the process-wide `authenticationGroup`
   * singleton, so every `registerAuth` in one process must agree — a second
   * call that would change the setting throws rather than silently retargeting
   * the workspace that set it first. Setting `authenticationGroup.history`
   * by hand (the cherry-pick path) still works and is honored, but a value
   * that disagrees with what this call resolves to is an error, not an
   * override.
   */
  history?: HistoryInput;
}

/**
 * Register every @xano-sdk/auth def on the given instance; returns it for
 * chaining. Pass `{ canonical }` to pin the Authentication group's URL segment
 * so `getPath()` resolves without a lock, and `{ history }` to opt back into
 * request-history capture, which defaults **off** here (see
 * {@link RegisterAuthOptions}).
 */
export function registerAuth<X extends Xano>(xano: X, opts: RegisterAuthOptions = {}): X {
  if (installed.has(xano)) {
    throw new Error(
      "registerAuth: already called on this Xano instance. Register the auth set once — " +
        "a second registration duplicates every def in the exported bundle.",
    );
  }

  // Validate before mutating anything, so a bad call leaves no partial state.
  const { canonical } = opts;
  // `authenticationGroup` is a module singleton shared by every instance in the
  // process, so whatever an earlier `registerAuth` pinned is still on the def.
  const prior = authenticationGroup.canonical;

  if (canonical === undefined) {
    // Omitting the option does NOT unpin: this workspace would silently inherit
    // the earlier one's segment and ship it in its own bundle, producing exactly
    // the per-instance collision the explicit-conflict guard below prevents.
    if (prior !== undefined) {
      throw new Error(
        `registerAuth: the Authentication group's canonical is already pinned to ${JSON.stringify(prior)} ` +
          "by an earlier registerAuth() in this process, and the group def is shared process-wide — this " +
          "workspace would inherit that segment rather than its own lock-derived one, colliding at import. " +
          `Pass { canonical: ${JSON.stringify(prior)} } to accept it deliberately, or build the workspaces ` +
          "in separate processes.",
      );
    }
  } else {
    // `RegExp.test` stringifies its argument, so a non-string (a JS consumer, or
    // a canonical read out of untyped JSON/env config) would pass the pattern and
    // then be stored unconverted. Check the type first.
    if (typeof canonical !== "string" || !CANONICAL_PATTERN.test(canonical)) {
      throw new Error(
        `registerAuth: canonical ${JSON.stringify(canonical)} is not a valid URL segment — ` +
          "it must be a non-empty string matching [A-Za-z0-9_-]+ (the alphabet Xano mints). " +
          'It becomes the "<canonical>" in /api:<canonical>/auth/login.',
      );
    }
    // A second, differing canonical would silently retarget the group already
    // registered elsewhere. Surface that instead.
    if (prior !== undefined && prior !== canonical) {
      throw new Error(
        `registerAuth: the Authentication group's canonical is already pinned to ${JSON.stringify(prior)}; ` +
          `refusing to change it to ${JSON.stringify(canonical)}. The group def is shared across every Xano ` +
          "instance in this process, so re-pinning it would also retarget the workspace that set it first. " +
          "Use one canonical per process, or build the workspaces in separate processes.",
      );
    }
  }

  // Unlike `canonical`, history has a package default, so an omitted option is
  // still a decision (`false`) rather than "leave it alone" — that is the whole
  // point of #10. Resolve first, validate second, so a bad explicit value is
  // reported as such instead of silently becoming the default.
  const history = opts.history === undefined ? DEFAULT_HISTORY : opts.history;
  if (opts.history !== undefined) assertHistoryInput(opts.history);

  const priorHistory = authenticationGroup.history;
  // The group def is process-wide, so an earlier registerAuth (or a consumer's
  // own `authenticationGroup.history = …` before the call) is still on it.
  // Agreement is fine — re-stating `false` is a no-op, and the documented
  // hand-mutation path resolves to exactly that. A disagreement is not: silently
  // keeping the prior value would ship a setting this call did not ask for, and
  // silently overwriting it would retarget the workspace that set it first.
  if (priorHistory !== undefined && priorHistory !== history) {
    throw new Error(
      `registerAuth: the Authentication group's request history is already set to ${showHistory(priorHistory)}; ` +
        `refusing to change it to ${showHistory(history)}. The group def is shared across every Xano instance in ` +
        "this process, so changing it would also change the workspace that set it first. " +
        `Pass { history: ${showHistory(priorHistory)} } to accept it deliberately, or build the workspaces in ` +
        "separate processes.",
    );
  }

  // Both settings have to be in place *before* `registerApiGroups`, which
  // snapshots the group. So mutate first, then roll back if the chain throws (a
  // consumer's conflicting table, say) — otherwise a failed call would leave the
  // process-wide singleton mutated and the corrective retry would report
  // "already called" instead of the real cause.
  if (canonical !== undefined) authenticationGroup.canonical = canonical;
  authenticationGroup.history = history;
  try {
    xano
      .registerTables([userTable, accountTable, eventLogTable])
      .registerFunctions([createEventLogFn])
      .registerApiGroups([authenticationGroup])
      .registerQueries([signupQuery, loginQuery, meQuery]);
  } catch (err) {
    if (canonical !== undefined) {
      if (prior === undefined) delete authenticationGroup.canonical;
      else authenticationGroup.canonical = prior;
    }
    if (priorHistory === undefined) delete authenticationGroup.history;
    else authenticationGroup.history = priorHistory;
    throw err;
  }

  installed.add(xano);
  return xano;
}
