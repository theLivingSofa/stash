/**
 * Apply supabase/migrations/*.sql through the Supabase Management API.
 * Records versions in supabase_migrations.schema_migrations, the same table the
 * Supabase CLI uses, so `supabase db push` and this script agree.
 * Usage: npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, log, need, ROOT, sql } from "./_util";

export async function migrate(ref: string) {
  await sql(
    ref,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`,
  );
  const applied = new Set(
    (await sql<{ version: string }>(ref, "select version from supabase_migrations.schema_migrations")).map((r) => r.version),
  );
  const dir = resolve(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    const name = rest.join("_");
    if (applied.has(version)) {
      log("migrate", `${file} already applied`);
      continue;
    }
    const body = readFileSync(resolve(dir, file), "utf8");
    await sql(ref, body);
    await sql(
      ref,
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ('${version}', '${name.replace(/'/g, "''")}', array[]::text[]) on conflict (version) do nothing`,
    );
    log("migrate", `applied ${file}`);
  }
}

if (require.main === module) {
  loadEnv();
  migrate(need("SUPABASE_PROJECT_REF")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
