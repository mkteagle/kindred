"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { PhotoTagDialog } from "@/components/photo-tag-dialog";
import { FocalPointDialog } from "@/components/focal-point-dialog";
import { MergeDialog } from "@/components/dialogs";
import type {
  ClusterDetail,
  ClusterSummary,
  ClustersSummaryResponse,
  Detection,
} from "@/types";
import { BACKEND, fmt, toBackendCategory } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";
import { photoThumb, faceThumb } from "@/lib/photo-url";
import { AlertIcon } from "@/components/kx/icons";
import { useNamedPeople } from "@/components/kx/use-people";
import {
  KxEmpty,
  KxErrorBanner,
  KxSkeletonCards,
  KxSkeletonGrid,
  KxSkeletonRows,
} from "@/components/kx/states";
import { tileSpan } from "@/components/kx/photos";

/**
 * How many photographs reach the DOM at once.
 *
 * The cluster endpoint hands back every detection in the group in one
 * response — for a well-photographed person that is 646 faces across 611
 * photos — and the page used to render all of it on first paint: 1,267 `<img>`
 * elements, every one of them a request. Nothing was broken, but the browser
 * spent a minute working through the queue and the page read as "the
 * thumbnails are missing".
 *
 * So the photographs arrive a screenful at a time, the same shape the library
 * uses: an IntersectionObserver ahead of the fold, plus an explicit button for
 * when the observer never fires. Paging is client-side over the response we
 * already hold, because there is nothing to page against on the server yet.
 *
 * TODO: `GET /clusters/{category}/{cluster_id}/photos?cursor=&limit=` — one
 * photo per row, keyset-paged like `/library/photos`, so a group of 600 costs
 * one small request instead of one very large one. Until it exists the whole
 * group (including every base64 face chip) still crosses the wire in a single
 * response; this only stops it all being decoded at once.
 */
const PHOTO_PAGE = 60;

/** Face chips revealed per step, once the disclosure is opened. */
const FACE_PAGE = 48;

const COPY: Record<
  string,
  { eyebrow: string; singular: string; plural: string; detections: string; faces: string }
> = {
  people: {
    eyebrow: "Person",
    singular: "person",
    plural: "people",
    detections: "faces",
    faces: "Faces in this group · click one for its options",
  },
  animals: {
    eyebrow: "Animal",
    singular: "animal",
    plural: "animals",
    detections: "detections",
    faces: "Detections in this group · click one for its options",
  },
  vehicles: {
    eyebrow: "Vehicle",
    singular: "vehicle",
    plural: "vehicles",
    detections: "detections",
    faces: "Detections in this group · click one for its options",
  },
};

/** One photo per detection — a group of 646 faces is not 646 photographs. */
function uniquePhotos(items: Detection[]): Detection[] {
  const seen = new Map<string, Detection>();
  for (const item of items) if (!seen.has(item.photo_id)) seen.set(item.photo_id, item);
  return Array.from(seen.values());
}

