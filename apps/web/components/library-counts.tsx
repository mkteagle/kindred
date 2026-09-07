"use client";

import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";

export function LibraryCounts() {
  const { data, isError } = useQuery<{
    photos: number; videos: number; indexed_photos: number; pending_index: number;
    on_nas: number; on_flickr: number;
  }>({
    queryKey: ["library-counts"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/library/counts`);
      if (!response.ok) throw new Error("Counts unavailable");
      return response.json();
    },
    refetchInterval: 30000,
  });
  return (
    <div className="summary-note" role="status" style={{ marginBottom: 20, padding: "14px 18px", border: "1px solid var(--line)", borderRadius: 12 }}>
      {data ? <>
        <strong>{fmt.format(data.photos)} photos</strong> · {fmt.format(data.videos)} videos · {fmt.format(data.indexed_photos)} photos indexed
        {data.pending_index > 0 && <> · {fmt.format(data.pending_index)} awaiting indexing</>}
        <div style={{ marginTop: 4 }}>{fmt.format(data.on_nas)} files on NAS · {fmt.format(data.on_flickr)} files on Flickr</div>
      </> : isError ? "Library counts are temporarily unavailable." : "Loading library counts…"}
    </div>
  );
}
