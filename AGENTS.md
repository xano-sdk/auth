# AGENTS.md

Instructions for coding agents (and humans) working **on** this repository.
For agents *consuming* the published package, see [llms.txt](llms.txt) instead.

## What this is

`@xano-sdk/auth` ships Xano's quick-start authentication as typed
[Xano SDK](https://www.npmjs.com/package/@xano/sdk) defs. It exports plain def
objects; there is **no runtime** — the consumer's `Xano` instance registers and
encodes them. Everything is verified at the compiled-output level.

Its scope is authentication only — signup, login, and token verification. It is
**not** authorization: no permission checks, no route guards, not RBAC. Keep that
boundary when adding to it, and keep the negative stated in `README.md` and
`llms.txt` (xanots/sdk#242).

## Project policy

- **Clean over backwards-compatible.** Nobody consumes this package yet, so when
  a cleaner shape and a compatible one conflict, take the clean one and say so in
  the release notes. Revisit once there are real consumers.
- **Versions start at 1.0.0 under `@xano-sdk/auth` and only increment 1.0.x for
  now**, regardless of what a release changes. Do not bump unless told. See
  **Release** below.

## Commands

```bash
npm run build       # tsup → dist/ (esm + d.ts)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # tsc --noEmit && vitest run (type-level tests need the typecheck)
```

Run `npm run typecheck && npm run lint && npm test` before committing.

## Layout

- `src/tables/*.ts`, `src/functions/*.ts`, `src/api/*.ts` — one def per module.
- `src/register.ts` — `registerAuth(xano, opts?)`, the one-call install (idempotency-guarded).
- `src/index.ts` — named export per def, plus `registerAuth`.
- `test/*.test.ts` — encode-level fidelity assertions.
- `test/bundle.test.ts` + `test/fixtures/golden-bundle.json` — byte-exact bundle contract.
- `test/published-docs.test.ts` — the tarball contract: what `files` ships, and
  that every relative link in a shipped doc resolves inside it.
- `scripts/regen-golden.ts` — regenerates that fixture (`npm run fixture:regen`).
  Typechecked and linted alongside `src` and `test`; not published.
- `docs/building-an-extension-package.md` — the pattern this package sets, written
  for the author of the next extension package. Not published. The rest of
  `docs/` is gitignored working notes.

## Rules that bite

- **Faithful port, with security as the one exception.** The defs recreate
  Xano's quick-start template. Do not "fix" a quirk without a stated reason —
  the port's fidelity is the point, and every documented deviation is called out
  in the deviating module's header comment. The exception is a template default
  that leaks a credential: fidelity does not extend to shipping one. Two are
  overridden today, both from
  [xanots/sdk#10](https://github.com/xanots/sdk/issues/10) — request history
  defaults `false` on `authenticationGroup` (it captures the request body, i.e.
  the plaintext password and the minted token), and `event_log.metadata` records
  the `PUBLIC_USER_FIELDS` projection rather than the whole user row (which on
  `auth/login` carries the password hash). A future deviation on those grounds
  needs the same treatment: the header comment, an assertion that names the
  hazard rather than the bytes, and a note here.
- **References use def handles, never bare names** — `s.db.get({ table: userTable })`,
  `f.tableRef(accountTable)`, `apiGroup: authenticationGroup`. Only self-references
  use the bare-name form.
- **Pin no guids, and no canonical by default.** Identity belongs to the consumer's
  `xano.lock` (fallback: `md5("<kind>:<name>")`). Never hard-code a `guid` or a
  `canonical` in a def. The one exception is the opt-in
  `registerAuth(xano, { canonical })`, which the *consumer* supplies so a browser
  can resolve `getPath()` without a lock — the package itself still pins nothing.
- **`@xano/sdk` is a `peerDependency` with a range**; `devDependencies`
  carries the version actually tested. Never make it a regular dependency — one
  shared copy only. The golden-bundle test only exercises the *installed*
  version, so every other SDK in the range is declared-compatible but unverified.
  Keep the README's and llms.txt's install notes pointing at both numbers, and at
  the full range — a manifest the docs describe differently is a release bug.
  **The dev pin is exact — no caret.** It is the single version the golden
  fixture was generated against and the number the README and llms.txt claim as
  tested, so a range there would let a fresh install silently drift onto an
  untested SDK and turn a documented claim false. It also keeps a genuine
  encoding change in a later SDK arriving as a deliberate bump in this repo
  rather than as a golden-test failure traceable to no commit. Only the *peer*
  range spans versions.
  **The two numbers are allowed to differ, and usually should.** The dev pin is
  "what CI proved this release against" and moves on every SDK bump. The peer
  floor is "the oldest SDK this package still means the same thing on" —
  currently 1.0.0. Three things can set it: a load-bearing *type* (`db.get`'s
  miss-to-null in `InferResponse`); an *encoding* boundary (the golden fixture
  starts matching there); and an SDK API the *shipped docs* tell consumers to use
  (`guard.role`, in the README's and llms.txt's role-check guidance). The highest
  wins, and the floor moves when any does. Keeping it at the fixture boundary
  means the golden test holds across the whole declared range. Too low a floor
  hands consumers silently weaker types, different object identities, or
  documented code that does not compile, instead of an install error; needlessly
  raising it forces an upgrade that buys them nothing. Deciding requires reading
  the SDK diff, not just watching the suite go green: a patch release that
  changes nothing this package touches moves the dev pin alone.
  **The ceiling is the SDK's next major** — the range is `>=1.0.0 <2.0.0`. A
  major is where the SDK may change what the defs encode to, so this package
  claims nothing past it. Without the cap, npm resolves a new major against this
  package and the golden test — which only ever runs against the *installed*
  version — never sees it. Raise the ceiling deliberately when an SDK major
  lands: bump the dev pin, confirm the bundle, then widen. Never widen it to buy
  release velocity; that is the one thing the cap exists to refuse.
- **The `"xanosdk"` block in `package.json` is the marketplace manifest.** It is
  how `xanosdk init --marketplace @xano-sdk/auth` writes the registration into a new
  project's `xano/index.ts`, and what `xanosdk marketplace details` shows (see the
  SDK's `guides/module-contract.md`). Without an `options` key the CLI measures
  `registerAuth`'s arity instead, sees an undeclared second parameter, and leaves
  the module unregistered. `register` names `registerAuth`; `returns` is
  `"workspace"` because `registerAuth` mutates and returns the instance it is
  handed; `options` is the *whole* second argument the generated call passes —
  today `{ canonical: "authn" }`, matching the SDK's own marketplace examples.
  That pin is written into the consumer's file, where they own it; the package's
  defs still pin nothing. Change `registerAuth`'s options and this block moves
  with them in the same commit.
- **`src/` imports only the SDK's public root entry — never `@xano/sdk/internal`.**
  The encoder and lock primitives the tests reach for — `encodeTable`,
  `encodeFunction`, `encodeQuery`, `encodeApiGroup`, `deriveGuid`, `emptyLock`,
  `lockKey` — live behind that subpath, and test-only imports of them belong
  there. An internal import in `src/` means a def is reaching past the surface
  consumers actually get, and nothing else would catch it: it typechecks, lints,
  builds, and passes the golden test, then breaks at a consumer's install.
  `test/public-surface.test.ts` pins the rule.
- **Prefer derivation over `responseShape`.** Declare a shape only where the SDK's
  static walk genuinely can't see the value (a minted token, a filtered result).
  `auth/me` deliberately declares nothing: derivation reads its `output` list, so
  the consumer type and the selected columns cannot drift. A declaration wins over
  derivation and is never cross-checked, so each one is a hand-maintained contract
  — add one only with a stated reason, and pin what *can* be checked in
  `test/types.test.ts` (see how the signup/login key assertions strip the
  declaration with `Omit<…, "responseShape">`).
- **`s.db.add`/`edit` use the `data: [{ name, value }]` array, not the newer
  `row: {}` map.** They are not interchangeable at the byte level: `row` emits the
  engine's full-column form (every column present, unset ones `ignore: true`, plus
  a leading null `id`), which the ported template does not. `row` is the better
  default in new code; here the `data` form is what keeps the bundle byte-faithful.
  Don't "modernize" it.
  **Nor narrow them with `output`.** The SDK supports `output` on `s.db.add`/`edit`,
  which restricts the columns the statement binds. It is genuinely tempting on
  `auth/signup`, whose `db.add` binds the full written row — password hash included —
  and hands it to `event_log.metadata`. That quirk is the *source template's*, called
  out in `api/signup.ts` and `tables/event-log.ts` and reproduced on purpose; narrowing
  it would change what a consumer's audit rows contain. Declined deliberately, not
  overlooked.
- **Values stay explicit `c.*`, never bare literals.** The SDK coerces raw
  literals inside a call/agent `input` map (`input: { action: "login" }` in place of
  `c.text("login")`) and auto-wraps a nested plain object in a record response.
  Verified byte-identical, so it buys nothing here and costs the engine tag at the
  call site — which is load-bearing where a constant is a magic string the engine
  interprets (`c.text("now")` for `created_at`). Keep every value tagged.

## The golden-bundle contract

`test/bundle.test.ts` registers everything on a fresh `Xano`, calls `export()`,
and deep-equals the result against `test/fixtures/golden-bundle.json` (raw, no
normalizer). This is the peer-drift tripwire: a `@xano/sdk` bump that changes
encoding fails here first.

Regenerating the fixture is a deliberate, reviewed act — never do it just to make
a red test pass. A failure means the encoded bundle moved; find out *why* first.
If a change legitimately alters the bundle:

```bash
npm run fixture:regen && git diff test/fixtures/golden-bundle.json
```

then review that diff line by line (watch guids, auth flags, stack order, output
lists) before committing. `scripts/regen-golden.ts` must stay byte-compatible
with how `test/bundle.test.ts` builds the bundle — same workspace name, same
`registerAuth`, same 2-space JSON + trailing newline.

## Release

Lockstep with the peer. For each SDK bump:

1. Read the SDK diff (its `CHANGELOG.md`, then `llms.txt` and `README.md` between
   the two versions) before
   touching anything — the suite going green proves no encoding drift, not that the
   package still follows current guidance.
2. Move the `devDependencies` pin to the new version. Move the `peerDependencies`
   floor **only** if a new SDK type became load-bearing here or the SDK changed
   what the defs encode to — step 3 establishes that second one — and the ceiling
   **only** when the SDK minor you just tested against sits at or above it (see
   the peer rule above). An SDK minor that lands without the ceiling moving is
   an SDK consumers cannot install this package with — intended, until step 3
   proves it encodes the same.
3. Run `npm run typecheck && npm run lint && npm test`. Regenerate the golden
   fixture (`npm run fixture:regen`) only if the bundle legitimately changed, and
   review that diff line by line — most patch bumps change nothing, and an
   unchanged fixture is the expected outcome, not a reason to look harder.
   When moving the floor, verify it rather than asserting it: install the floor
   version and confirm `npx tsc --noEmit` passes against it, plus the suite —
   **including `test/bundle.test.ts`** whenever the floor is moving for an
   encoding reason, because the golden bundle is the only check that sees
   payload shape and field-level encoding, and it is the boundary this file,
   `README.md`, and `llms.txt` all quote. Confirm the version below the
   candidate floor fails, or the number is a guess. The golden test tracks the
   *encoding*, not the version, so it passes on every SDK that encodes
   identically — **currently `>=1.0.0`**, the peer floor itself. Below the floor
   is unsupported and out of scope. That boundary is a fact about the *fixture*,
   so re-establish it whenever you regenerate rather than copying the number
   forward. Treat a failure anywhere else as real drift and find out why; never
   wave one off as "wrong version".
4. Update the install notes in `README.md` **and** `llms.txt` with the full peer
   range **and** the tested version — both files spell the range out in prose, so
   a changed ceiling is a text edit in each, not just a manifest edit.
5. Ship it. While the 1.0.x policy (see **Project policy**) stands, every
   release is a patch regardless of what changed — including an SDK bump, which
   would otherwise be a **minor** here because the peer contract a consumer
   installs against changes even when no export does. Revisit when that policy
   lifts.

   ```bash
   npm run release:beta    # prerelease: bumps, tags, publishes under `beta`
   ```

   `release:beta` does the whole dance itself (`npm version prerelease` bumps and
   commits the tag, then publishes). **The stable path does not** — `npm run
   release` only publishes, so the version bump and the git tag are yours:

   ```bash
   npm version patch -m "chore(release): %s"   # bumps package.json + tags vX.Y.Z
   npm run release                             # prepublishOnly rebuilds dist/
   git push --follow-tags
   ```

   Publish from a green tree on the default branch, after the PR merges — not
   from the feature branch. `npm pack --dry-run` should show exactly 7 files
   (`dist/` ×2 — no source map, `README.md`, `AGENTS.md`, `llms.txt`, `LICENSE`,
   `package.json`); anything else means `files` drifted. `test/published-docs.test.ts`
   pins that list and checks every relative link inside the shipped docs resolves
   to something in the tarball.

### Release notes

Start from [.github/RELEASE_TEMPLATE.md](https://github.com/xanots/auth/blob/main/.github/RELEASE_TEMPLATE.md) — it
carries both the shape and the constraints the Slack announcement imposes, and
its guidance lives in HTML comments that are stripped before Slack sees them, so
it can stay in the draft while you write.

- The GitHub release **name** (not the tag) becomes the Slack header verbatim:
  `vX.Y.Z — Three-to-five word theme`, standing on its own.
- Everything before the first `##` is the summary block. No story — a brief
  paragraph and the install snippet.
- Cover every noteworthy change since the previous release, not only the
  headline one. Anything a consumer needs to act on goes in too.
- **Each change gets its own `##` heading**, because those headings become the
  itemized Slack bullets (first 8 shown, rest collapse). Write each as a claim
  that survives with no body text under it. Purely structural headings (Notes,
  Compatibility, Verification, …) are dropped from the bullets, so use them
  freely — just never hide a change under one.

Publishing a GitHub release fires `.github/workflows/release-slack.yml`, which
runs `.github/scripts/test_slack_release_message.py` in the same job that posts —
a malformed payload fails the workflow rather than reaching Slack. That suite
renders `RELEASE_TEMPLATE.md` through the real builder, so a change to either
file has to keep the other true. Both the builder and that test are kept
identical to `xanots/sdk`'s, modulo the repo and package names; port fixes
between the two rather than letting them diverge. Check a draft locally first:

```bash
cd .github/scripts && python3 test_slack_release_message.py
```
