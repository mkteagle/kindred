import { ChronologicalLibrary } from "@/components/kx/chronological-library";
import { KxSkeletonCards } from "@/components/kx/states";
import { Suspense } from "react";

export default function AlbumPage({ params }: { params: Promise<{ albumId: string }> }) {
  return (
    <Suspense fallback={<div className="kx-page"><KxSkeletonCards /></div>}>
      <AlbumLibrary params={params} />
    </Suspense>
  );
}

async function AlbumLibrary({ params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await params;
  return <ChronologicalLibrary albumId={albumId} />;
}
