/**
 * @xano-sdk/auth — Xano's quick-start authentication surface (signup/login/me,
 * user/account/event_log tables, event-log function) as typed Xano SDK defs.
 *
 * Use `registerAuth(xano)` for the turnkey install, or register individual
 * defs for granular control. All cross-object references are guid-resolved at
 * authoring time, so the defs work inside any consumer workspace.
 */
export { registerAuth } from "./register.js";
export type { RegisterAuthOptions } from "./register.js";

export { userTable } from "./tables/user.js";
export { accountTable } from "./tables/account.js";
export { eventLogTable } from "./tables/event-log.js";

/**
 * Row and response types for consumers. These erase at compile time, so a
 * frontend can `import type` them without pulling any def (or its stack) into
 * the bundle. Pair them with each query's `getPath()`/`verb` to call the
 * endpoints without hand-written URLs or payload types.
 */
export { PUBLIC_USER_FIELDS } from "./tables/user.js";
export type { User, PublicUser } from "./tables/user.js";
export type { Account } from "./tables/account.js";
export type { EventLog } from "./tables/event-log.js";
export type { AuthTokenResponse } from "./api/types.js";
export { createEventLogFn } from "./functions/create-event-log.js";

export { authenticationGroup } from "./api/authentication-group.js";
export { signupQuery } from "./api/signup.js";
export { loginQuery } from "./api/login.js";
export { meQuery } from "./api/me.js";
