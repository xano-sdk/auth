/**
 * The `user` projection written to `event_log.metadata` by `auth/signup` and
 * `auth/login`.
 *
 * DEVIATION from the quick-start template (issue #10). The source passes the
 * whole `user` var — for `login` that var is a `db.get` whose `output` list
 * deliberately includes the `internal`-access `password` column (the hash is
 * load-bearing for `check_password`), and for `signup` it is the freshly added
 * row. Either way the template writes the password hash into `event_log`, a
 * table with none of `user`'s access discipline, on every authentication.
 *
 * This builds an explicit object from {@link PUBLIC_USER_FIELDS} instead — the
 * same list `auth/me` selects and `PublicUser` is derived from, so the redaction
 * cannot drift from the package's own definition of "safe to expose". Adding a
 * secret-bearing column to `userTable` keeps it out of the log by default: it
 * has to be added to `PUBLIC_USER_FIELDS` to get in, and that array is already
 * the reviewed one.
 *
 * A factory rather than a shared constant: each query gets its own `Value` so
 * encoding one statement can never observe state left by the other.
 */
import { obj, ref } from "@xano/sdk";
import { PUBLIC_USER_FIELDS } from "../tables/user.js";

/**
 * `{ id: $var.user.id, created_at: ..., name: ..., email: ..., account_id: ...,
 * role: ... }` — the fetched user with the password hash (and anything else not
 * in {@link PUBLIC_USER_FIELDS}) dropped.
 *
 * Both queries bind their user record to a var named `user`, so the var name is
 * fixed here rather than parameterized.
 */
export const redactedUserMetadata = () =>
  obj(Object.fromEntries(PUBLIC_USER_FIELDS.map((field) => [field, ref(`user.${field}`)])));
