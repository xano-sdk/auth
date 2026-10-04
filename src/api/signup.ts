/**
 * POST `auth/signup` — create a user and mint a 24h auth token. Ported 1:1
 * from the quick-start template, with one deliberate deviation. Stack order is
 * behavior: the duplicate-email precondition fires before `db.add`, so a
 * duplicate email wins over a password-policy violation.
 *
 * DEVIATION (issue #10): the source logs the whole `user` record — password
 * hash included — into `event_log.metadata`. This ships a redacted projection
 * instead; see `api/user-metadata.ts`.
 *
 * `password` is an `input.text()` here for the same reason as in `auth/login`:
 * the `f.password` column hashes on write, so hashing again at the input would
 * store a hash-of-a-hash that `check_password` could never match. See the note
 * in `api/login.ts`.
 */
import { query, input, s, expr, ref, inp, c } from "@xano/sdk";
import { userTable } from "../tables/user.js";
import { createEventLogFn } from "../functions/create-event-log.js";
import { authenticationGroup } from "./authentication-group.js";
import { redactedUserMetadata } from "./user-metadata.js";
import type { AuthTokenResponse } from "./types.js";

export const signupQuery = query({
  name: "auth/signup",
  verb: "POST",
  apiGroup: authenticationGroup,
  description: "Signup and retrieve an authentication token",
  tags: ["xano:quick-start"],
  input: {
    name: input.text(),
    email: input.email({ methods: ["trim", "lower"] }),
    password: input.text(),
  },
  stack: [
    // Check if a user record with that email exists
    s.db.get({ table: userTable, fieldName: "email", fieldValue: inp("email"), as: "user" }),
    // Verify that the email being used to sign up is unique
    s.precondition({
      expr: expr(ref("user"), "=", c.null()),
      error_type: "accessdenied",
      error: c.text("This account is already in use."),
    }),
    // Create a new user record
    s.db.add({
      table: userTable,
      as: "user",
      data: [
        { name: "created_at", value: c.text("now") },
        { name: "name", value: inp("name") },
        { name: "email", value: inp("email") },
        { name: "password", value: inp("password") },
        { name: "role", value: c.text("member") },
      ],
    }),
    // Create an authentication token (24h)
    s.security.create_auth_token({
      table: userTable,
      id: ref("user.id"),
      extras: c.obj({}),
      expiration: c.int(86400),
      as: "authToken",
    }),
    // Create an event log for signup
    s.function.run({
      fn: createEventLogFn,
      as: "event_log",
      input: {
        user_id: ref("user.id"),
        account_id: c.int(0),
        action: c.text("signup"),
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
