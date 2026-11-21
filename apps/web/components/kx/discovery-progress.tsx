"use client";

import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";

type Worker = { running: boolean; stale: boolean; phase?: string; registered?: number; unchanged?: number; completed?: number; failed?: number; complete?: boolean };
type Progress = { inventory: { media_files?: number } | null; discovery: Worker | null; previews: Worker | null; recognition: Worker | null };

export function DiscoveryProgress() {
  const { data } = useQuery<Progress>({
    queryKey: ["library-discovery"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/library/discovery`, { signal });
      if (!response.ok) throw new Error("Library progress is unavailable");
      return response.json();
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  if (!data?.discovery) return null;
  const discovery = data.discovery;
  const total = data.inventory?.media_files;
  const registered = (discovery.registered ?? 0) + (discovery.unchanged ?? 0);
  const active = discovery.running || data.previews?.running || data.recognition?.running;
  return (
    <aside className="kx-discovery-progress" aria-label="NAS library progress">
      <strong>{discovery.phase === "waiting_for_capacity" ? "Waiting for the NAS to catch up" : discovery.running ? "Discovering your NAS library" : discovery.complete ? "NAS files registered" : "NAS scan needs attention"}</strong>
      <span>{fmt.format(registered)}{total ? ` of approximately ${fmt.format(total)}` : ""} files cataloged. {active ? "Discovery finishes first, then thumbnails, then recognition." : "Progress updates are delayed; worker activity is unconfirmed."} File totals include duplicates.</span>
    </aside>
  );
}
