/**
 * Expected object identities. The defs no longer pin guids — identity is left
 * to the consuming project's `xano.lock` (or, with no lock, a deterministic
 * `md5` of the object's seed). These tests run with no lock seeded, so the
 * expected guid for each object is exactly that derivation. Deriving them here
 * from the same components the defs use proves the *referential*
 * contract: every statement/binding reference resolves to the same identity the
 * target object emits. The committed golden fixture freezes the literal values,
 * so a change to the derivation formula is still caught there.
 */
import { deriveGuid } from "@xano/sdk/internal";

/** The api group all three endpoints hang off — the first seed component below. */
const GROUP = "Authentication";

/**
 * Queries seed from `query:<apiGroup>|<verb>|<name>`, not the bare `query:<name>`
 * every other kind uses: a path alone is not an identity when the same one can
 * be mounted under a different group or answer a different verb. The SDK derives
 * this through an internal `deriveQueryGuid` it does not export, so the seed is
 * rebuilt here from the same components — which is the point of this file, since
 * a silently re-shaped seed has to fail here and in the golden fixture rather
 * than be inherited from the encoder it is meant to check.
 */
const deriveQueryGuid = (verb: string, name: string) =>
  deriveGuid("query", [GROUP, verb, name].join("|"));

export const GUIDS = {
  user: deriveGuid("dbo", "user"),
  account: deriveGuid("dbo", "account"),
  eventLog: deriveGuid("dbo", "event_log"),
  createEventLog: deriveGuid("function", "Getting Started Template/create_event_log"),
  group: deriveGuid("app", GROUP),
  signup: deriveQueryGuid("POST", "auth/signup"),
  login: deriveQueryGuid("POST", "auth/login"),
  me: deriveQueryGuid("GET", "auth/me"),
} as const;

export const QUICK_START_TAG = [{ tag: "xano:quick-start" }];
