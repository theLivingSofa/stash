import { redirect } from "next/navigation";
import { Feed } from "@/components/Feed";
import { getUser } from "@/lib/api";
import { db } from "@/lib/db";

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const topic = typeof sp.topic === "string" ? sp.topic : undefined;
  const concept = typeof sp.concept === "string" ? sp.concept : undefined;
  // First sign-in: pick topics before the first feed.
  if (!topic && !concept) {
    const user = await getUser();
    if (user) {
      const { data } = await db().from("users").select("onboarded_at").eq("id", user.id).maybeSingle();
      if (data && !data.onboarded_at) redirect("/welcome");
    }
  }
  return <Feed key={`${topic ?? ""}|${concept ?? ""}`} topic={topic} concept={concept} />;
}
