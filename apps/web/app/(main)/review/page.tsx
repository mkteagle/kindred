"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { BACKEND, fmt, toBackendCategory } from "@/lib/constants";
import type { ClusterDetail, ClusterSummary, ClustersSummaryResponse, Detection } from "@/types";
import { MergeDialog } from "@/components/dialogs";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";
import { useNamedPeople } from "@/components/kx/use-people";
import { useReviewCounts } from "@/components/kx/use-review";
import { photoThumb, faceThumb } from "@/lib/photo-url";

const PAGE_SIZE = 60;
/** Face chips shown before the strip folds into a "+N". */
const FACE_CHIPS = 12;
/** Photos shown under "where they show up". */
const PHOTO_TILES = 12;

const SINGULAR: Record<string, string> = {
  people: "person",
  animals: "animal",
  vehicles: "vehicle",
};

/** One photo per detection — a group of 600 faces is not 600 photos. */
function uniquePhotos(items: Detection[]): Detection[] {
  const seen = new Map<string, Detection>();
  for (const item of items) if (!seen.has(item.photo_id)) seen.set(item.photo_id, item);
  return Array.from(seen.values());
}

export default function ReviewPage() {
  return (
    <main className="kx-page" style={{ maxWidth: 1080 }}>
      <Suspense fallback={<KxSkeletonCards count={4} minWidth={300} height={220} />}>
        <ReviewScreen />
      </Suspense>
    </main>
  );
}

/**
 * Naming people, one group at a time, biggest first.
 *
 * The whole screen is built around a single decision — who is this? — so the
 * name field, the evidence and the four ways out all sit on one page rather
 * than behind a dialog. Every action has a key: ↵ save, M merge, S skip,
 * X not a person. The shortcuts stand down while a text field has focus, so
 * typing a name that contains an "s" does not skip the group.
 */
