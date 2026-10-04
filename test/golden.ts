/**
 * The single definition of how the golden bundle is built and serialized.
 *
 * `test/bundle.test.ts` (which asserts the fixture) and `scripts/regen-golden.ts`
 * (which writes it) both import from here, so the two can never drift. Changing
 * the workspace name or the serialization changes both sides at once — which is
 * the point: a fixture regenerated a different way than it is asserted would
 * silently weaken the byte-exact contract this file exists to keep.
 */
import { Xano } from "@xano/sdk";
import { registerAuth } from "../src/index.js";

/** Fixed so the derived identities (and thus the bundle) are deterministic. */
export const GOLDEN_WORKSPACE_NAME = "xts-auth-golden";

export const GOLDEN_FIXTURE_URL = new URL("./fixtures/golden-bundle.json", import.meta.url);

/** A fresh, fully-registered export. `Xano.export()` is deterministic. */
export const buildGoldenBundle = () =>
  registerAuth(new Xano().registerWorkspace({ name: GOLDEN_WORKSPACE_NAME })).export();

/** 2-space JSON with a trailing newline — the committed fixture's on-disk form. */
export const serializeGoldenBundle = (bundle: unknown) => JSON.stringify(bundle, null, 2) + "\n";
