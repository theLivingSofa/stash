import { PeopleManager } from "../People";

export const metadata = { title: "People · Stash" };

export default async function PeoplePage({ searchParams }: PageProps<"/admin/people">) {
  const { tab } = await searchParams;
  return <PeopleManager initialTab={tab === "requests" || tab === "readers" ? tab : "approved"} />;
}
