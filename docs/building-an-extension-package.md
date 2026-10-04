# Building a Xano SDK extension package

How to build an npm package that ships reusable Xano workspace objects (tables,
functions, API groups, queries) as typed [Xano SDK](https://www.npmjs.com/package/@xano/sdk)
defs. `@xano-sdk/auth` is the reference implementation. This guide is for the
author of the next one.

The SDK calls this kind of package a **workspace module**. Its manifest format
and the marketplace commands that install it are specified in the SDK's
`guides/module-contract.md` and `guides/marketplace.md`; this guide covers the
package itself. [AGENTS.md](../AGENTS.md) has the full rule set this repo holds
itself to.

> **Provisional.** These conventions come from one package. Sections marked
> **[reusable]** should generalize. Sections marked **[port-specific]** are
> choices `@xano-sdk/auth` made because it recreates an existing Xano template, so
> re-derive them for your package instead of copying them.

## The model [reusable]

An extension package exports **plain def objects**. The Xano SDK factories
(`table()`, `query()`, `defineFunction()`, `apiGroup()`) have no side effects,
so defs cross package boundaries as ordinary values. The *consumer's* workspace
does all registration and encoding:

```
your-package                        consumer project
  src/tables/*.ts     ──exports──►  xano/index.ts: registerX(workspace(...))
  src/functions/*.ts                        │
  src/api/*.ts                              ▼
  src/register.ts                   xanosdk deploy / xanosdk export
```

Two consequences drive the rest:

1. **Encoding happens in the consumer's copy of the SDK**, so `@xano/sdk` must
   be a `peerDependency` (one shared copy), never a dependency.
2. **Cross-object references resolve when your module is evaluated**, so they
   are correct in any consumer workspace without manual wiring.

## Project structure [reusable]

```
src/
├── index.ts          # named export per def + the install helper
├── register.ts       # registerX(xano): one-call install, idempotency-guarded
├── tables/*.ts       # one def per module
├── functions/*.ts
└── api/*.ts          # api group + one module per query
test/
├── *.test.ts         # encode-level fidelity assertions
├── bundle.test.ts    # golden-bundle byte-stability contract
└── fixtures/golden-bundle.json
```

Export **both** granular named defs (cherry-picking, extension) and a one-call
`registerX(xano)` helper. The helper must **mutate** the instance it receives
and return it, because the marketplace writes `registerX(app);` as a bare
statement. Guard it against a second call on the same instance
(`@xano-sdk/auth` keeps a `WeakSet` of installed instances and throws), since
registering the same defs twice duplicates them.

## The marketplace manifest [reusable]

Declare a `"xanosdk"` block in `package.json` so `xanosdk init --marketplace` can
write your registration into a new project's `xano/index.ts`:

```json
"xanosdk": {
  "register": "registerAuth",
  "returns": "workspace",
  "options": { "canonical": { "value": "authn" } }
}
```

`options` states the **whole** second argument of the generated call. Declare
`{}` for a bare call. Leave the key out only when your helper needs an option
only the user can answer: the CLI then measures the helper's arity, sees the
undeclared parameter, and leaves the call commented out with a pointer to
`xanosdk marketplace details <pkg> --prompt`. Also declare a `homepage`: it is
where the CLI sends a user when it cannot wire your package.

## References between objects [reusable]

- Always pass **def handles**, not bare names: `s.db.get({ table: userTable })`,
  `f.tableRef(accountTable)`, `apiGroup: authenticationGroup`,
  `fn: createEventLogFn`. Only self-references use the bare-name form.
- A query's `auth` takes a **table def**, not `true`. Name your own auth table
  there, and a consumer can register another auth table beside yours without
  changing what your endpoints authenticate against.
- Import order follows the reference graph: a def must exist before a handle to
  it resolves.
- `src/` imports only `@xano/sdk`'s public root entry, never
  `@xano/sdk/internal`. The encoder primitives your tests need live there, and
  an internal import in `src/` typechecks and passes the golden test, then breaks
  at a consumer's install.

## Identity: leave it to the consumer's lock [reusable rule]

Identity resolves in this order: an explicit in-code `guid`, then the consumer's
`xano.lock`, then a name-derived hash (`md5("<kind>:<name>")`; a query's seed is
`query:<apiGroup>|<verb>|<name>`).

**Pin nothing by default.** Ship defs with no `guid` and no `canonical`, and let
the consuming project's `xano.lock` mint and freeze them. `xanosdk export` and
`xanosdk deploy` update that lock by default. The lock belongs to the project,
not the package, so identities and API URLs stay stable per project and don't
collide when many workspaces use the same package.

**When to pin a guid instead [port-specific]:** only when the package must adopt
an object that already exists in a target workspace, such as upgrading Xano's
quick-start objects in place. Same guid means the import updates; a different
guid means it creates. Pinning couples the package to those guids and overwrites
hand edits on import, so treat it as a deliberate adoption choice.
`@xano-sdk/auth` originally pinned the quick-start guids, then dropped them.

A canonical (the `/api:<canonical>/` URL segment) must be unique per Xano
instance. Let the consumer pin one through your helper's options, as
`registerAuth(xano, { canonical })` does, rather than baking one into the def.

## Testing [reusable]

Both levels assert on **compiled output**; there is no runtime to exercise.

1. **Encode-level fidelity tests.** Per def, assert the load-bearing fields:
   guids, auth bindings, filters, index shapes, statement order, error
   contracts, output column lists, response shapes. See `test/tables.test.ts`
   and `test/queries.test.ts`.
2. **Golden-bundle test.** Register everything on a fresh workspace, `export()`,
   and deep-equal the raw result (signature included) against a committed
   fixture, with **no normalizer**: stripping keys would blind the test to the
   identity fields it exists to protect. Regenerating the fixture is an
   explicit, reviewed act.

The golden test is also the **peer-drift tripwire**: when an SDK release changes
encoding, it fails here before consumers are affected.

## Packaging and publishing [reusable]

- ESM-only (`"type": "module"`), `tsup` build (ESM + `.d.ts`), and a `files`
  list that ships `dist`, `README.md`, `AGENTS.md`, and `llms.txt`. Pin that list
  in a test, as `test/published-docs.test.ts` does.
- `@xano/sdk` goes in **both** `peerDependencies` (a range) and
  `devDependencies` (an **exact** pin: the version the golden fixture was
  generated against).
- Write the peer range with a floor and a ceiling at the SDK's next **major**:
  `>=1.0.0 <2.0.0`. A major may change what your defs encode to. Move the floor
  when a newer SDK type becomes load-bearing or the SDK changes what your defs
  encode to; move the ceiling only after testing against the new major.
- Bump the dev pin, regenerate and review the golden fixture, then publish.
- Keep the README install command version-free (`npm install @xano/sdk`), so
  consumers get the current release the peer range allows.

## Things that will bite you

- **`db.get` output vs column visibility.** An explicit `output` list overrides
  `internal`/`private` access. That is how login reads the password hash, and
  also how you accidentally leak one.
- **Module-level defs are shared singletons** across every consumer workspace in
  the process. Treat them as immutable, and make any process-wide setting your
  helper writes (like a canonical) refuse to change once set.
- **Importing a def into a browser pulls in the SDK runtime.** Point frontend
  users at `xanosdk routes <entry> --emit <file>` for paths, and keep your defs
  for `import type`.
