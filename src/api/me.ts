/**
 * GET `auth/me` — return the authenticated user's record. Ported from the
 * quick-start template; the output list excludes `password`, and even this
 * read endpoint writes an `event_log` row.
 *
 * A valid token whose user row was deleted answers 404. The port first left
 * that to fall through, which drills `ref("user.id")` into the null `db.get`
 * binds on a miss: a runtime "Unable to locate var" (HTTP 500). SDK 1.0.17's
 * check (`stack.drill-maybe-null`) refuses it, which failed `xanosdk export
 * --strict` in every project that installs this module, so the precondition
 * is the stated reason to depart from the port.
 *
 * `auth` names the ported `user` table by def handle (the SDK takes the auth
 * table itself, not `true`), so it resolves to that table's guid no matter
 * how many other auth tables the consumer registers.
 */
import { query, s, ref, auth, c, expr } from "@xano/sdk";
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
  // The missing-row check above is left out on purpose, so this warning is accepted.
  diagnostics: { allow: ["stack.drill-maybe-null"] },
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
    // A token for a deleted user: 404, not a 500 from the drills below
    s.precondition({
      expr: expr(ref("user"), "!=", c.null()),
      error_type: "notfound",
      error: c.text("User not found."),
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
