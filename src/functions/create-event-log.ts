/**
 * `Getting Started Template/create_event_log` — writes one row into
 * `event_log`. Ported 1:1 from the quick-start template; the namespaced source
 * name is kept verbatim (it seeds the derived guid). Identity is left to the
 * consumer's `xano.lock` or the deterministic name-derivation.
 */
import { defineFunction, input, s, c, inp } from "@xano/sdk";
import { eventLogTable } from "../tables/event-log.js";

export const createEventLogFn = defineFunction({
  name: "Getting Started Template/create_event_log",
  description: "Creates a record in the event log table",
  tags: ["xano:quick-start"],
  input: {
    user_id: input.int({
      required: true,
      description: "Unique identifier for the user who performed the action.",
    }),
    account_id: input.int({
      required: true,
      description: "Unique identifier for the account associated with the event.",
    }),
    action: input.text({
      required: true,
      description: "A description of the action performed by the user (e.g., 'login', 'created_invoice').",
    }),
    metadata: input.json({
      description: "Additional data related to the event, such as resource IDs or old/new values.",
    }),
  },
  stack: [
    s.db.add({
      table: eventLogTable,
      as: "new_log_entry",
      data: [
        { name: "created_at", value: c.text("now") },
        { name: "user_id", value: inp("user_id") },
        { name: "account_id", value: inp("account_id") },
        { name: "action", value: inp("action") },
        { name: "metadata", value: inp("metadata") },
      ],
    }),
  ],
  // XanoScript `response = null` — an explicit null result item.
  response: c.null(),
});
