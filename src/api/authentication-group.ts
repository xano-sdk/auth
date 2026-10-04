/**
 * The `Authentication` API group. Identity (guid) and the public URL segment
 * (canonical) are left unset: the consuming project's `xano.lock` mints and
 * freezes them at export, or — with no lock — the guid derives deterministically
 * from the name and the engine assigns the canonical at import.
 */
import { apiGroup } from "@xano/sdk";

export const authenticationGroup = apiGroup({
  name: "Authentication",
  description:
    "This group provides endpoints for user login, signup, and reset password, returning authentication tokens and user records.",
  tags: ["xano:quick-start"],
});
