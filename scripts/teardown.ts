/**
 * Delete everything setup created: the Vercel project, the Supabase project and
 * the GitHub repo. Irreversible, so it only prints the plan unless you pass --yes.
 * Usage: npm run teardown            (dry run)
 *        npm run teardown -- --yes   (actually delete)
 */
import { loadEnv, mgmt, run, tryRun } from "./_util";

async function main() {
  loadEnv();
  const yes = process.argv.includes("--yes");
  const ref = process.env.SUPABASE_PROJECT_REF;
  const owner = tryRun("gh", ["api", "user", "--jq", ".login"]).out.trim();
  const plan = [
    "Vercel project: stash (vercel project rm stash)",
    ref ? `Supabase project: ${ref} (all data)` : "Supabase project: none recorded",
    owner ? `GitHub repo: ${owner}/stash (needs: gh auth refresh -s delete_repo)` : "GitHub repo: unknown owner",
  ];
  console.log(`${yes ? "Deleting" : "Would delete"}:\n  - ${plan.join("\n  - ")}`);
  if (!yes) {
    console.log("\nNothing deleted. Re-run with --yes to delete.");
    return;
  }
  console.log(tryRun("vercel", ["project", "rm", "stash", "--yes"]).out);
  if (ref) await mgmt(`/v1/projects/${ref}`, { method: "DELETE" }).then(() => console.log("Supabase project deleted"));
  if (owner) console.log(tryRun("gh", ["repo", "delete", `${owner}/stash`, "--yes"]).out);
  void run;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
