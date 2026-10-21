import { IdeaView } from "./IdeaView";

export default async function IdeaPage({ params }: PageProps<"/idea/[id]">) {
  const { id } = await params;
  return <IdeaView id={id} />;
}
