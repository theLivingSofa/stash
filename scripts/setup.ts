/**
 * One-command, idempotent provisioning for Stash.
 *
 *   npm run setup            # everything
 *   npm run setup -- --skip-deploy
 *
 * Steps (each one checks before creating, so re-running is safe):
 *   1. Supabase project "stash" in ap-south-1 (Mumbai): find or create, wait until healthy
 *   2. Apply SQL migrations; store SUPABASE_URL + server key in .env.local
 *   3. Generate APP_PASSCODE / INGEST_SECRET / SESSION_SECRET (kept if present)
 *   4. GitHub repo (public) via gh: find or create, push
 *   5. Vercel project: link, set every env var (production), deploy, capture URL
 *   6. GitHub Actions secrets (INGEST_SECRET, SITE_URL)
 *
 * Needs: gh (logged in), vercel (logged in), SUPABASE_ACCESS_TOKEN and LLM keys in .env.local.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, log, mgmt, need, ROOT, run, sleep, tryRun, upsertEnvFile } from "./_util";
import { migrate } from "./migrate";
import { projectKeys } from "./_keys";
import { makePasscode, makeSecret } from "./_secrets";

const PROJECT_NAME = "stash";
const REGION = "ap-south-1"; // Mumbai, nearest to India
const REPO_NAME = "stash";

/** Env vars that go to Vercel (never the Supabase access token or DB password). */
const VERCEL_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "APP_PASSCODE",
  "SESSION_SECRET",
  "INGEST_SECRET",
  "OWNER_EMAIL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "SITE_URL",
  "GEMINI_API_KEYS",
  "GROQ_API_KEYS",
  "OPENROUTER_API_KEYS",
  "CEREBRAS_API_KEYS",
  "MISTRAL_API_KEYS",
  "LLM_MODELS_GEMINI",
  "LLM_MODELS_GROQ",
  "LLM_MODELS_CEREBRAS",
  "LLM_MODELS_OPENROUTER",
  "LLM_MODELS_MISTRAL",
];

interface Project {
  id: string;
  name: string;
  region: string;
  status: string;
  organization_id: string;
}

function checkTools() {
  const gh = tryRun("gh", ["auth", "status"]);
  if (!gh.ok) throw new Error("GitHub CLI is not logged in. Run: gh auth login");
  const v = tryRun("vercel", ["whoami"]);
  if (!v.ok) throw new Error("Vercel CLI is not logged in. Run: vercel login");
  need("SUPABASE_ACCESS_TOKEN");
  log("tools", `gh ok, vercel ok (${v.out.trim().split("\n").pop()}), Supabase token present`);
}

async function ensureSupabase(): Promise<string> {
  const projects = await mgmt<Project[]>("/v1/projects");
  let project =
    projects.find((p) => p.id === process.env.SUPABASE_PROJECT_REF) ?? projects.find((p) => p.name === PROJECT_NAME);
  if (project) {
    log("supabase", `reusing project ${project.name} (${project.id}, ${project.region}, ${project.status})`);
  } else {
    const orgs = await mgmt<{ id: string; name: string }[]>("/v1/organizations");
    const orgId = orgs[0]?.id ?? projects[0]?.organization_id;
    if (!orgId) throw new Error("No Supabase organization found. Create one at https://supabase.com/dashboard first.");
    const dbPass = process.env.SUPABASE_DB_PASSWORD || makeSecret(24);
    upsertEnvFile({ SUPABASE_DB_PASSWORD: dbPass });
    log("supabase", `creating project "${PROJECT_NAME}" in ${REGION}…`);
    project = await mgmt<Project>("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: PROJECT_NAME, organization_id: orgId, region: REGION, db_pass: dbPass }),
    });
  }
  upsertEnvFile({ SUPABASE_PROJECT_REF: project.id });
  process.env.SUPABASE_PROJECT_REF = project.id;

  for (let i = 0; i < 90; i++) {
    const p = await mgmt<Project>(`/v1/projects/${project.id}`);
    if (p.status === "ACTIVE_HEALTHY") break;
    if (/INACTIVE|PAUSED/.test(p.status)) {
      log("supabase", "project is paused; restoring…");
      await mgmt(`/v1/projects/${project.id}/restore`, { method: "POST", body: "{}" }).catch(() => {});
    }
    if (i % 6 === 0) log("supabase", `waiting for project to be healthy (status ${p.status})…`);
    await sleep(10_000);
  }

  await migrate(project.id);
  const keys = await projectKeys(project.id);
  upsertEnvFile({ SUPABASE_URL: keys.url, SUPABASE_SECRET_KEY: keys.secret });
  process.env.SUPABASE_URL = keys.url;
  process.env.SUPABASE_SECRET_KEY = keys.secret;
  log("supabase", "migrations applied, keys stored in .env.local");
  return project.id;
}

