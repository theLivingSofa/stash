import { fail, getUser, json } from "@/lib/api";
import { userAccess } from "@/lib/auth/users";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const [a, { data: prefs }] = await Promise.all([
    userAccess(user.id),
    db().from("users").select("interests, onboarded_at").eq("id", user.id).maybeSingle(),
  ]);
  return json({
    id: user.id,
    email: a?.email ?? user.email,
    name: a?.name ?? null,
    avatar: a?.avatar_url ?? null,
    role: user.role,
    via: user.via,
    interests: (prefs?.interests as string[] | null) ?? [],
    onboarded: !!prefs?.onboarded_at,
  });
}
