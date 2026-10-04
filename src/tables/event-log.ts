/**
 * The `event_log` table — the quick-start's audit trail; every auth endpoint
 * writes a row here. Ported 1:1 from `table/event_log.xs`, with the source's
 * dangling `table = ""` references replaced by real links to the ported
 * `user` and `account` tables (documented deviation).
 *
 * NOTE for consumers: the auth endpoints log the full fetched user record into
 * `metadata` — including the password hash on signup/login. Treat this table
 * with the same access/retention discipline as `user` itself.
 */
import { table, f, type InferRow } from "@xano/sdk";
import { userTable } from "./user.js";
import { accountTable } from "./account.js";

export const eventLogTable = table({
  name: "event_log",
  description: "Stores logs of user activities and events within the application.",
  auth: false,
  useXdo: true,
  tags: ["xano:quick-start"],
  // All four columns are name-`?` in the source: required:false, nullable:false.
  schema: {
    user_id: f.tableRef(userTable, {
      description: "Reference to the user who performed the action.",
    }),
    account_id: f.tableRef(accountTable, {
      description: "Reference to the company associated with the user event.",
    }),
    action: f.text({
      methods: ["trim"],
      description:
        "A description of the action performed by the user (e.g., 'login', 'created_invoice', 'updated_profile').",
    }),
    metadata: f.json({
      description:
        "Additional data related to the event, such as resource IDs, old/new values, or other contextual information.",
    }),
  },
});

/** The full `event_log` row. */
export type EventLog = InferRow<typeof eventLogTable>;