export default function ClusterDetailPage() {
  const params = useParams();
  const router = useRouter();
  // The path is the fallback source of both ids. useParams() has come back
  // empty here in the production build, and an empty clusterId disables the
  // queries below -- so the screen sat on its loading state forever without
  // ever asking for the group. The pathname is always /<category>/<id>.
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const category = (params.category as string) || segments[0] || "people";
  const copy = COPY[category] ?? COPY.people;
  const backendCat = toBackendCategory(category);
  const clusterId = (params.clusterId as string) || segments[1] || "";
  const queryClient = useQueryClient();
  const { openLightbox } = useLightbox();

  const [coverPickMode, setCoverPickMode] = useState(false);
  const [focalPickPhoto, setFocalPickPhoto] = useState<string | null>(null);
  const [tagPhotoId, setTagPhotoId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [facesOpen, setFacesOpen] = useState(false);
  const [faceLimit, setFaceLimit] = useState(FACE_PAGE);
  const [visible, setVisible] = useState(PHOTO_PAGE);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<ClusterSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const sentinel = useRef<HTMLDivElement>(null);

  /* ── Data ──────────────────────────────────────────────────────────── */

  // The group's own record carries its label, so there is no second request
  // for the whole category summary just to find out what this one is called.
  const {
    data: detail,
    isPending,
    error,
    refetch,
  } = useQuery<ClusterDetail>({
    queryKey: ["cluster-detail", category, clusterId],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/${backendCat}/${clusterId}`);
      if (!response.ok) throw new Error("This group could not be loaded.");
      return response.json();
    },
    enabled: Boolean(clusterId),
  });

  const { data: named } = useNamedPeople(backendCat);

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const photos = useMemo(() => uniquePhotos(items), [items]);

  const label = detail?.label ?? null;
  const name = label || (isPending ? "" : `Unnamed ${copy.singular}`);

  const avatarDetectionId = detail?.avatar_detection_id || null;
  const coverPhotoId = detail?.cover_photo_id || null;
  const coverCrop = detail?.cover_crop || null;

  const coverPhoto = coverPhotoId ? items.find((i) => i.photo_id === coverPhotoId) : null;
  const avatarDetection = avatarDetectionId
    ? items.find((i) => i.id === avatarDetectionId)
    : items.length > 0
      ? [...items].sort((a, b) => b.det_score - a.det_score)[0]
      : null;

  // The card's picture: the chosen cover if there is one, otherwise the
  // clearest face. Both are already in the response, so neither costs a
  // request beyond the one image.
  const heroSrc = coverPhoto
    ? photoThumb(coverPhoto)
    : avatarDetection
      ? faceThumb(avatarDetection)
      : null;

  // Stepping with ←/→ should reach every photo in the group, not only the ones
  // currently painted — the list is data, not elements, so it costs nothing.
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

  /* ── Progressive paint ─────────────────────────────────────────────── */

  useEffect(() => {
    setVisible(PHOTO_PAGE);
    setFacesOpen(false);
    setFaceLimit(FACE_PAGE);
    setDraft(null);
    setCoverPickMode(false);
  }, [clusterId, category]);

  const shown = photos.slice(0, visible);
  const hasMore = visible < photos.length;

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible((current) => current + PHOTO_PAGE);
      },
      { rootMargin: "800px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, visible]);

  /* ── Cover, crop and avatar ────────────────────────────────────────── */

  const invalidateSummaries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["clusters-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["kx-cluster-browse", backendCat] });
    void queryClient.invalidateQueries({ queryKey: ["kx-review-queue", backendCat] });
    void queryClient.invalidateQueries({ queryKey: ["kx-named-people", backendCat] });
  }, [queryClient, backendCat]);

  const setAvatarMutation = useMutation({
    mutationFn: (payload: {
      avatar_detection_id?: string | null;
      cover_photo_id?: string | null;
      cover_crop?: { x: number; y: number } | null;
    }) =>
      fetch(`${BACKEND}/clusters/set-avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: backendCat, cluster_id: clusterId, ...payload }),
      }).then((response) => {
        if (!response.ok) throw new Error(`set-avatar failed: ${response.status}`);
        return response.json();
      }),
    onSuccess: (_result, payload) => {
      queryClient.setQueryData<ClusterDetail>(
        ["cluster-detail", category, clusterId],
        (old) =>
          old && {
            ...old,
            avatar_detection_id:
              payload.avatar_detection_id !== undefined
                ? payload.avatar_detection_id
                : old.avatar_detection_id,
            cover_photo_id:
              payload.cover_photo_id !== undefined ? payload.cover_photo_id : old.cover_photo_id,
            cover_crop: payload.cover_crop !== undefined ? payload.cover_crop : old.cover_crop,
          },
      );
      // The browse grid shows the same picture; keep it in step rather than
      // making the user reload /people to see what they just chose.
      queryClient.setQueryData<ClustersSummaryResponse>(
        ["clusters-summary", category],
        (old) => {
          if (!old?.clusters) return old;
          return {
            ...old,
            clusters: old.clusters.map((cluster) => {
              if (cluster.id !== clusterId) return cluster;
              const updated = { ...cluster };
              if (payload.cover_photo_id !== undefined) {
                const photo = items.find((i) => i.photo_id === payload.cover_photo_id);
                if (photo) {
                  updated.thumb_url = photo.thumb_url;
                  updated.photo_url = photo.photo_url;
                }
              }
              if (payload.cover_crop !== undefined) updated.cover_crop = payload.cover_crop;
              if (payload.avatar_detection_id !== undefined) {
                const detection = items.find((i) => i.id === payload.avatar_detection_id);
                if (detection) updated.avatar = faceThumb(detection);
              }
              return updated;
            }),
          };
        },
      );
      invalidateSummaries();
    },
  });

  const handleSetCover = (photoId: string) => {
    const best = items
      .filter((i) => i.photo_id === photoId)
      .sort((a, b) => b.det_score - a.det_score)[0];
    setAvatarMutation.mutate({ cover_photo_id: photoId, avatar_detection_id: best?.id });
    setCoverPickMode(false);
    setFocalPickPhoto(photoId);
  };

  const handleClearCover = () => {
    setAvatarMutation.mutate({ cover_photo_id: null, cover_crop: null });
    setFocalPickPhoto(null);
  };

  /* ── Detections ────────────────────────────────────────────────────── */

  const handleRemoveDetection = useCallback(
    (detectionId: string) => {
      queryClient.setQueryData<ClusterDetail>(
        ["cluster-detail", category, clusterId],
        (old) => old && { ...old, items: old.items.filter((i) => i.id !== detectionId) },
      );
      void fetch(`${BACKEND}/clusters/remove-detections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: backendCat,
          cluster_id: clusterId,
          detection_ids: [detectionId],
        }),
      }).then(invalidateSummaries);
    },
    [queryClient, category, clusterId, backendCat, invalidateSummaries],
  );

  /**
   * Take a whole photo out of this group.
   *
   * A cluster is a set of detections, not of photos, so a photo belongs to it
   * once for every face in the frame that was matched -- usually one, but a
   * mis-merge can leave several. Removing "the photo" therefore means removing
   * every detection of this cluster inside it; dropping only the first would
   * leave the photo in the group and look like the button did nothing.
   *
   * Each removed detection becomes its own unnamed cluster, so nothing is
   * deleted and the face can be re-filed from the review screen.
   */
  const handleRemovePhoto = useCallback(
    (photoId: string) => {
      const detectionIds = items.filter((i) => i.photo_id === photoId).map((i) => i.id);
      if (!detectionIds.length) return;

      queryClient.setQueryData<ClusterDetail>(
        ["cluster-detail", category, clusterId],
        (old) => old && { ...old, items: old.items.filter((i) => i.photo_id !== photoId) },
      );
      void fetch(`${BACKEND}/clusters/remove-detections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: backendCat,
          cluster_id: clusterId,
          detection_ids: detectionIds,
        }),
      }).then(invalidateSummaries);
    },
    [items, queryClient, category, clusterId, backendCat, invalidateSummaries],
  );

  /* ── Naming, merging, dismissing ───────────────────────────────────── */

  const post = useCallback(async (path: string, body: unknown) => {
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
  }, []);

  const nameValue = draft ?? label ?? "";
  const nameChanged = nameValue.trim().length > 0 && nameValue.trim() !== (label ?? "");

  const saveName = useCallback(async () => {
    const next = nameValue.trim();
    if (!next || busy) return;
    await post("/clusters/label", {
      category: backendCat,
      cluster_id: clusterId,
      name: next,
    });
    queryClient.setQueryData<ClusterDetail>(
      ["cluster-detail", category, clusterId],
      (old) => old && { ...old, label: next },
    );
    setDraft(null);
    invalidateSummaries();
  }, [nameValue, busy, post, backendCat, clusterId, queryClient, category, invalidateSummaries]);

  const confirmMerge = useCallback(async () => {
    if (!mergeTarget) return;
    await post("/clusters/merge", {
      category: backendCat,
      source_id: clusterId,
      target_id: mergeTarget.id,
    });
    setMergeTarget(null);
    invalidateSummaries();
    router.push(`/${category}/${mergeTarget.id}`);
  }, [mergeTarget, post, backendCat, clusterId, invalidateSummaries, router, category]);

  const dismissGroup = useCallback(async () => {
    await post("/clusters/dismiss", { category: backendCat, cluster_id: clusterId });
    invalidateSummaries();
    router.push(`/${category}`);
  }, [post, backendCat, clusterId, invalidateSummaries, router, category]);

  /* ── Render ────────────────────────────────────────────────────────── */

  const mergeCandidates = useMemo<ClusterSummary[]>(
    () =>
      (named ?? [])
        .filter((person) => person.id !== clusterId)
        .map((person) => ({
          id: person.id,
          label: person.label,
          det_count: 0,
          photo_count: 0,
          avatar: person.avatar,
        })),
    [named, clusterId],
  );

  const reuseNames = (named ?? []).filter((person) => person.id !== clusterId).slice(0, 6);

  /** The group is on screen and can be acted on. */
  const loaded = !isPending && !error;

  return (
    <main className="kx-page">
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          <Link className="kx-backlink" href={`/${category}`}>
            ← All {copy.plural}
          </Link>
          <span className="kx-eyebrow">{copy.eyebrow}</span>
          {/* Until the group has actually loaded the heading says nothing about
              it: "Unnamed person" on a request that failed is a claim, not a
              placeholder. */}
          <h1 className="kx-title">{error ? "This group" : name || "…"}</h1>
          <p className="kx-lede">
            {error
              ? "It could not be loaded just now. Retry below, or go back to the grid."
              : isPending
                ? "Fetching the group."
                : label
                  ? `Every photo ${label} turns up in, with the tools to keep the group honest.`
                  : "Nobody has named this group yet. Give it a name and every photo comes with it."}
          </p>
        </div>
        {loaded && (
          <div className="kx-pagehead-pills">
            {/* Worded as the browse grid words it: a group is counted in photos. */}
            <span className="kx-pill">{fmt.format(photos.length)} photos</span>
            <span className="kx-pill">
              {fmt.format(items.length)} {copy.detections}
            </span>
          </div>
        )}
      </div>

      {error && (
        <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />
      )}

      {mergeTarget && (
        <div className="kx-banner danger" role="alert">
          <AlertIcon />
          <span className="kx-banner-copy">
            <strong>
              Merge {name} into {mergeTarget.label || `an unnamed ${copy.singular}`}?
            </strong>
            <span className="kx-mono">
              Every photo in this group moves across. This cannot be undone.
            </span>
          </span>
          <span className="kx-banner-actions">
            <button className="kx-button" onClick={() => setMergeTarget(null)}>
              Cancel
            </button>
            <button className="kx-button primary" disabled={busy} onClick={() => void confirmMerge()}>
              Merge
            </button>
          </span>
        </div>
      )}

      {/* Grid-shaped, never a spinner: the placeholder is the shape of the
          thing it stands in for, so nothing jumps when the group lands. */}
      {isPending && (
        <>
          <KxSkeletonRows count={1} height={116} />
          <KxSkeletonGrid count={18} />
        </>
      )}

      {/* ── Identity: the picture, the name, and the four group-level tools ── */}
      <section className="kx-card" hidden={!loaded}>
        <div className="kx-cardhead">
          {heroSrc ? (
            <img
              className={`kx-clustercover ${category === "people" ? "" : "square"}`.trim()}
              src={heroSrc}
              alt=""
              style={
                coverPhoto && coverCrop
                  ? { objectPosition: `${coverCrop.x}% ${coverCrop.y}%` }
                  : undefined
              }
            />
          ) : (
            <span className="kx-clustercover blank" aria-hidden="true">
              ?
            </span>
          )}
          <div className="kx-row-info">
            <h2>{name || "…"}</h2>
            <span className="kx-mono">
              {fmt.format(photos.length)} photos · {fmt.format(items.length)} {copy.detections}
              {coverPhotoId ? " · cover chosen" : ""}
            </span>
          </div>
          <div className="kx-cardhead-actions">
            <button
              className={`kx-button ${coverPickMode ? "primary" : ""}`.trim()}
              aria-pressed={coverPickMode}
              onClick={() => {
                setCoverPickMode(!coverPickMode);
                if (coverPickMode) setFocalPickPhoto(null);
              }}
            >
              {coverPickMode ? "Done picking" : "Set cover"}
            </button>
            {coverPhotoId && (
              <button className="kx-button" onClick={handleClearCover}>
                Reset cover
              </button>
            )}
            <button
              className="kx-button"
              disabled={mergeCandidates.length === 0}
              onClick={() => setMergeOpen(true)}
            >
              Merge into…
            </button>
            <ConfirmButton
              className="kx-button danger"
              label={`Not a ${copy.singular}`}
              question="Remove this group from the library?"
              disabled={busy}
              onConfirm={() => void dismissGroup()}
            />
          </div>
        </div>

        <div className="kx-row">
          <span className="kx-eyebrow quiet">Name</span>
          <form
            className="kx-nameform"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <input
              className="kx-input"
              value={nameValue}
              placeholder={`Name this ${copy.singular}`}
              aria-label={`Name this ${copy.singular}`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="kx-button primary" type="submit" disabled={!nameChanged || busy}>
              {label ? "Save name" : "Name them"}
            </button>
            {draft !== null && draft !== (label ?? "") && (
              <button className="kx-button" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            )}
          </form>
          {reuseNames.length > 0 && (
            <div className="kx-namerow">
              <span className="kx-eyebrow quiet">Or reuse</span>
              {reuseNames.map((person) => (
                <button
                  key={person.id}
                  className="kx-namechip"
                  type="button"
                  onClick={() => setDraft(person.label)}
                >
                  {person.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Detections, folded away ──────────────────────────────────────
          646 face chips are 646 base64 images. They cost no requests, but
          decoding them all is what turns a page into a stutter — so they stay
          behind the disclosure, and even open they arrive a screenful at a
          time. */}
      {/* A button and a panel rather than <details>: a controlled `open` prop
          fights the element's own state, and an uncontrolled one cannot be
          reset when the route changes to another group. */}
      <section className="kx-disclosure" data-open={facesOpen} hidden={items.length === 0}>
        <button
          className="kx-disclosure-summary"
          aria-expanded={facesOpen}
          aria-controls="cluster-detections"
          onClick={() => setFacesOpen((current) => !current)}
        >
          <span className="kx-eyebrow quiet">{copy.faces}</span>
          <span className="kx-mono">{fmt.format(items.length)}</span>
        </button>
        {facesOpen && (
          <div className="kx-disclosure-body" id="cluster-detections">
            {isPending ? (
              <KxSkeletonCards count={8} minWidth={62} height={62} />
            ) : (
              <>
                <div className="kx-facestrip">
                  {items.slice(0, faceLimit).map((item) => (
                    <FaceChip
                      key={item.id}
                      item={item}
                      isAvatar={avatarDetectionId === item.id}
                      onSetAvatar={() =>
                        setAvatarMutation.mutate({ avatar_detection_id: item.id })
                      }
                      onClearAvatar={() =>
                        setAvatarMutation.mutate({ avatar_detection_id: null })
                      }
                      onRemove={() => handleRemoveDetection(item.id)}
                    />
                  ))}
                </div>
                {faceLimit < items.length && (
                  <div className="kx-loadmore">
                    <button
                      className="kx-button"
                      onClick={() => setFaceLimit((current) => current + FACE_PAGE)}
                    >
                      Show {fmt.format(Math.min(FACE_PAGE, items.length - faceLimit))} more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Photographs ─────────────────────────────────────────────────── */}
      <section className="kx-clusterphotos" hidden={!loaded}>
        <div className="kx-sectionhead">
          <span className="kx-eyebrow quiet">
            {coverPickMode ? "Pick the picture that represents them" : "Where they show up"}
          </span>
          <span className="kx-mono">{fmt.format(photos.length)} photos</span>
        </div>

        {coverPickMode && (
          <div className="kx-banner" role="status">
            <span className="kx-banner-copy">
              <strong>Choose a cover.</strong>
              <span className="kx-mono">
                Click a photo to put it on this {copy.singular}&rsquo;s card.
              </span>
            </span>
            <button className="kx-button" onClick={() => setCoverPickMode(false)}>
              Cancel
            </button>
          </div>
        )}

        {loaded && photos.length === 0 && (
          <KxEmpty
            title="Nothing in this group."
            body="Every detection has been taken out of it. Run a scan and it will fill again, or set the group aside."
            action={{ label: `All ${copy.plural}`, href: `/${category}`, primary: true }}
          />
        )}

        <div className="kx-daygrid">
          {shown.map((photo, index) => (
            <PhotoTile
              key={photo.photo_id}
              item={photo}
              span={tileSpan(index)}
              onRemove={() => handleRemovePhoto(photo.photo_id)}
              isCover={coverPhotoId === photo.photo_id}
              coverPickMode={coverPickMode}
              onSetCover={() => handleSetCover(photo.photo_id)}
              onAdjustCrop={() => setFocalPickPhoto(photo.photo_id)}
              onTag={() => setTagPhotoId(photo.photo_id)}
              onOpen={() => openLightbox(photo.photo_id, lightboxPhotos)}
            />
          ))}
        </div>

        {/* An explicit control as well as the observer: infinite scroll fails
            silently if the sentinel never enters the viewport. */}
        {hasMore && (
          <div className="kx-loadmore">
            <button className="kx-button" onClick={() => setVisible((c) => c + PHOTO_PAGE)}>
              Load {fmt.format(Math.min(PHOTO_PAGE, photos.length - visible))} more photos
            </button>
          </div>
        )}
        {!hasMore && photos.length > PHOTO_PAGE && (
          <p className="kx-status">That&rsquo;s all {fmt.format(photos.length)}.</p>
        )}
        <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      </section>

      {category === "people" && clusterId && <AppearsWith clusterId={clusterId} />}

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        onSelect={(targetId) => {
          setMergeOpen(false);
          setMergeTarget(mergeCandidates.find((c) => c.id === targetId) ?? null);
        }}
        sourceCluster={{
          id: clusterId,
          label,
          det_count: items.length,
          photo_count: photos.length,
          avatar: heroSrc,
        }}
        clusters={mergeCandidates}
      />

      {tagPhotoId && (
        <PhotoTagDialog
          photoId={tagPhotoId}
          onClose={() => setTagPhotoId(null)}
          preselectedClusterId={clusterId}
          preselectedCategory={backendCat}
        />
      )}

      {focalPickPhoto &&
        (() => {
          const photo = photos.find((p) => p.photo_id === focalPickPhoto);
          if (!photo) return null;
          return (
            <FocalPointDialog
              photoUrl={photoThumb(photo, "b")}
              photoTitle={photo.photo_title || ""}
              initialCrop={coverCrop}
              onSetFocalPoint={(crop) => setAvatarMutation.mutate({ cover_crop: crop })}
              onClose={() => setFocalPickPhoto(null)}
            />
          );
        })()}
    </main>
  );
}

/* ── A destructive button that asks first ───────────────────────────── */

/**
 * Two clicks, not one, and the second one says what it will do. It disarms
 * itself after a few seconds so a half-pressed Dismiss does not lie in wait.
 */
function ConfirmButton({
  label,
  question,
  className,
  disabled,
  onConfirm,
}: {
  label: string;
  question: string;
  className: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="kx-confirm" role="group" aria-label={question}>
      <span className="kx-mono">{question}</span>
      <button
        className={className}
        disabled={disabled}
        aria-label={`Yes — ${label.toLowerCase()}`}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        Yes
      </button>
      <button className="kx-button compact" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/* ── One detection ──────────────────────────────────────────────────── */

/**
 * A face chip is a claim that this detection belongs to the group. The menu is
 * where that claim can be withdrawn, or promoted to the group's avatar. It
 * opens on click rather than right-click, which was the old page's only route
 * to it and reachable from no keyboard at all.
 */
function FaceChip({
  item,
  isAvatar,
  onSetAvatar,
  onClearAvatar,
  onRemove,
}: {
  item: Detection;
  isAvatar: boolean;
  onSetAvatar: () => void;
  onClearAvatar: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="kx-facewrap" ref={wrap}>
      <button
        className={`kx-facechip ${isAvatar ? "is-avatar" : ""}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          isAvatar
            ? "The group's chosen face — open its options"
            : "One face in this group — open its options"
        }
        onClick={() => setOpen((current) => !current)}
      >
        <img src={faceThumb(item)} alt="" loading="lazy" />
      </button>

      {isAvatar && (
        <span className="kx-facebadge" aria-hidden="true">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </span>
      )}

      {open && (
        <div className="kx-menu face" role="menu">
          <a
            className="kx-menu-item"
            role="menuitem"
            href={item.flickr_url || item.photo_url || photoThumb(item)}
            target="_blank"
            rel="noreferrer"
          >
            Open the photo
          </a>
          <button
            className="kx-menu-item"
            role="menuitem"
            onClick={() => {
              if (isAvatar) onClearAvatar();
              else onSetAvatar();
              setOpen(false);
            }}
          >
            {isAvatar ? "Stop using this face" : "Use this face on the card"}
          </button>
          <div className="kx-menu-divider" />
          <ConfirmButton
            className="kx-menu-item danger"
            label="Not them — remove"
            question="Take this one out?"
            onConfirm={() => {
              onRemove();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ── One photograph ─────────────────────────────────────────────────── */

function PhotoTile({
  item,
  span,
  isCover,
  coverPickMode,
  onSetCover,
  onAdjustCrop,
  onTag,
  onOpen,
  onRemove,
}: {
  item: Detection;
  span: string;
  isCover: boolean;
  coverPickMode: boolean;
  onSetCover: () => void;
  onAdjustCrop: () => void;
  onTag: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const title = item.photo_title || "Untitled";

  return (
    <div
      className={`kx-clustertile ${span} ${isCover ? "is-cover" : ""}`.trim()}
      data-photo-id={item.photo_id}
    >
      <button
        className="kx-tile"
        aria-label={coverPickMode ? `Use “${title}” as the cover` : `Open “${title}”`}
        onClick={coverPickMode ? onSetCover : onOpen}
      >
        <img src={photoThumb(item)} alt="" loading="lazy" draggable={false} />
      </button>

      {isCover && <span className="kx-tilebadge">Cover</span>}

      {!coverPickMode && (
        <button className="kx-tileaction tag" onClick={onTag} aria-label={`Tag faces in “${title}”`}>
          Tag
        </button>
      )}

      {!coverPickMode && (
        <TileRemove title={title} onConfirm={onRemove} />
      )}

      {isCover && !coverPickMode && (
        <button
          className="kx-tileaction crop"
          onClick={onAdjustCrop}
          aria-label="Adjust how the cover is cropped"
        >
          Adjust crop
        </button>
      )}
    </div>
  );
}

/**
 * "Not them" on a photo tile, with its own confirm.
 *
 * The group-level ConfirmButton spells the question out in a sentence, which
 * does not fit a 150px tile, so this asks by turning into Yes/No in place. It
 * disarms after six seconds like the others, so a tile left hovered does not
 * stay one stray click from changing the group.
 */
function TileRemove({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button
        className="kx-tileaction remove"
        onClick={() => setArmed(true)}
        aria-label={`Remove “${title}” from this group`}
      >
        Not them
      </button>
    );
  }

  return (
    <span className="kx-tileconfirm" role="group" aria-label={`Remove “${title}” from this group?`}>
      <button
        className="kx-tileaction confirm"
        onClick={onConfirm}
        aria-label={`Yes — remove “${title}” from this group`}
      >
        Remove
      </button>
      <button
        className="kx-tileaction cancel"
        onClick={() => setArmed(false)}
        aria-label="Keep it in this group"
      >
        Keep
      </button>
    </span>
  );
}

/* ── Who else is in the frame ───────────────────────────────────────── */

interface AppearsWithPerson {
  cluster_id: string;
  category?: string;
  label: string | null;
  shared_photos: number;
  avatar: string | null;
}

interface TogetherPhoto {
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

function SharedPhotos({
  clusterId,
  otherClusterId,
}: {
  clusterId: string;
  otherClusterId: string;
}) {
  const { openLightbox } = useLightbox();
  const { data, isPending } = useQuery<{ photos: TogetherPhoto[] }>({
    queryKey: ["together", clusterId, otherClusterId],
    queryFn: async () => {
      const response = await fetch(
        `${BACKEND}/photos/together?people=${clusterId},${otherClusterId}&limit=30`,
      );
      if (!response.ok) throw new Error("Those photos could not be loaded.");
      return response.json();
    },
  });

  if (isPending) return <KxSkeletonGrid count={8} tile={104} gap={6} />;

  const photos = data?.photos ?? [];
  if (photos.length === 0) return <p className="kx-status">No shared photos found.</p>;

  const lightboxPhotos: LightboxPhoto[] = photos.map((photo) => ({
    photo_id: photo.photo_id,
    thumb_url: photoThumb(photo),
    photo_url: photo.photo_url,
    flickr_url: photo.flickr_url,
    photo_title: photo.photo_title,
  }));

  return (
    /* The mosaic again, at a smaller step: fixed rows, so the track height
       comes from the grid rather than from whatever shape the source frame
       happens to be. */
    <div
      className="kx-daygrid"
      style={{ ["--tile" as string]: "104px", ["--gap" as string]: "6px", marginBottom: 0 }}
    >
      {photos.map((photo) => (
        <button
          key={photo.photo_id}
          className="kx-tile"
          aria-label={photo.photo_title || "Open photo"}
          onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
        >
          <img src={photoThumb(photo)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

function AppearsWith({ clusterId }: { clusterId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isPending } = useQuery<{ appears_with: AppearsWithPerson[] }>({
    queryKey: ["appears-with", clusterId],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/photos/appears-with?cluster_id=${clusterId}`);
      if (!response.ok) throw new Error("That could not be loaded.");
      return response.json();
    },
  });

  const people = (data?.appears_with ?? []).filter(
    (person) => person.label || person.category === "pets" || person.category === "animals",
  );

  if (isPending || people.length === 0) return null;

  return (
    <section className="kx-card">
      <div className="kx-cardhead">
        <h2>Often in the same frame</h2>
        <span className="kx-mono">{fmt.format(people.length)}</span>
      </div>
      {people.map((person) => {
        const isOpen = expanded === person.cluster_id;
        const route = person.category === "pets" || person.category === "animals" ? "animals" : "people";
        const label = person.label || (route === "animals" ? "An animal" : "Someone unnamed");
        return (
          <div key={person.cluster_id} className="kx-row kx-appearsrow">
            <div className="kx-appearsrow-head">
              {person.avatar ? (
                <img className="kx-avatar" src={person.avatar} alt="" loading="lazy" />
              ) : (
                <span className="kx-avatar" aria-hidden="true">
                  ?
                </span>
              )}
              <span className="kx-row-info">
                <strong>{label}</strong>
                <span className="kx-mono">
                  {fmt.format(person.shared_photos)} photos together
                </span>
              </span>
              <span className="kx-row-actions">
                <button
                  className="kx-button compact"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : person.cluster_id)}
                >
                  {isOpen ? "Hide" : "Preview"}
                </button>
                <Link className="kx-button compact" href={`/${route}/${person.cluster_id}`}>
                  Their page
                </Link>
                <Link
                  className="kx-button compact"
                  href={`/together?people=${clusterId},${person.cluster_id}`}
                >
                  All {fmt.format(person.shared_photos)}
                </Link>
              </span>
            </div>
            {isOpen && (
              <SharedPhotos clusterId={clusterId} otherClusterId={person.cluster_id} />
            )}
          </div>
        );
      })}
    </section>
  );
}
