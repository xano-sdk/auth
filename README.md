# @xano-sdk/auth

A [Xano SDK](https://www.npmjs.com/package/@xano/sdk) package implementing
Xano's quick-start authentication — `auth/signup`, `auth/login`, `auth/me`, plus
the `user`, `account`, and `event_log` tables and the event-log function —
recreated as typed Xano SDK defs you can register into any workspace and version
behind npm.

This package is also the **reference Xano SDK extension package** — the source
layout here (def modules + explicit registration, def-handle references,
identity left to the consumer's lock, the golden-bundle contract) is the pattern
to copy when building your own.

**Positioning:** the natural fit is a new project adopting this as primary
auth, but it does not have to be your workspace's only auth table — the SDK binds
each endpoint to a named auth table, and `auth/me` names the `user` table this
package ships, so a workspace with its own `auth: true` table can register both.

## Authentication, not authorization

This package signs users in — it mints and verifies tokens. It ships **no
permission checks and no route guards**, so it is not the RBAC answer. Reaching
for it to get role-based access control means discarding it later.

The `user` table does carry a `role` enum (`admin` | `member`, set to `"member"`
on signup) and `auth/me` returns it, but nothing here enforces it. Tokens are
minted with empty `extras`, so the role is not on the token either. Enforce it
with the SDK's `guard.role`, which loads the caller's row by `auth("id")`,
rejects a missing row (401), then checks `role` (403):

```ts
import { query, guard } from "@xano/sdk";
import { userTable } from "@xano-sdk/auth";

export const adminOnly = query({
  name: "admin/report",
  verb: "GET",
  apiGroup: myGroup,                    // one of your own API groups
  auth: userTable,
  input: {},
  stack: [
    ...guard.role(userTable, "admin"),   // a tuple of statements; spread it
    // …the admin-only work
  ],
});
```

## Install

```bash
npm install @xano-sdk/auth @xano/sdk
```

`@xano/sdk` is a `>=1.0.0 <2.0.0` peer dependency — install the current stable
release. This package is built and tested against **1.0.0**. The golden-bundle
test is the peer-drift tripwire, but it only ever exercises the installed
version, so the rest of the declared range is supported-by-range rather than
verified in CI.

The floor names the oldest SDK this package still means the same thing on,
and it is the highest of these:

- **The golden bundle.** The committed fixture matches from the floor up.
- **The documented role guard.** The `guard.role` example under
  **Authentication, not authorization** needs it.
- **A type.** `auth/me`'s response is derived from its stack, which needs the
  SDK's miss-to-null handling for `db.get`; without it
  `InferResponse<typeof meQuery>` silently loses its `| null`.

The ceiling is the SDK's next **major**: any major may change what the defs
encode to, so `2.0.0` is where a release stops being one this package has any
claim about. Moving either end is a deliberate step — bump the dev pin, confirm
the golden bundle, then widen.

**The committed fixture was generated against SDK 1.0.0** — the version in
`devDependencies`, and the only one the suite ever encodes against. It matches
every SDK from the floor up; below the floor is out of scope. A failure anywhere
in the range is real drift: find out why rather than regenerating.

The package is ESM-only (no `require`) and needs Node >= 20.

## Quickstart

Starting a new project? The Xano SDK CLI installs the package and writes its
registration into `xano/index.ts` for you:

```bash
npx xanosdk init my-app --marketplace @xano-sdk/auth
```

In an existing project, `npx xanosdk marketplace install @xano-sdk/auth` installs
the package and prints the registration lines; add them to `xano/index.ts`
yourself:

```ts
// xano/index.ts
import { workspace } from "@xano/sdk";
import { registerAuth } from "@xano-sdk/auth";

export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

```bash
npx xanosdk login                                  # once per machine
npx xanosdk deploy                                 # → a disposable backend and its URL
npx xanosdk export xano/index.ts -o bundle.json    # → or an importable bundle
```

The endpoints are served under the Authentication group's canonical:
`<instanceUrl>/api:authn/auth/signup`, `/auth/login`, and `/auth/me`.
`{ canonical: "authn" }` pins that URL segment in your code, so the deployed path
and a client-derived `getPath()` agree with no lock file. Leave the options
object out and your `xano.lock` mints the segment instead (see **Identity & the
lock** below).

### Request history is off by default

Xano's request history defaults **on** for query endpoints and records the
request body, so an inheriting `auth/signup` / `auth/login` would persist the
caller's plaintext password next to the token it just minted. This package
overrides that: `registerAuth` sets the Authentication group's history to
`false`, and the three queries inherit it. Opt back in for local debugging:

```ts
registerAuth(workspace("my-app"), { history: true });   // engine default depth
registerAuth(workspace("my-app"), { history: 25 });     // capture depth 25
registerAuth(workspace("my-app"), { history: "all" });  // unlimited depth
```

The depth caps how many statement executions a single history record's stack
trace keeps — it is not a retention limit. Like `canonical`, the setting lands
on a process-wide singleton, so every `registerAuth` in one process must agree;
a call that would change it throws.

## Identity & the lock

This package pins **no** object guids, and no canonical unless you ask for one
(`registerAuth(xano, { canonical })` — see **Resolving the path**; an in-code
value takes precedence over the lock). Otherwise identity comes from the
consuming project, in one of two ways:

- **With `xano.lock` (recommended, and the CLI's default):** `xanosdk export` and
  `xanosdk deploy` read and update the `xano.lock` beside your entry file. The
  first run mints and freezes a guid for every object and a canonical for the
  Authentication group, then every later run reuses them. That makes repeated
  imports idempotent (same lock → same identities → updates in place, never
  duplicates) and keeps your API URL stable. Commit `xano.lock`.
- **Without a lock (`--no-lock`):** each object's guid derives deterministically
  from its name (`md5("<kind>:<name>")`), and the engine assigns the group a
  random canonical at import time. Fine for a one-shot import; use the lock if
  you re-import.

Because references resolve through the same derivation, the queries bind to the
tables and function correctly under either path — no manual guid wiring.

## Cherry-picking individual defs

Cherry-picking instead of the turnkey install works too — every def is a named
export (`userTable`, `accountTable`, `eventLogTable`, `createEventLogFn`,
`authenticationGroup`, `signupQuery`, `loginQuery`, `meQuery`). Register the
defs you want; keep their dependencies together (queries need `userTable`,
`createEventLogFn` needs `eventLogTable`). Never register a def twice, and
call `registerAuth` at most once per instance (it throws on a second call).

## Endpoints

### POST `auth/signup`

| Input | Type | Notes |
|---|---|---|
| `name` | text, optional | trimmed at the column |
| `email` | email, optional | `trim` + `lower` at input and column |
| `password` | text, optional | column policy: min 8 chars, ≥1 letter, ≥1 digit |

Creates the user with `role: "member"`, mints a 24-hour token, logs a
`signup` event. Response: `{ authToken, user_id }`.

Errors: duplicate email → `accessdenied` `"This account is already in use."`
(this check fires **before** password validation, so a duplicate email with a
bad password reports the duplicate). Password-policy violations surface as
table validation errors, not `accessdenied`.

### POST `auth/login`

| Input | Type | Notes |
|---|---|---|
| `email` | email, optional | `trim` + `lower` |
| `password` | text, optional | |

Verifies the password against the stored hash, mints a 24-hour token, logs a
`login` event. Response: `{ authToken, user_id }`.

Errors: unknown email and wrong password both return `accessdenied`
`"Invalid Credentials."` — deliberately indistinguishable.

### GET `auth/me` (authenticated)

Returns the token's user record: `{ id, created_at, name, email, account_id,
role }` (never `password`). Logs a `get_auth_user` event.

## Tables

- **`user`** (auth table) — `name`, `email` (unique, case-insensitively via
  the lower filter), `password` (internal visibility), `account_id` →
  `account`, `role` (`admin` | `member`), `password_reset` object (reserved
  for the quick-start's reset flow; this package ships no reset endpoints).
- **`account`** — `name`, `description`, `location`.
- **`event_log`** — `user_id`, `account_id`, `action`, `metadata` (json).

## Calling the endpoints from a typed client

Each query is a def that knows its own route, verb, request payload, and
response shape, so the code that *calls* the API reuses the def instead of
re-typing URLs and bodies. The *request* types are
derived from each def and cannot drift; `auth/me`'s response is derived too,
while `signup`/`login` hand-declare theirs (see **Response shapes** below).

```ts
// The bare getPath() calls below need a pinned canonical, so this evaluates the
// Quickstart's xano/index.ts, which passes { canonical } to registerAuth.
// Without a pin, getPath() throws — see "Resolving the path". In a browser
// bundle, prefer the generated routes module described there.
import "./xano/index.js";
import { loginQuery, meQuery } from "@xano-sdk/auth";
import type { InferInput, InferResponse } from "@xano/sdk";

const BASE = "https://your-instance.xano.io";

type LoginBody = InferInput<typeof loginQuery>;      // { email?: string; password?: string }
type LoginOut  = InferResponse<typeof loginQuery>;   // { authToken: string; user_id: number }
type MeOut     = InferResponse<typeof meQuery>;      // PublicUser | null

async function login(email: string, password: string): Promise<LoginOut> {
  const res = await fetch(BASE + loginQuery.getPath(), {
    method: loginQuery.verb,                          // "POST"
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password } satisfies LoginBody),
  });
  return res.json();
}

