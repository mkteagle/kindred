import { ChronologicalLibrary } from "@/components/kx/chronological-library";

export default async function AlbumPage({ params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await params;
  return <ChronologicalLibrary albumId={albumId} />;
}
