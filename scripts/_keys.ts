import { mgmt } from "./_util";
/** Fetch the project's server key (new "secret" key, else legacy service_role) and publishable key. */
export async function projectKeys(ref: string) {
  const keys = await mgmt<{ name: string; type: string; api_key: string }[]>(`/v1/projects/${ref}/api-keys?reveal=true`);
  const secret = keys.find((k) => k.type === "secret")?.api_key ?? keys.find((k) => k.name === "service_role")?.api_key;
  if (!secret) throw new Error("No secret/service_role key found for project");
  return { url: `https://${ref}.supabase.co`, secret };
}
