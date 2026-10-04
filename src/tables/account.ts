/**
 * The `account` table — companies/teams that users belong to. Ported 1:1 from
 * the Xano quick-start template (`table/account.xs`). Identity is left to the
 * consumer's `xano.lock` (or the deterministic name-derived guid).
 */
import { table, f, type InferRow } from "@xano/sdk";

export const accountTable = table({
  name: "account",
  description: "Stores information about accounts that users belong to",
  auth: false,
  // The source stores fields as JSON under the internal `xdo` column; this also
  // auto-prepends the engine's `gin(xdo)` index in canonical order.
  useXdo: true,
  tags: ["xano:quick-start"],
  // All three columns are name-`?` in the source: required:false, nullable:false.
  schema: {
    name: f.text({ methods: ["trim"], description: "The name of the company." }),
    description: f.text({
      methods: ["trim"],
      description: "A brief description of the company.",
    }),
    location: f.text({ methods: ["trim"] }),
  },
});

/** The full `account` row. */
export type Account = InferRow<typeof accountTable>;
