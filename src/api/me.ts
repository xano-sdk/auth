/**
 * GET `auth/me` — return the authenticated user's record. Ported 1:1 from the
 * quick-start template. Faithful-port quirks: the output list excludes
 * `password`; there is deliberately NO null-user precondition, so a valid token
 * whose user row was deleted is left to fall through the stack; and even this
 * read endpoint writes an `event_log` row.
 *
 * The deleted-user path most likely errors rather than returning a null body.
 * `db.get` binds null on a miss, and the next statement drills `ref("user.id")`
 * into it — the SDK documents a dotted ref through a null base as a runtime
 * "Unable to locate var" (HTTP 500), not a null. Even past that,
 * `createEventLogFn`'s `user_id`/`account_id` inputs are `required: true`.
 * Still UNVERIFIED against a live instance, and it does not change the type:
 * the response stays `PublicUser | null`, so a caller cannot assume a row came
 * back. Do not "fix" the missing precondition (nor reach for
 * `ref(..., { safe: true })`) without a stated reason — the port's fidelity is
 * the point.
 *
 * `auth` names the ported `user` table by def handle (the SDK takes the auth
 * table itself, not `true`), so it resolves to that table's guid no matter
 * how many other auth tables the consumer registers.
 */
import { query, s, ref, auth, c } from "@xano/sdk";
import { userTable, PUBLIC_USER_FIELDS } from "../tables/user.js";
import { createEventLogFn } from "../functions/create-event-log.js";
import { authenticationGroup } from "./authentication-group.js";

export const meQuery = query({
  name: "auth/me",
  verb: "GET",
  apiGroup: authenticationGroup,
  auth: userTable,
  description: "Get the user record belonging to the authentication token",
  tags: ["xano:quick-start"],
  input: {},
  stack: [
    // Get the user record based on the auth ID
    s.db.get({
      table: userTable,
      fieldName: "id",
      fieldValue: auth("id"),
      output: PUBLIC_USER_FIELDS,
      as: "user",
    }),
    // Create an event log for get user record
    s.function.run({
      fn: createEventLogFn,
      as: "event_log",
      input: {
        user_id: ref("user.id"),
        account_id: ref("user.account_id"),
        action: c.text("get_auth_user"),
        metadata: ref("user"),
      },
    }),
  ],
  response: ref("user"),
  // No `responseShape`: the SDK's static walk derives this one exactly. It narrows
  // the row to the `output` projection *and* carries `db.get`'s miss-to-null
  // (the reason for the peer floor), so it is already `PublicUser | null`
  // — the same contract a declaration would state, but sourced from the stack,
  // so editing `output` moves the consumer type with it.
  // Re-declaring it here would only override derivation and let the two drift.
});
