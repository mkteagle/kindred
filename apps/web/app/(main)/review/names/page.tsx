"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";

interface Proposal {
  cluster_id: string;
  name: string;
  confidence: number;
  support: number;
  runner_up: string | null;
  reason: string;
  photos: number;
  avatar: string | null;
}

const fmt = new Intl.NumberFormat("en-GB");

export default function NameReviewPage() {
  const queryClient = useQueryClient();
  const [settled, setSettled] = useState<Record<string, "accepted" | "rejected">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery<{
    proposals: Proposal[];
    unnamed_clusters: number;
  }>({
    queryKey: ["name-proposals"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/name-proposals`);
      if (!response.ok) throw new Error("Suggestions could not be loaded.");
      return response.json();
    },
  });

  const accept = useMutation({
    mutationFn: async (proposal: Proposal) => {
      const response = await fetch(`${BACKEND}/clusters/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "people",
          cluster_id: proposal.cluster_id,
          name: proposal.name,
        }),
      });
      if (!response.ok) throw new Error("That name could not be saved.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kx-cluster-browse", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["kx-named-people", "people"] });
    },
  });

  const onAccept = useCallback(
    async (proposal: Proposal) => {
      setBusy(proposal.cluster_id);
      try {
        await accept.mutateAsync(proposal);
        setSettled((current) => ({ ...current, [proposal.cluster_id]: "accepted" }));
      } finally {
        setBusy(null);
      }
    },
    [accept],
  );

  // Rejecting is local and deliberately so: it removes the suggestion from
  // this session's list without writing anything. Nothing about the cluster
  // changes, and the suggestion returns next time in case it was right.
  const onReject = useCallback((proposal: Proposal) => {
    setSettled((current) => ({ ...current, [proposal.cluster_id]: "rejected" }));
  }, []);

  const proposals = data?.proposals ?? [];
  const remaining = useMemo(
    () => proposals.filter((p) => !settled[p.cluster_id]),
    [proposals, settled],
  );
  const acceptedCount = Object.values(settled).filter((s) => s === "accepted").length;

  return (
    <main className="kx-page" style={{ maxWidth: 860 }}>
      <span className="kx-eyebrow">Review</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>
        Names Google already knew.
      </h1>
      <p className="kx-lede">
        Google tagged who was in each photo but never which face was which. Where
        a face keeps turning up in photos tagged with exactly one name, that name
        is almost certainly theirs. Nothing is applied until you say so.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}

      {isPending ? (
        <KxSkeletonRows count={6} height={92} />
      ) : remaining.length === 0 ? (
        <KxEmpty
          title={acceptedCount > 0 ? "That is all of them." : "Nothing to suggest yet."}
          body={
            acceptedCount > 0
              ? `${acceptedCount} ${acceptedCount === 1 ? "person" : "people"} named. The rest of the library still has ${fmt.format(data?.unnamed_clusters ?? 0)} unnamed groups.`
              : "Suggestions appear as photos with Google's tags are imported. Groups with too little evidence, or two names too close to separate, are deliberately left out."
          }
        />
      ) : (
        <>
          <p className="kx-mono kx-namereview-count">
            {fmt.format(remaining.length)} to review
            {acceptedCount > 0 && ` · ${fmt.format(acceptedCount)} named`}
          </p>
          <ul className="kx-namereview">
            {remaining.map((proposal) => (
              <li key={proposal.cluster_id} className="kx-nameprop">
                {proposal.avatar ? (
                  <img className="kx-nameprop-face" src={proposal.avatar} alt="" />
                ) : (
                  <span className="kx-nameprop-face is-blank" aria-hidden="true" />
                )}

                <div className="kx-nameprop-body">
                  <strong className="kx-nameprop-name">{proposal.name}</strong>
                  <span className="kx-mono kx-nameprop-why">{proposal.reason}</span>
                  <span className="kx-mono kx-nameprop-meta">
                    {fmt.format(proposal.photos)} photos in this group
                    {proposal.runner_up && ` · next closest: ${proposal.runner_up}`}
                  </span>
                </div>

                <div className="kx-nameprop-actions">
                  <a
                    className="kx-button compact"
                    href={`/people/${proposal.cluster_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    See them
                  </a>
                  <button
                    className="kx-button"
                    onClick={() => onReject(proposal)}
                    disabled={busy === proposal.cluster_id}
                  >
                    Not them
                  </button>
                  <button
                    className="kx-button primary"
                    onClick={() => void onAccept(proposal)}
                    disabled={busy === proposal.cluster_id}
                  >
                    {busy === proposal.cluster_id ? "Saving…" : `Yes, ${proposal.name.split(" ")[0]}`}
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
