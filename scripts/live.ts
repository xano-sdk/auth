// `npm run test:live`: deploy test/live/index.ts to a local Xano engine, then sign up, log in and read
// `auth/me` over real HTTP. Runs from .live/, a throwaway project, so the CLI's engine pin and lock never touch
// this package's package.json. Exits non-zero when a check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, ".live");
const entry = resolve(root, "test/live/index.ts");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "live-fixture", private: true }) + "\n");
const bin = resolve(root, "node_modules/.bin/xanosdk");
execFileSync(bin, ["export", entry, "--out", resolve(dir, "bundle.json"), "--no-lock", "--strict"], { cwd: dir, stdio: "inherit" });
const out = execFileSync(bin, ["deploy", entry, "--no-lock", "--yes", "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const deployed = JSON.parse(out.slice(out.indexOf("{"))) as { url: string };

const api = `${deployed.url.replace(/\/+$/, "")}/api:authn`;
const call = async (method: "GET" | "POST", path: string, body?: unknown, token?: string) => {
  const res = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => results.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });

const email = `ada-${Date.now().toString(36)}@example.com`;
const password = "Correct-horse-9";

const signup = await call("POST", "/auth/signup", { name: "Ada", email, password });
check("signup returns a token", signup.status === 200 && typeof signup.body?.authToken === "string", signup);
const duplicate = await call("POST", "/auth/signup", { name: "Ada", email, password });
check("signing up twice with one email is refused", duplicate.status >= 400 && duplicate.status < 500, duplicate);

const login = await call("POST", "/auth/login", { email, password });
check("login with the same password returns a token", login.status === 200 && typeof login.body?.authToken === "string", login);
const wrong = await call("POST", "/auth/login", { email, password: "Wrong-horse-9" });
check("login with a wrong password is refused", wrong.status >= 400 && wrong.status < 500 && !wrong.body?.authToken, wrong);

const me = await call("GET", "/auth/me", undefined, String(login.body?.authToken));
check("auth/me returns the caller", me.status === 200 && me.body?.email === email, me);
check("auth/me never returns the password", me.status === 200 && !("password" in (me.body ?? {})), me);
const anonymous = await call("GET", "/auth/me");
check("auth/me with no token is refused", anonymous.status === 401, anonymous);

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
