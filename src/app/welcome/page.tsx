import { TopicPicker } from "./TopicPicker";

export const metadata = { title: "Pick your topics · Stash" };

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const sp = await searchParams;
  return <TopicPicker edit={sp.edit === "1"} />;
}
