# @xano-sdk/auth

[![npm](https://img.shields.io/npm/v/@xano-sdk/auth)](https://www.npmjs.com/package/@xano-sdk/auth)
[![license](https://img.shields.io/npm/l/@xano-sdk/auth)](LICENSE)

Xano's quick-start authentication — sign up, log in, and "who am I" — as typed
[Xano SDK](https://www.npmjs.com/package/@xano/sdk) defs. One call registers it
into any workspace; npm versions it.

What you get:

- **Endpoints:** `POST auth/signup`, `POST auth/login`, `GET auth/me`, in an
  Authentication API group.
- **Tables:** `user` (the auth table), `account`, and `event_log`.
- **A function:** `create_event_log`, which every endpoint calls.
- **Types:** request and response types for each endpoint, plus row types for
  each table, so a client calls the API without re-typing URLs or bodies.
- **Safer defaults:** two of the template's credential-leaking defaults are
  overridden. See [Security defaults](#security-defaults).

> [!IMPORTANT]
> **Authentication, not authorization.** This package signs users in: it mints
> and verifies tokens. It ships **no permission checks and no route guards**,
> so it is not an RBAC solution, and adopting it for RBAC means replacing it
> later. To enforce roles, see [Adding role checks](#adding-role-checks).

It is also the **reference Xano SDK extension package**. If you are building
your own, copy its layout: def modules with explicit registration, references
through def handles, identity left to the consumer's lock, and a golden-bundle
contract. The
[extension-package guide](https://github.com/xano-sdk/auth/blob/main/docs/building-an-extension-package.md)
walks through it.

## Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Endpoints](#endpoints)
- [Tables](#tables)
- [Adding role checks](#adding-role-checks)
- [Calling the endpoints from a typed client](#calling-the-endpoints-from-a-typed-client)
- [Identity and the lock](#identity-and-the-lock)
- [Cherry-picking individual defs](#cherry-picking-individual-defs)
- [Security defaults](#security-defaults)
- [Behavior notes](#behavior-notes)
- [Versioning and compatibility](#versioning-and-compatibility)

## Install

```bash
npm install @xano-sdk/auth @xano/sdk
```

`@xano/sdk` is a peer dependency with the range `>=1.0.0 <2.0.0`; install the
current stable release. This package is built and tested against **1.0.0**. See
[Versioning and compatibility](#versioning-and-compatibility) for what the range
does and does not guarantee.

The package is ESM-only (no `require`) and requires Node >= 20.

## Quickstart

To start a new project, let the Xano SDK CLI install the package and write its
registration into `xano/index.ts`:

```bash
npx xanosdk init my-app --marketplace @xano-sdk/auth
```

In an existing project, `npx xanosdk marketplace install @xano-sdk/auth`
installs the package and prints the registration lines. Add them to
`xano/index.ts` yourself:

```ts
// xano/index.ts
import { workspace } from "@xano/sdk";
import { registerAuth } from "@xano-sdk/auth";

export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

Then deploy it, or export an importable bundle:

```bash
npx xanosdk login                                  # once per machine
npx xanosdk deploy                                 # deploy the workspace
npx xanosdk export xano/index.ts -o bundle.json    # or write an importable bundle
```

The endpoints are served under the Authentication group's canonical:
`<instanceUrl>/api:authn/auth/signup`, `/auth/login`, and `/auth/me`.
`{ canonical: "authn" }` pins that URL segment in code, so the deployed path and
a client's `getPath()` agree without a lock file. Leave the options object out
and your `xano.lock` mints the segment instead (see
[Identity and the lock](#identity-and-the-lock)).

**Primary auth or one of several.** A new project adopting this as its main auth
is the natural fit, but it need not be your workspace's only auth table. The SDK
binds each endpoint to a named auth table, and `auth/me` names the `user` table
this package ships, so a workspace with its own `auth: true` table can register
both.

## Endpoints

### `POST auth/signup`

| Input | Type | Notes |
|---|---|---|
| `name` | text, optional | trimmed at the column |
| `email` | email, optional | `trim` + `lower` at input and column |
| `password` | text, optional | column policy: min 8 chars, ≥1 letter, ≥1 digit |

Creates the user with `role: "member"`, mints a 24-hour token, and logs a
`signup` event. Response: `{ authToken, user_id }`.

Errors: a duplicate email returns `accessdenied` `"This account is already in
use."` This check runs **before** password validation, so a duplicate email with
a bad password reports the duplicate. Password-policy violations surface as table
validation errors, not `accessdenied`.

### `POST auth/login`

| Input | Type | Notes |
|---|---|---|
| `email` | email, optional | `trim` + `lower` |
| `password` | text, optional | |

Verifies the password against the stored hash, mints a 24-hour token, and logs a
`login` event. Response: `{ authToken, user_id }`.

Errors: an unknown email and a wrong password both return `accessdenied`
`"Invalid Credentials."`, deliberately indistinguishable.

### `GET auth/me` (authenticated)

Returns the token's user record, `{ id, created_at, name, email, account_id,
role }`, never `password`. Logs a `get_auth_user` event.

## Tables

- **`user`** (auth table): `name`; `email` (unique, case-insensitively via the
  `lower` filter); `password` (internal visibility); `account_id` → `account`;
  `role` (`admin` | `member`); and a `password_reset` object, reserved for the
  quick-start's reset flow. This package ships no reset endpoints.
- **`account`**: `name`, `description`, `location`.
- **`event_log`**: `user_id`, `account_id`, `action`, `metadata` (json).

## Adding role checks

The `user` table carries a `role` enum (`admin` | `member`, set to `"member"` on
signup) and `auth/me` returns it, but nothing in this package enforces it. Tokens
are minted with empty `extras`, so the role is not on the token either.

Enforce it in your own endpoints with the SDK's `guard.role`. It loads the
caller's row by `auth("id")`, rejects a missing row (401), then checks `role`
(403):

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

## Calling the endpoints from a typed client

Each query is a def that knows its own route, verb, request payload, and
response shape, so client code reuses the def instead of re-typing URLs and
bodies. Request types are derived from each def and cannot drift. `auth/me`'s
response type is derived too; `signup` and `login` declare theirs by hand (see
[Response shapes](#response-shapes)).

```ts
// The bare getPath() calls below need a pinned canonical, so this evaluates the
// Quickstart's xano/index.ts, which passes { canonical } to registerAuth.
// Without a pin, getPath() throws (see "Resolving the path"). In a browser
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
  return res.json();                                  // may be null; see Response shapes
}
```

### Resolving the path

`getPath()` builds `/api:<canonical>/<name>`, so it needs the Authentication
group's canonical. By default this package pins **none** (see
[Identity and the lock](#identity-and-the-lock)). A canonical can't be minted on
the fly, because it must be unique per instance, so a bare `getPath()`
**throws**.

**Pin one at registration** and both sides agree, with no lock file and nothing
for the browser to look up:

```ts
// xano/index.ts — the same module your frontend imports the defs from
import { workspace } from "@xano/sdk";
import { registerAuth } from "@xano-sdk/auth";

export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

```ts
// anywhere downstream of that module, including a browser bundle
import "./xano/index.js";    // evaluating it is what sets the canonical
import { loginQuery } from "@xano-sdk/auth";

loginQuery.getPath();        // → /api:authn/auth/login
```

The pin is a side effect of `registerAuth` running *with a canonical*, so that
module must actually be *evaluated* in the module graph. Importing the defs alone
is not enough.

**For a browser bundle, generate the routes instead.** Importing any def pulls in
the SDK runtime to build its stack (about 267 kB minified, 65 kB gzipped, for the
first def). The CLI writes the same verbs and paths as plain data that imports
nothing, and a renamed route is still a type error:

```bash
npx xanosdk routes xano/index.ts --emit xano/routes.gen.ts
```

Keep the defs for their types (`import type` costs nothing) and take paths from
the generated module. `loginQuery.getPath({ canonical: "authn" })` also works
without registration, but it still carries the runtime.

Rules for the pinned canonical:

- **It takes precedence over the lock**, so the deployed path and the client's
  path come from one source.
- **It must be a URL-safe segment** (`[A-Za-z0-9_-]+`). `registerAuth` rejects
  anything else rather than emitting a broken path.
- **It must be unique across the instance's API groups.** `registerAuth` cannot
  check this because it sees only its own group, so a collision surfaces at Xano
  import time, not at registration.
- **Every `registerAuth` in one process must agree.** The group def is shared
  process-wide, so once it is pinned, a later call with a *different* value
  throws instead of silently retargeting the earlier workspace. *Omitting* the
  option throws too, rather than letting the later workspace silently inherit
  the segment.

To let the lock own identity instead, use one of the two lock-based paths:

```ts
// A. Pass it per call; the canonical arrives as build config.
loginQuery.getPath({ canonical: "a1b2c3d4" });   // → /api:a1b2c3d4/auth/login

// B. Seed the lock at startup, BEFORE any def module is imported. Defs bake
//    their references at import time, so seeding afterwards silently does nothing.
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

- **`me`** → `PublicUser | null`, **derived** from the stack. The SDK's static
  walk narrows the `db.get` to the columns in its `output` list and carries that
  statement's miss-to-null, so the type and the selected columns move together:
  edit the `output` and every consumer's type follows. Nothing is declared, so
  nothing can drift. The `| null` reflects the endpoint's missing null-user check,
  which the port deliberately leaves out: a token whose user row was deleted is
  not guaranteed to produce a user, so callers must handle its absence. What that
  path actually *does* (most likely a 500 rather than a null body) is still
  unverified against a live instance; see the note in `src/api/me.ts`.
- **`signup` / `login`** → `AuthTokenResponse` (`{ authToken, user_id }`),
  **declared** via `responseShape`. The token is minted by
  `security.create_auth_token`, so its type can't be read off a table and
  derivation gives `unknown`. A declared shape wins over derivation and the
  compiler does not cross-check it against the stack, so these two are a
  hand-maintained contract. The type tests pin the declared *keys* against the
  keys the walk does see.

The exported `PUBLIC_USER_FIELDS` array ties `me` to its columns: it both defines
`PublicUser` and is the `output` list of `auth/me`'s read.

The package also exports the table row types: `User` (includes the password
hash), `PublicUser` (the projection `auth/me` returns), `Account`, and
`EventLog`. Types erase at compile time, so `import type` adds no bundle bytes.

## Identity and the lock

This package pins **no** object guids, and no canonical unless you ask for one
with `registerAuth(xano, { canonical })` (see
[Resolving the path](#resolving-the-path)); an in-code value takes precedence
over the lock. Otherwise identity comes from your project, in one of two ways:

- **With `xano.lock` (recommended, and the CLI's default):** `xanosdk export`
  and `xanosdk deploy` read and update the `xano.lock` beside your entry file.
  The first run mints and freezes a guid for every object and a canonical for
  the Authentication group; every later run reuses them. Repeated imports are
  idempotent (same lock, same identities, updated in place, never duplicated) and
  your API URL stays stable. Commit `xano.lock`.
- **Without a lock (`--no-lock`):** each object's guid derives deterministically
  from its name (`md5("<kind>:<name>")`), and the engine assigns the group a
  random canonical at import time. Fine for a one-shot import; use the lock if
  you re-import.

References resolve through the same derivation, so the queries bind to the tables
and function correctly either way, with no manual guid wiring.

## Cherry-picking individual defs

Instead of the one-call install, you can register defs individually. Each def is
a named export: `userTable`, `accountTable`, `eventLogTable`,
`createEventLogFn`, `authenticationGroup`, `signupQuery`, `loginQuery`,
`meQuery`. Register the ones you want and keep their dependencies together: the
queries need `userTable`, and `createEventLogFn` needs `eventLogTable`.

Never register a def twice, and call `registerAuth` at most once per instance;
a second call throws.

## Security defaults

This is a close port of Xano's quick-start template, but fidelity stops where a
template default would leak a credential. Two defaults are overridden:

### Request history is off

Xano's request history defaults **on** for query endpoints and records the
request body. Under that default, `auth/signup` and `auth/login` would store the
caller's plaintext password next to the token they just minted. Tokens live 24
hours with no revocation, so anyone who can read the history would hold working
credentials, not just a record of them.

`registerAuth` sets the Authentication group's history to `false`, and the three
queries inherit it. To turn it back on for local debugging:

```ts
registerAuth(workspace("my-app"), { history: true });   // engine default depth
registerAuth(workspace("my-app"), { history: 25 });     // capture depth 25
registerAuth(workspace("my-app"), { history: "all" });  // unlimited depth
```

The depth caps how many statement executions a single history record's stack
trace keeps; it is not a retention limit. Like `canonical`, the setting lands on
a process-wide singleton, so every `registerAuth` in one process must agree, and
a call that would change it throws.

### `event_log.metadata` records a redacted user

The template logged the whole fetched user record. On `auth/login` that record
deliberately includes the `internal` password hash (`check_password` needs it),
so every login copied a hash into a table with none of `user`'s access controls.
This package logs the `PUBLIC_USER_FIELDS` projection instead, the same list
`auth/me` returns, so it tracks that reviewed array rather than a hand-written
literal. Everything else about `event_log` still applies: treat it as user data.

## Behavior notes

Read these before going to production. The template's other quirks are kept on
purpose, since changing them would fork its behavior:

- **Every endpoint writes an event-log row**, including the `auth/me` GET. The
  table grows without bound; there is no pruning or retention. You own its
  lifecycle.
- **Signup's event-log row records `account_id: 0`**, a hardcoded literal in the
  source rather than a real account reference (a fresh user has no account yet).
  Login and `me` log the user's actual `account_id`, so filtering `event_log` by
  account silently omits every signup.
- **The group description advertises password reset.** The Authentication
  group's description, visible in your workspace, mentions "reset password".
  That is the template's text; no such endpoint exists here.
- **A deleted user with a valid token** does not get a user back from `auth/me`;
  the source has no null-user guard. The response type is `PublicUser | null`, so
  null-check downstream. At runtime the most likely outcome is an HTTP 500 rather
  than a 200 with a null body: the `db.get` binds null and the next statement
  reads `user.id` from it, which the SDK documents as a runtime "Unable to locate
  var" error. Unverified against a live instance.
- **Tokens live 24 hours with no refresh or revocation.** A user can hold several
  valid tokens at once, and changing the password does not invalidate existing
  ones.
- **Signup reveals whether an account exists** ("already in use"), a deliberate
  template behavior. Login failures are indistinguishable.
- **Your own auth table can coexist.** `auth/me` names this package's `user`
  table explicitly, so registering another `auth: true` table is fine; it just
  isn't what these endpoints authenticate against.
- **Quick-start naming is visible.** Objects keep their source names and
  `xano:quick-start` tags, so you'll see "Getting Started Template/
  create_event_log" in your workspace even if you never installed the template.
  Rename them in your own fork if that's confusing. Guids are not pinned, so a
  rename only changes the name-derived identity (pin it in your lock first if
  you've already imported).
- **Your API URL depends on the lock** unless you pin it. The Authentication
  group's canonical (the `/api:<canonical>/` path segment) is minted by your
  `xano.lock`, or randomized by the engine if you import without one. Commit the
  lock to keep the URL stable across re-imports, or pass
  `registerAuth(xano, { canonical })` to set the segment yourself.

## Versioning and compatibility

The exported bundle is covered by a byte-exact golden test. If an SDK release
changes what these defs encode to, this package's test suite fails before the
change can reach you.

Two SDK versions matter:

- **The tested version, 1.0.0**, is the `devDependencies` pin: the version the
  committed golden fixture was generated against, and the only one the suite ever
  encodes against. It moves with `@xano-sdk/auth` releases, and only to a version
  this package has been rebuilt and retested against.
- **The peer range, `>=1.0.0 <2.0.0`**, is what you can install against. The rest
  of the range is supported by declaration rather than verified in CI, because
  the golden test only exercises the installed version. The fixture matches every
  SDK from the floor up, and any failure inside the range is real drift.

The **floor** is the oldest SDK this package still behaves the same on. It is the
highest of:

- **The golden bundle**, which matches from the floor up.
- **The documented role guard**: the `guard.role` example under
  [Adding role checks](#adding-role-checks) needs it.
- **A load-bearing type**: `auth/me`'s response is derived from its stack, which
  needs the SDK's miss-to-null handling for `db.get`. Without it,
  `InferResponse<typeof meQuery>` silently loses its `| null`.

Versions below the floor are unsupported. The floor moves only when one of those
three does.

The **ceiling** is the SDK's next **major**. A major may change what the defs
encode to, so this package makes no claim about `2.0.0` or later. Moving either
end is a deliberate step: bump the tested version, confirm the golden bundle,
then widen.

## Issues

Report bugs and request features in
[GitHub issues](https://github.com/xano-sdk/auth/issues).

## License

[MIT](LICENSE)
