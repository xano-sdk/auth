import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // The peer is resolved from the consumer's install — never bundled. A bundled
  // copy would fork the statement/kind registries the consumer's export() uses.
  // Matched as a pattern so the subpath entries (`/node`, `/internal`) stay
  // external too, not just the root — an exact string would miss them.
  external: [/^@xano\/sdk(\/|$)/],
});
