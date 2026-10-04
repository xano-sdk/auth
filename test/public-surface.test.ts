/**
 * The peer import-surface contract: `src/` may import only the SDK's public
 * root entry.
 *
 * `@xano/sdk/internal` is a real, resolvable export, so an internal import in
 * a def would typecheck, lint, build, AND pass the golden test — every gate this
 * repo has — and only surface as a broken consumer install, where the published
 * `dist/index.d.ts` rollup would have to name a type from an entry the package
 * never declared a peer on. Nothing else catches it, hence this file.
 *
 * Tests are deliberately exempt: `encodeTable`, `deriveGuid`, `emptyLock` and
 * friends live behind `/internal` and are exactly what the encoding tests assert
 * against.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

/** Every `.ts` under `src/`, recursively, as repo-relative paths. */
const sourceFiles = (dir = srcDir, prefix = "src"): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    return entry.name.endsWith(".ts") ? [rel] : [];
  });

/** Any `@xano/*` or `@xano-sdk/*` specifier this file imports or re-exports from. */
const SPECIFIER = /from\s*["'](@xano(?:-sdk)?\/[^"']+)["']/g;

/**
 * Comments, so a docblock's usage example is not read as an import. Docblocks
 * here show consumers `import { loginQuery } from "@xano-sdk/auth"`, which is
 * documentation, not this package importing itself. Stripping is text-level and
 * would also blank a `/*` inside a string literal — harmless, since that only
 * ever loses specifiers, and the "still reaches the peer" test below fails loudly
 * if stripping ever swallows the real imports.
 */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

const peerImportsInSource = (source: string): string[] => {
  const code = source.replace(COMMENTS, "");
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] as string);
};

const peerImportsIn = (relPath: string): string[] =>
  peerImportsInSource(readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8"));

describe("public import surface", () => {
  it("finds the source files it is meant to be guarding", () => {
    // A rename or a moved rootDir would otherwise make this suite vacuously green.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("src/index.ts");
  });

  it("reads real imports but not the ones a usage example shows", () => {
    const source = [
      "/**",
      ' * import { loginQuery } from "@xano-sdk/auth";',
      " */",
      '// import { workspace } from "@xano/sdk/internal";',
      'import type { Xano } from "@xano/sdk";',
    ].join("\n");
    expect(peerImportsInSource(source)).toEqual(["@xano/sdk"]);
  });

  it("imports the SDK only through its public root entry in src/", () => {
    const offenders = sourceFiles().flatMap((file) =>
      peerImportsIn(file)
        .filter((spec) => spec !== "@xano/sdk")
        .map((spec) => `${file} → ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("still reaches the peer at all — the guard is not passing by silence", () => {
    const importers = sourceFiles().filter((file) =>
      peerImportsIn(file).includes("@xano/sdk"),
    );
    expect(importers.length).toBeGreaterThan(0);
  });
});