async function me(token: string): Promise<MeOut> {
  const res = await fetch(BASE + meQuery.getPath(), {
    method: meQuery.verb,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();                                  // may be null — see below
}
```

### Resolving the path

`getPath()` builds `/api:<canonical>/<name>`, so it needs the Authentication
group's canonical. By default this package pins **none** (see **Identity & the
lock**) and a canonical can't be minted on the fly — it must be unique per
instance — so a bare `getPath()` **throws**.

**Pin one at registration** and both sides agree, with no lock file and nothing
for the browser to look up:

```ts
// xano/index.ts — the same module your frontend imports the defs from
import { workspace } from "@xano/sdk";
import { registerAuth } from "@xano-sdk/auth";

export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

```ts
// anywhere downstream of that module — including a browser bundle
import "./xano/index.js";    // evaluating it is what sets the canonical
import { loginQuery } from "@xano-sdk/auth";

loginQuery.getPath();        // → /api:authn/auth/login
```

The pin is a side effect of `registerAuth` running *with a canonical*, so that
module must actually be *evaluated* in that module graph — importing the defs
alone is not enough.

**For a browser bundle, generate the routes instead.** Importing any def pulls
in the SDK runtime to build its stack (about 267 kB minified, 65 kB gzipped, for
the first def). The CLI writes the same verbs and paths as plain data that
imports nothing, and a renamed route is still a type error:

```bash
npx xanosdk routes xano/index.ts --emit xano/routes.gen.ts
```

Keep the defs for their types (`import type` costs nothing) and take paths from
the generated module. `loginQuery.getPath({ canonical: "authn" })` also works
without registration, but it still carries the runtime.

An in-code canonical takes precedence over the lock, so the deployed path and
the client-derived path are the same value from one source. It must be a
url-safe segment (`[A-Za-z0-9_-]+`); `registerAuth` rejects anything else rather
than emitting a broken path. It must *also* be unique across the instance's API
groups — that one `registerAuth` cannot check, since it sees only this group, so
a collision surfaces at Xano import time rather than at registration. Because the
group def is shared process-wide, once it is pinned every later `registerAuth` in
the same process must pass the same value: a *different* value throws instead of
silently retargeting the workspace registered earlier, and *omitting* the option
throws too rather than letting that workspace silently inherit the segment.

If you'd rather let the lock own identity, the two lock-based paths still work:

```ts
// A. Pass it per call — the canonical arrives as build config.
loginQuery.getPath({ canonical: "a1b2c3d4" });   // → /api:a1b2c3d4/auth/login

// B. Seed the lock at startup, BEFORE any def module is imported — defs bake
//    their references at import time, so seeding after is a silent no-op.
//    `readLockFile` is Node-only: build scripts and servers, not a browser.
import { seedLockOverrides } from "@xano/sdk";
import { readLockFile } from "@xano/sdk/node";

seedLockOverrides(readLockFile("./xano.lock"));
const { loginQuery } = await import("@xano-sdk/auth");
loginQuery.getPath();                            // → /api:<locked canonical>/auth/login
```

`xanosdk routes` (above) reads the lock for you. Your first `npx xanosdk export
xano/index.ts` or `deploy` mints the canonical and freezes it in `xano.lock`;
commit that file.

### Response shapes

- **`me`** → `PublicUser | null`, **derived** from the stack. The SDK's static walk
  narrows the `db.get` to the columns in its `output` list and carries that
  statement's miss-to-null, so the type and the selected columns move together —
  edit the `output` and every consumer's type follows. Nothing is declared here,
  so nothing can drift. The `| null` is the endpoint's deliberately missing
  null-user precondition showing up in the type: a token whose user row was
  deleted is not guaranteed to produce a user, so callers must handle its
  absence. (What that path actually *does* — most likely a 500 rather than a
  null body — is still unverified against a live instance; see the note in
  `src/api/me.ts`.)
- **`signup` / `login`** → `AuthTokenResponse` (`{ authToken, user_id }`),
  **declared** via `responseShape`. The token is minted by
  `security.create_auth_token`, so its type isn't readable off a table and
  derivation gives `unknown`. A declared shape wins over derivation and the
  compiler does not cross-check it against the stack, so these two are a
  hand-maintained contract — the type tests pin the declared *keys* against the
  keys the walk does see.

That coupling runs through the exported `PUBLIC_USER_FIELDS` array, which is
both `PublicUser`'s definition and the `output` list of `auth/me`'s read.

The package also exports the table row types — `User` (includes the password
hash), `PublicUser` (the projection `auth/me` returns), `Account`, and
`EventLog`. Types erase at compile time, so `import type` adds no bundle bytes.

## Behavior notes (read before production)

This is a close port of Xano's quick-start template. Its quirks are preserved on
purpose — changing them would fork the template's behavior — **except where the
template's default is a credential leak**. Two deviations, both from
[xanots/sdk#10](https://github.com/xanots/sdk/issues/10):

- **Request history is off by default** (the template inherits the engine's
  ON). See **Request history is off by default** above for the `{ history }`
  opt-in. Left on, signup/login request bodies — plaintext passwords — and the
  minted `authToken`s are captured in the workspace's history store, and this
  package's tokens live 24h with no revocation, so a history reader holds
  working credentials rather than a record of them.
- **`event_log.metadata` records a redacted user**, not the whole row. The
  template passed the full fetched record, and on `auth/login` that record
  deliberately includes the `internal` password hash (`check_password` needs
  it), so every login persisted a hash into a table with none of `user`'s
  access discipline. The projection is `PUBLIC_USER_FIELDS` — the same list
  `auth/me` returns — so it tracks that reviewed array rather than a literal.
  Everything else about `event_log` still applies: treat it as user data.

The remaining quirks are unchanged:

- **Every endpoint writes an event-log row** — including the `auth/me` GET.
  The table grows unbounded; there is no pruning or retention mechanism. You
  own its lifecycle.
- **Signup's event-log row records `account_id: 0`**, a hardcoded literal in the
  source rather than a real account reference (a fresh user has no account yet).
  Login and `me` log the user's actual `account_id`, so filtering `event_log` by
  account silently omits every signup.
- **The group blurb advertises password reset.** The Authentication group's
  description — visible in your workspace — mentions "reset password", which is
  the template's text; no such endpoint exists here.
- **Deleted user, valid token** → `auth/me` does not return a user (the source
  has no null-user guard). The response type is `PublicUser | null`, so
  null-check downstream — but the runtime outcome is most likely an HTTP 500
  rather than a 200 with a null body: the `db.get` binds null and the next
  statement drills `user.id` out of it, which the SDK documents as a runtime
  "Unable to locate var". Unverified against a live instance.
- **Tokens live 24h with no refresh or revocation.** Multiple valid tokens
  per user is normal; password changes don't invalidate existing tokens.
- **Signup reveals account existence** ("already in use") — a deliberate
  template behavior; login's failures are indistinguishable.
- **Your own auth table may coexist.** `auth/me` names this package's `user`
  table explicitly, so registering another `auth: true` table is fine — it just
  isn't what these endpoints authenticate against.
- **Quick-start naming is visible.** Objects keep their source names and
  `xano:quick-start` tags — you'll see "Getting Started Template/
  create_event_log" in your workspace even if you never installed the
  template. Rename them in your own fork if that's confusing; the guids are not
  pinned, so a rename just changes the name-derived identity (pin it in your
  lock first if you've already imported).
- **Your API URL depends on the lock** unless you pin it. The Authentication
  group's canonical (the `/api:<canonical>/` path segment) is minted by your
  `xano.lock`, or randomized by the engine if you import without one. Commit the
  lock to keep the URL stable across re-imports, or pass
  `registerAuth(xano, { canonical })` to own the segment outright.

## Versioning

The exported bundle is covered by a byte-exact golden test. An SDK peer bump
that changes the encoded bundle fails this package's test suite before it can
reach you — which is why the **dev pin** moves in lockstep with `@xano-sdk/auth`
releases, and only ever to a version this package has been rebuilt and retested
against. The **peer floor** is a different number and moves far less often:
only when a newer SDK *type* becomes load-bearing here, an SDK changes what
these defs encode to, or these docs start relying on a newer SDK API (see
**Install**).

## License

MIT
