import { fail, getUser, json } from "@/lib/api";
import { userAccess } from "@/lib/auth/users";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const a = await userAccess(user.id);
  return json({ id: user.id, email: a?.email ?? user.email, name: a?.name ?? null, avatar: a?.avatar_url ?? null, role: user.role, via: user.via });
}