function ReviewScreen() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category") || "people";
  const backendCat = toBackendCategory(category);
  const singular = SINGULAR[category] ?? "person";

  const queryClient = useQueryClient();
  const { openLightbox } = useLightbox();
  const counts = useReviewCounts(category);
  const { data: named } = useNamedPeople(backendCat);

  const [index, setIndex] = useState(0);
  const [acted, setActed] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── The queue ─────────────────────────────────────────────────────── */

  // The summary returns named groups first, so the queue is what is left after
  // them. Paging rather than asking for all 700 at once keeps the avatar chips
  // — which are inline base64 — off the wire until they are needed.
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery<ClustersSummaryResponse>({
      queryKey: ["kx-review-queue", backendCat],
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
        const response = await fetch(`${BACKEND}/clusters/${backendCat}/summary?${params}`);
        if (!response.ok) throw new Error("The review queue could not be loaded.");
        return response.json();
      },
      getNextPageParam: (last) => (last.has_more ? (last.offset ?? 0) + PAGE_SIZE : undefined),
    });

  const queue = useMemo(() => {
    const rows = data?.pages.flatMap((page) => page.clusters) ?? [];
    return rows
      .filter((cluster) => !cluster.label && !acted.has(cluster.id))
      .sort((a, b) => b.photo_count - a.photo_count);
  }, [data, acted]);

  const current: ClusterSummary | null = queue[index] ?? null;

  // Keep pulling pages while every group seen so far is already named.
  useEffect(() => {
    if (queue.length > index + 2 || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [queue.length, index, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { data: detail, isPending: detailPending } = useQuery<ClusterDetail>({
    queryKey: ["cluster-detail", category, current?.id],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/${backendCat}/${current!.id}`);
      if (!response.ok) throw new Error("That group could not be loaded.");
      return response.json();
    },
    enabled: Boolean(current),
  });

  // The next group's faces are fetched while this one is being decided, so the
  // rhythm of the queue is not one network round trip per name.
  const upcoming = queue[index + 1];
  useEffect(() => {
    if (!upcoming) return;
    void queryClient.prefetchQuery({
      queryKey: ["cluster-detail", category, upcoming.id],
      queryFn: () => fetch(`${BACKEND}/clusters/${backendCat}/${upcoming.id}`).then((r) => r.json()),
    });
  }, [upcoming, category, backendCat, queryClient]);

  const items = useMemo(
    () => (detail?.items ?? []).filter((item) => !removed.has(item.id)),
    [detail, removed],
  );
  const photos = useMemo(() => uniquePhotos(items), [items]);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      photos.map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: photoThumb(photo),
        photo_url: photo.photo_url,
        flickr_url: photo.flickr_url,
        photo_title: photo.photo_title,
      })),
    [photos],
  );

  /* ── The four ways out ─────────────────────────────────────────────── */

  const advance = useCallback((clusterId?: string) => {
    setDraft("");
    setRemoved(new Set());
    if (clusterId) setActed((current) => new Set(current).add(clusterId));
    else setIndex((current) => current + 1);
  }, []);

  const post = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      try {
        const response = await fetch(`${BACKEND}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("That could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["kx-review-queue", backendCat] });
    void queryClient.invalidateQueries({ queryKey: ["kx-cluster-browse", backendCat] });
    void queryClient.invalidateQueries({ queryKey: ["kx-named-people", backendCat] });
    void queryClient.invalidateQueries({ queryKey: ["kx-cluster-total", backendCat] });
  }, [queryClient, backendCat]);

  const saveName = useCallback(async () => {
    const name = draft.trim();
    if (!current || !name || busy) return;
    await post("/clusters/label", { category: backendCat, cluster_id: current.id, name });
    advance(current.id);
    invalidate();
  }, [current, draft, busy, post, backendCat, advance, invalidate]);

  const mergeInto = useCallback(
    async (targetId: string) => {
      if (!current) return;
      setMergeOpen(false);
      await post("/clusters/merge", {
        category: backendCat,
        source_id: current.id,
        target_id: targetId,
      });
      advance(current.id);
      invalidate();
    },
    [current, post, backendCat, advance, invalidate],
  );

  const notAPerson = useCallback(async () => {
    if (!current || busy) return;
    await post("/clusters/dismiss", { category: backendCat, cluster_id: current.id });
    advance(current.id);
    invalidate();
  }, [current, busy, post, backendCat, advance, invalidate]);

  /** Clicking a face says "that one is not them", so it leaves the group. */
  const removeFace = useCallback(
    async (detectionId: string) => {
      if (!current) return;
      setRemoved((set) => new Set(set).add(detectionId));
      await post("/clusters/remove-detections", {
        category: backendCat,
        cluster_id: current.id,
        detection_ids: [detectionId],
      });
      void queryClient.invalidateQueries({ queryKey: ["cluster-detail", category, current.id] });
    },
    [current, post, backendCat, category, queryClient],
  );

  /* ── Keyboard ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (mergeOpen) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      // Enter saves from anywhere, including out of the name field.
      if (event.key === "Enter") {
        event.preventDefault();
        void saveName();
        return;
      }
      // The letters stand down while a name is being typed.
      if (typing) return;

      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        setMergeOpen(true);
      } else if (key === "s") {
        event.preventDefault();
        advance();
      } else if (key === "x") {
        event.preventDefault();
        void notAPerson();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mergeOpen, saveName, advance, notAPerson]);

  /* ── Render ────────────────────────────────────────────────────────── */

  const total = counts?.unnamed ?? 0;
  const position = Math.min(index + acted.size + 1, Math.max(total, 1));
  const percent = total > 0 ? Math.min(100, ((index + acted.size) / total) * 100) : 0;

  // The face chip and the Flickr columns first, since those are what a
  // Flickr-backed library has; a NAS-backed one has neither, so fall back
  // to deriving the frame from the photo id.
  const cover = current?.photo_url || current?.thumb_url || current?.avatar
    || (current ? photoThumb(current) : "") || null;

  return (
    <>
      <div className="kx-reviewhead">
        <div>
          <span className="kx-eyebrow">Review</span>
          <h1 className="kx-title" style={{ fontSize: 40 }}>
            Who is this?
          </h1>
          <p className="kx-lede">
            One face group at a time, biggest first. Name it and every photo it appears in comes
            with it.
          </p>
        </div>
        <div className="kx-reviewprogress">
          <span className="kx-mono">
            {fmt.format(position)} of {fmt.format(Math.max(total, 1))}
            {current ? ` · ${fmt.format(current.photo_count)} photos in this group` : ""}
          </span>
          <span className="kx-reviewbar">
            <span style={{ width: `${percent}%` }} />
          </span>
        </div>
      </div>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}

      {!error && isPending && <KxSkeletonCards count={4} minWidth={300} height={220} />}

      {!error && !isPending && !current && (
        <KxEmpty
          title="All caught up."
          body="Every group has a name or has been set aside. New ones appear here after the next scan."
          action={{ label: "Back to people", href: `/${category}`, primary: true }}
        />
      )}

      {current && (
        <div className="kx-reviewgrid">
          <div className="kx-reviewcard">
            {cover ? (
              <img
                className="kx-reviewcover"
                src={cover}
                alt=""
                style={
                  current.cover_crop
                    ? { objectPosition: `${current.cover_crop.x}% ${current.cover_crop.y}%` }
                    : undefined
                }
              />
            ) : (
              <span className="kx-reviewcover blank" aria-hidden="true">
                ?
              </span>
            )}

            <input
              ref={inputRef}
              className="kx-reviewname"
              value={draft}
              placeholder={`Name this ${singular}`}
              aria-label={`Name this ${singular}`}
              onChange={(event) => setDraft(event.target.value)}
            />

            {(named ?? []).length > 0 && (
              <div className="kx-reusenames">
                <span className="kx-eyebrow quiet">Or reuse a name</span>
                {(named ?? []).slice(0, 8).map((person) => (
                  <button
                    key={person.id}
                    className="kx-namechip"
                    onClick={() => {
                      setDraft(person.label);
                      inputRef.current?.focus();
                    }}
                  >
                    {person.label}
                  </button>
                ))}
              </div>
            )}

            <div className="kx-reviewactions">
              <button
                className="kx-button primary tall"
                disabled={!draft.trim() || busy}
                onClick={() => void saveName()}
              >
                Save name <span className="kx-shortcut">↵</span>
              </button>
              <button className="kx-button tall" onClick={() => setMergeOpen(true)}>
                Merge into someone… <span className="kx-shortcut">M</span>
              </button>
              <button className="kx-button tall" onClick={() => advance()}>
                Skip for now <span className="kx-shortcut">S</span>
              </button>
              <button
                className="kx-button danger tall"
                disabled={busy}
                onClick={() => void notAPerson()}
              >
                Not a {singular} <span className="kx-shortcut">X</span>
              </button>
            </div>
          </div>

          <div className="kx-reviewevidence">
            <section>
              <span className="kx-eyebrow quiet">
                Faces in this group · click one to remove it
              </span>
              {detailPending ? (
                <KxSkeletonCards count={6} minWidth={62} height={62} />
              ) : (
                <div className="kx-facestrip">
                  {items.slice(0, FACE_CHIPS).map((item) => (
                    <button
                      key={item.id}
                      className="kx-facechip"
                      title="Not them — take this one out of the group"
                      aria-label="Remove this face from the group"
                      onClick={() => void removeFace(item.id)}
                    >
                      <img src={faceThumb(item)} alt="" />
                    </button>
                  ))}
                  {items.length > FACE_CHIPS && (
                    <span className="kx-facechip more">+{fmt.format(items.length - FACE_CHIPS)}</span>
                  )}
                </div>
              )}
            </section>

            <section>
              <span className="kx-eyebrow quiet">Where they show up</span>
              {detailPending ? (
                <KxSkeletonCards count={6} minWidth={120} height={120} />
              ) : (
                <div className="kx-reviewphotos">
                  {photos.slice(0, PHOTO_TILES).map((photo) => (
                    <button
                      key={photo.photo_id}
                      onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
                      aria-label={photo.photo_title || "Open photo"}
                    >
                      <img src={photoThumb(photo)} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* TODO: the design's duplicate-pair card — two groups side by side
                with a similarity percentage and Merge / Different people — needs
                candidate pairs from the backend. Nothing compares one cluster's
                centroid against another, so the card is left out rather than
                shown with a made-up score. See use-review.ts. Merging by hand
                is still one keystroke away on M. */}
            <p className="kx-status">
              Not who you thought? <Link href={`/${category}`}>Everyone with a name</Link> is on the
              people screen.
            </p>
          </div>
        </div>
      )}

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        onSelect={(targetId) => void mergeInto(targetId)}
        sourceCluster={current}
        clusters={(named ?? []).map<ClusterSummary>((person) => ({
          id: person.id,
          label: person.label,
          det_count: 0,
          photo_count: 0,
          avatar: person.avatar,
        }))}
      />
    </>
  );
}
