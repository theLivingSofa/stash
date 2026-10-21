import { Feed } from "@/components/Feed";

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const topic = typeof sp.topic === "string" ? sp.topic : undefined;
  const concept = typeof sp.concept === "string" ? sp.concept : undefined;
  return <Feed key={`${topic ?? ""}|${concept ?? ""}`} topic={topic} concept={concept} />;
}
