"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";

interface ClusterProposal {
  cluster_id: string;
  support: number;
  confidence: number;
  reason: string;
  runner_up: string | null;
  photos: number;
  avatar: string | null;
  is_strongest: boolean;
}

interface PersonProposal {
  name: string;
  clusters: ClusterProposal[];
  already_in_library: boolean;
  total_support: number;
  total_photos: number;
}

const fmt = new Intl.NumberFormat("en-GB");

export default function NameReviewPage() {
  const queryClient = useQueryClient();
  const [settled, setSettled] = useState<Record<string, "accepted" | "rejected">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery<{
    people: PersonProposal[];
    unnamed_clusters: number;
  }>({
    queryKey: ["name-proposals"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/name-proposals`);
      if (!response.ok) throw new Error("Suggestions could not be loaded.");
      return response.json();
    },
  });

  /**
   * Name every group this person matched, in one go.
   *
   * Kindred splits a person across many clusters, so confirming them once has
   * to settle all of them — asking five times for one person is five chances
   * to give up halfway and leave the library half-named.
   */
  const onAccept = useCallback(
    async (person: PersonProposal) => {
      setBusy(person.name);
      setFailed(null);
      try {
        for (const cluster of person.clusters) {
          const response = await fetch(`${BACKEND}/clusters/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: "people",
              cluster_id: cluster.cluster_id,
              name: person.name,
            }),
          });
          if (!response.ok) throw new Error(`${person.name} could not be saved.`);
        }
        setSettled((current) => ({ ...current, [person.name]: "accepted" }));
        void queryClient.invalidateQueries({ queryKey: ["kx-cluster-browse", "people"] });
        void queryClient.invalidateQueries({ queryKey: ["kx-named-people", "people"] });
      } catch (problem) {
        setFailed((problem as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [queryClient],
  );

  // Rejecting writes nothing: it drops the row for this session, and the
  // suggestion returns next time in case it was right after all.
  const onReject = useCallback((person: PersonProposal) => {
    setSettled((current) => ({ ...current, [person.name]: "rejected" }));
  }, []);

  const people = data?.people ?? [];
  const remaining = useMemo(() => people.filter((p) => !settled[p.name]), [people, settled]);
  const acceptedCount = Object.values(settled).filter((s) => s === "accepted").length;

  return (
    <main className="kx-page" style={{ maxWidth: 880 }}>
      <span className="kx-eyebrow">Review</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>
        Names Google already knew.
      </h1>
      <p className="kx-lede">
        Google tagged who was in each photo but never which face was which. Where
        a face keeps appearing in photos tagged with exactly one name, that name
        is almost certainly theirs. Nothing is applied until you say so.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {failed && <KxErrorBanner detail={failed} onRetry={() => void refetch()} />}

      {isPending ? (
        <KxSkeletonRows count={6} height={104} />
      ) : remaining.length === 0 ? (
        <KxEmpty
          title={acceptedCount > 0 ? "That is everyone." : "Nothing to suggest yet."}
          body={
            acceptedCount > 0
              ? `${acceptedCount} ${acceptedCount === 1 ? "person" : "people"} named. ${fmt.format(data?.unnamed_clusters ?? 0)} groups in the library still have no name.`
              : "Suggestions appear as photos carrying Google's tags are imported. Groups with too little evidence, or two names too close to separate, are deliberately left out."
          }
        />
      ) : (
        <>
          <p className="kx-mono kx-namereview-count">
            {fmt.format(remaining.length)} {remaining.length === 1 ? "person" : "people"} to review
            {acceptedCount > 0 && ` · ${fmt.format(acceptedCount)} named`}
          </p>
          <ul className="kx-namereview">
            {remaining.map((person) => (
              <li key={person.name} className="kx-nameprop">
                <span className="kx-nameprop-faces">
                  {person.clusters.slice(0, 3).map((cluster) =>
                    cluster.avatar ? (
                      <img
                        key={cluster.cluster_id}
                        className="kx-nameprop-face"
                        src={cluster.avatar}
                        alt=""
                      />
                    ) : (
                      <span key={cluster.cluster_id} className="kx-nameprop-face is-blank" />
                    ),
                  )}
                </span>

                <div className="kx-nameprop-body">
                  <strong className="kx-nameprop-name">
                    {person.name}
                    {person.already_in_library && (
                      <span className="kx-nameprop-tag kx-mono">already in your library</span>
                    )}
                  </strong>
                  <span className="kx-mono kx-nameprop-why">
                    {person.clusters.length === 1
                      ? person.clusters[0].reason
                      : `${person.clusters.length} separate groups look like this person · ${fmt.format(person.total_support)} single-name photos between them`}
                  </span>
                  <span className="kx-mono kx-nameprop-meta">
                    {fmt.format(person.total_photos)} photos
                    {person.clusters[0]?.runner_up &&
                      ` · next closest name: ${person.clusters[0].runner_up}`}
                  </span>
                </div>

                <div className="kx-nameprop-actions">
                  <a
                    className="kx-button compact"
                    href={`/people/${person.clusters[0].cluster_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    See them
                  </a>
                  <button
                    className="kx-button"
                    onClick={() => onReject(person)}
                    disabled={busy === person.name}
                  >
                    Not them
                  </button>
                  <button
                    className="kx-button primary"
                    onClick={() => void onAccept(person)}
                    disabled={busy === person.name}
                  >
                    {busy === person.name
                      ? "Saving…"
                      : person.clusters.length > 1
                        ? `Yes — name all ${person.clusters.length}`
                        : `Yes, ${person.name.split(" ")[0]}`}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