function ensureSecrets() {
  const add: Record<string, string> = {};
  if (!process.env.APP_PASSCODE) add.APP_PASSCODE = makePasscode();
  if (!process.env.INGEST_SECRET) add.INGEST_SECRET = makeSecret();
  if (!process.env.SESSION_SECRET) add.SESSION_SECRET = makeSecret(48);
  if (Object.keys(add).length) {
    upsertEnvFile(add);
    Object.assign(process.env, add);
  }
  log("secrets", Object.keys(add).length ? `generated ${Object.keys(add).join(", ")}` : "already present");
}

function assertNoSecretsTracked() {
  const tracked = run("git", ["ls-files"]).split("\n");
  if (tracked.some((f) => /^\.env(\.|$)/.test(f) && f !== ".env.example")) throw new Error("A .env file is tracked by git. Aborting.");
  const values = VERCEL_VARS.concat("SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD")
    .flatMap((k) => (process.env[k] ?? "").split(","))
    .map((v) => v.trim())
    .filter((v) => v.length >= 12);
  const grep = tryRun("git", ["grep", "-I", "-l", "-F", ...values.flatMap((v) => ["-e", v]), "--cached"]);
  if (grep.ok && grep.out.trim()) throw new Error(`Secret values found in tracked files:\n${grep.out}`);
}

function ensureGitHub(): string {
  const owner = run("gh", ["api", "user", "--jq", ".login"]).trim();
  const full = `${owner}/${REPO_NAME}`;
  if (!existsSync(resolve(ROOT, ".git"))) run("git", ["init", "-b", "main"]);
  run("git", ["add", "-A"]);
  assertNoSecretsTracked();
  if (tryRun("git", ["diff", "--cached", "--quiet"]).ok === false) {
    run("git", ["commit", "-m", "Stash: deploy", "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"]);
  }
  const exists = tryRun("gh", ["repo", "view", full, "--json", "name"]).ok;
  if (!exists) {
    log("github", `creating public repo ${full}…`);
    run("gh", ["repo", "create", full, "--public", "--source", ".", "--remote", "origin", "--push", "--description", "Stash: an endless feed of ideas worth keeping"]);
  } else {
    if (!tryRun("git", ["remote", "get-url", "origin"]).ok) run("git", ["remote", "add", "origin", `https://github.com/${full}.git`]);
    run("git", ["push", "-u", "origin", "HEAD:main"]);
    log("github", `pushed to existing repo ${full}`);
  }
  return full;
}

function vercel(args: string[], input?: string) {
  return run("vercel", [...args, "--non-interactive"], { input, maxBuffer: 20 * 1024 * 1024 });
}

function ensureVercel(): string {
  if (!existsSync(resolve(ROOT, ".vercel/project.json"))) {
    vercel(["link", "--yes", "--project", PROJECT_NAME]);
    log("vercel", `linked project ${PROJECT_NAME}`);
  } else log("vercel", "already linked");

  for (const name of VERCEL_VARS) {
    const value = process.env[name];
    if (!value) continue;
    vercel(["env", "add", name, "--environment", "production", "--force", "--sensitive", "--yes"], value);
  }
  log("vercel", "environment variables set (production)");

  const out = vercel(["deploy", "--prod", "--yes", "--archive=tgz"]);
  const deployUrl = out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi)?.pop();
  if (!deployUrl) throw new Error(`Could not find the deployment URL in:\n${out}`);
  // Prefer the stable production alias (e.g. stash-xyz.vercel.app) over the per-deploy URL.
  const inspect = tryRun("vercel", ["inspect", deployUrl, "--non-interactive"]);
  const aliases = (`${inspect.out}`.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? []).filter((u) => u !== deployUrl);
  const site = aliases.sort((a, b) => a.length - b.length)[0] ?? deployUrl;
  upsertEnvFile({ SITE_URL: site });
  log("vercel", `deployed: ${site}`);
  return site;
}

function ensureActionSecrets(repo: string, site: string) {
  run("gh", ["secret", "set", "INGEST_SECRET", "--repo", repo], { input: need("INGEST_SECRET") });
  run("gh", ["secret", "set", "SITE_URL", "--repo", repo], { input: site });
  log("github", "Actions secrets set (INGEST_SECRET, SITE_URL)");
}

async function main() {
  loadEnv();
  const skipDeploy = process.argv.includes("--skip-deploy");
  checkTools();
  await ensureSupabase();
  ensureSecrets();
  const repo = ensureGitHub();
  if (skipDeploy) return;
  const site = ensureVercel();
  ensureActionSecrets(repo, site);
  console.log(`\nDone. Live at ${site}\nNext: npm run seed  (fills the buffer), then open the site and log in with APP_PASSCODE from .env.local`);
}

main().catch((e) => {
  console.error(`\nSetup stopped: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
