/**
 * Type-level contract for the consumer-facing surface. These assertions are
 * compile-time only — `expectTypeOf` erases at runtime, so a failure here is a
 * `vitest`/`tsc` type error, not a failed expectation. They exist because the
 * inferred response types are a published API: an SDK upgrade that changes the
 * static response walk, or an edit to a `db.get` `output` list, should break
 * here rather than silently degrade a consumer's types to `unknown`.
 *
 * For that to hold, assertions about a declared `responseShape` must compare
 * against `InferResponse<Omit<typeof q, "responseShape">>` — the derived result.
 * Comparing `InferResponse<typeof q>` to the declaration, or `PublicUser` to its
 * own `Pick<>`, restates a definition against itself and can never fail.
 * `auth/me` declares no shape, so it needs no such stripping — its assertions
 * read derivation directly.
 */
import { describe, it, expectTypeOf } from "vitest";
import type { InferInput, InferResponse, InferRow } from "@xano/sdk";
import {
  signupQuery,
  loginQuery,
  meQuery,
  userTable,
  type User,
  type PublicUser,
  type Account,
  type EventLog,
  type AuthTokenResponse,
} from "../src/index.js";

describe("row types", () => {
  it("User is the full row, including the internal password hash", () => {
    expectTypeOf<User>().toEqualTypeOf<InferRow<typeof userTable>>();
    expectTypeOf<User>().toHaveProperty("password");
    expectTypeOf<User["id"]>().toEqualTypeOf<number>();
    expectTypeOf<User["role"]>().toEqualTypeOf<"admin" | "member">();
  });

  it("PublicUser is exactly what auth/me's stack projects", () => {
    // The load-bearing assertion: compare against the response the static walk
    // derives from `me`'s `output` array. `meQuery` declares no `responseShape`,
    // so this reads derivation with nothing to strip. Dropping a column from
    // `api/me.ts` fails here. (Asserting against `Pick<User, "id" | ...>` would
    // be a verbatim restatement of PublicUser's definition — a tautology that
    // passes no matter how far the type has drifted from the query.)
    expectTypeOf<NonNullable<InferResponse<typeof meQuery>>>().toEqualTypeOf<PublicUser>();
    expectTypeOf<PublicUser>().not.toHaveProperty("password");
    expectTypeOf<PublicUser>().not.toHaveProperty("password_reset");
  });

  it("exposes the remaining table rows", () => {
    expectTypeOf<Account>().toHaveProperty("name");
    expectTypeOf<EventLog>().toHaveProperty("action");
    expectTypeOf<EventLog>().toHaveProperty("metadata");
  });
});

describe("response types", () => {
  it("signup and login resolve to the declared token shape, not unknown", () => {
    expectTypeOf<InferResponse<typeof signupQuery>>().toEqualTypeOf<AuthTokenResponse>();
    expectTypeOf<InferResponse<typeof loginQuery>>().toEqualTypeOf<AuthTokenResponse>();
    expectTypeOf<AuthTokenResponse["authToken"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthTokenResponse["user_id"]>().toEqualTypeOf<User["id"]>();
  });

  it("the declared token keys match the keys the stack actually returns", () => {
    // A declared `responseShape` overrides derivation and is never cross-checked
    // against the stack, so the assertions above only prove the override works.
    // The walk *can* see the response object's keys (it just types the values as
    // `unknown`), so pin the declaration to those — renaming `authToken` in the
    // query without updating AuthTokenResponse fails here. Value types stay the
    // declaration's job; a minted token isn't readable off a table.
    expectTypeOf<
      keyof InferResponse<Omit<typeof loginQuery, "responseShape">>
    >().toEqualTypeOf<keyof AuthTokenResponse>();
    expectTypeOf<
      keyof InferResponse<Omit<typeof signupQuery, "responseShape">>
    >().toEqualTypeOf<keyof AuthTokenResponse>();
  });

  it("me is nullable — a valid token whose user row is gone yields no user", () => {
    // Derived, not declared: the SDK carries `db.get`'s miss-to-null through the
    // static walk, so the `| null` a caller must handle comes straight from the
    // stack. An SDK regression that drops it (or an `output` edit) fails here.
    expectTypeOf<InferResponse<typeof meQuery>>().toEqualTypeOf<PublicUser | null>();
    expectTypeOf<InferResponse<typeof meQuery>>().not.toEqualTypeOf<PublicUser>();
  });
});

describe("input types", () => {
  it("derives the request payloads from each query's input map", () => {
    // Faithful to the port: none of the auth inputs are `required`, so every
    // key is optional. Tightening this would fork the template's behavior.
    expectTypeOf<InferInput<typeof loginQuery>>().toEqualTypeOf<{
      email?: string;
      password?: string;
    }>();
    expectTypeOf<InferInput<typeof signupQuery>>().toEqualTypeOf<{
      name?: string;
      email?: string;
      password?: string;
    }>();
  });

  it("me takes no inputs", () => {
    // `InferInput` of an empty input map is the empty object type; assert on
    // its keys rather than the type itself (`{}` trips no-empty-object-type).
    expectTypeOf<keyof InferInput<typeof meQuery>>().toEqualTypeOf<never>();
  });
});
