/* Shared helpers for setup scripts (run with tsx, outside Next.js). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { resolve } from "node:path";
import { configureNetwork } from "../src/lib/net";

configureNetwork();

export const ROOT = resolve(__dirname, "..");
export const ENV_FILE = resolve(ROOT, ".env.local");

export function readEnvFile(file = ENV_FILE): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** Set (or add) keys in .env.local, preserving comments and order. */
export function upsertEnvFile(values: Record<string, string>, file = ENV_FILE) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : ["# Local secrets for Stash. Gitignored. Never commit."];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1])!;
      pending.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [k, v] of pending) next.push(`${k}=${v}`);
  writeFileSync(file, next.join("\n") + "\n", { mode: 0o600 });
}

export function loadEnv(): Record<string, string> {
  const env = readEnvFile();
  for (const [k, v] of Object.entries(env)) if (v && !process.env[k]) process.env[k] = v;
  return env;
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (set it in .env.local)`);
  return v;
}

export async function mgmt<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase API ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function sql<T = Record<string, unknown>>(ref: string, query: string): Promise<T[]> {
  return mgmt<T[]>(`/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query }) });
}

export function run(cmd: string, args: string[], opts: ExecFileSyncOptions & { input?: string } = {}): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).toString();
}

export function tryRun(cmd: string, args: string[], opts: ExecFileSyncOptions & { input?: string } = {}): { ok: boolean; out: string } {
  try {
    return { ok: true, out: run(cmd, args, opts) };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; message: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` || err.message };
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function log(step: string, msg: string) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}
