/**
 * The `user` table — the workspace's auth table. Ported 1:1 from the Xano
 * quick-start template (`table/user.xs`) with one documented deviation: the
 * source's `account_id` carries a dangling `table = ""` reference; since this
 * package ships the `account` table too, the column links to the real def.
 *
 * `id` / `created_at` and the `primary(id)` / `btree(created_at desc)` indexes
 * are the engine's system defaults — auto-injected, not declared here.
 */
import { table, f, type InferRow } from "@xano/sdk";
import { accountTable } from "./account.js";

export const userTable = table({
  name: "user",
  description: "Stores user information and allows the user to authenticate  against",
  auth: true,
  // Pinned: a table without an explicit useXdo inherits the CONSUMER workspace's
  // use_xdo at export, which would silently flip the auth table's storage mode.
  useXdo: false,
  tags: ["xano:quick-start"],
  // Flag semantics (per the engine's schema-table fixtures): a bare column name
  // in XanoScript means required:true; `?` on the name means required:false;
  // `?` on the type means nullable:true.
  schema: {
    name: f.text({ required: true, methods: ["trim"] }),
    email: f.email({ required: true, nullable: true, methods: ["trim", "lower"] }),
    // f.password defaults to access:"internal" — matching the source's hidden hash.
    password: f.password({
      required: true,
      nullable: true,
      methods: ["min:8", "minAlpha:1", "minDigit:1"],
    }),
    account_id: f.tableRef(accountTable, {
      description: "Reference to the company the user belongs to.",
    }),
    role: f.enum(["admin", "member"], {
      description: "The role of the user within their company (e.g., 'admin', 'member').",
    }),
    password_reset: f.object({
      token: f.password(),
      expiration: f.timestamp({ nullable: true }),
      used: f.bool(),
    }),
  },
  index: [{ type: "btree|unique", fields: [{ name: "email", op: "asc" }] }],
});

/** The full `user` row, including the `internal`-access `password` hash. */
export type User = InferRow<typeof userTable>;

/**
 * The columns `auth/me` selects — the single source of truth for that
 * statement's `output` array and for {@link PublicUser}, so the two cannot
 * drift. `auth/login` deliberately reads a *different* list (it adds `password`
 * for the hash check) and returns no user object at all, so it keeps its own
 * literal.
 */
export const PUBLIC_USER_FIELDS = [
  "id",
  "created_at",
  "name",
  "email",
  "account_id",
  "role",
] as const satisfies readonly (keyof User)[];

/**
 * The user projection `auth/me` hands back: {@link PUBLIC_USER_FIELDS}, which
 * excludes the password hash. Derived from that array, so editing the `output`
 * list in `api/me.ts` changes this type too.
 */
export type PublicUser = Pick<User, (typeof PUBLIC_USER_FIELDS)[number]>;
