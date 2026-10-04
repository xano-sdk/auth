/**
 * POST `auth/login` — verify credentials and mint a 24h auth token. Ported 1:1
 * from the quick-start template, with one deliberate deviation. The `db.get`
 * output list explicitly includes `password` — the column's `internal` access
 * would otherwise hide the hash and silently break `check_password`. That hash
 * stays inside the stack: DEVIATION (issue #10) — the source passed the whole
 * `user` var to `event_log.metadata`, persisting the hash on every login; this
 * logs a redacted projection instead (see `api/user-metadata.ts`). Both failure
 * branches return an
 * identical `accessdenied` "Invalid Credentials." so callers can't distinguish
 * unknown-email from wrong-password (deliberate source behavior).
 *
 * `password` is an `input.text()`, NOT `input.password()` — do not "tighten" it.
 * The `f.password` column hashes on write and `input.password` would hash the
 * submission again on bind, so `check_password` would compare two different
 * hashes and every correct password would fail. The statement does the
 * comparison hash itself; it needs the plaintext. (The SDK's own Gotchas document
 * this trap.)
 */
import { query, input, s, expr, ref, inp, c } from "@xano/sdk";
import { userTable } from "../tables/user.js";
import { createEventLogFn } from "../functions/create-event-log.js";
import { authenticationGroup } from "./authentication-group.js";
import { redactedUserMetadata } from "./user-metadata.js";
import type { AuthTokenResponse } from "./types.js";

export const loginQuery = query({
  name: "auth/login",
  verb: "POST",
  apiGroup: authenticationGroup,
  description: "Login and retrieve an authentication token",
  tags: ["xano:quick-start"],
  input: {
    email: input.email({ methods: ["trim", "lower"] }),
    password: input.text(),
  },
  stack: [
    // Get the user record via email (output pulls the internal password hash)
    s.db.get({
      table: userTable,
      fieldName: "email",
      fieldValue: inp("email"),
      output: ["id", "created_at", "name", "email", "password", "account_id", "role"],
      as: "user",
    }),
    // Check to make sure a user with that email exists
    s.precondition({
      expr: expr(ref("user"), "!=", c.null()),
      error_type: "accessdenied",
      error: c.text("Invalid Credentials."),
    }),
    // Check that the password matches the hashed password
    s.security.check_password({
      text_password: inp("password"),
      hash_password: ref("user.password"),
      as: "pass_result",
    }),
    // Verify that the password check passed (source: bare-truthy precondition;
    // authored as an explicit `= true` comparison — semantically equivalent)
    s.precondition({
      expr: expr(ref("pass_result"), "=", c.bool(true)),
      error_type: "accessdenied",
      error: c.text("Invalid Credentials."),
    }),
    // Create an authentication token (24h)
    s.security.create_auth_token({
      table: userTable,
      id: ref("user.id"),
      extras: c.obj({}),
      expiration: c.int(86400),
      as: "authToken",
    }),
    // Create an event log for login
    s.function.run({
      fn: createEventLogFn,
      as: "event_log",
      input: {
        user_id: ref("user.id"),
        account_id: ref("user.account_id"),
        action: c.text("login"),
        // Redacted — the password hash never reaches `event_log` (issue #10).
        metadata: redactedUserMetadata(),
      },
    }),
  ],
  response: { authToken: ref("authToken"), user_id: ref("user.id") },
  // `authToken` is minted by a statement, so the static walk resolves both
  // values to `unknown`; declare the shape once for consumers.
  responseShape: {} as AuthTokenResponse,
});
