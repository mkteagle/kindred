"use client";

import { useState } from "react";
import { forgetThumbnail, loadedThumbnail, rememberThumbnail, thumbnailUrlIsFresh } from "@/lib/image-delivery";
import { thumbUrl } from "@/components/kx/photos";

export type ThumbnailPriority = "visible" | "nearby" | "deferred" | "automatic";

/** Display a bounded thumbnail with one fallback to Kindred's delivery route. */
export function OptimizedPhoto({
  photoId, video = false, alt = "", className, thumbnailUrl,
  priority = "automatic", onSettled,
}: {
  photoId: string;
  video?: boolean;
  alt?: string;
  className?: string;
  thumbnailUrl?: string;
  priority?: ThumbnailPriority;
  onSettled?: (id: string) => void;
}) {
  const [failedDirect, setFailedDirect] = useState<string[]>([]);
  const [result, setResult] = useState<{ photoId: string; url: string; loaded: boolean }>();
  const fallback = thumbUrl({ photo_id: photoId, media_kind: video ? "video" : "photo" });
  const remembered = loadedThumbnail(photoId, thumbnailUrl);
  const preferred = [remembered, thumbnailUrl]
    .find(url => url && !failedDirect.includes(url) && thumbnailUrlIsFresh(url));
  const displayed = result?.photoId === photoId && result.loaded ? result.url : undefined;
  const url = displayed ?? preferred ?? fallback;
  const resolved = result?.photoId === photoId && result.url === url;
  const loaded = resolved && result.loaded;
  const unavailable = resolved && !result.loaded;
  const wasLoaded = loaded || (!unavailable && remembered === url);
  const request = priority !== "deferred" || wasLoaded;
  const state = wasLoaded ? "loaded" : unavailable ? "unavailable" : "loading";

  return (
    <span className="kx-photo-thumbnail" data-state={state}>
      {!wasLoaded && (
        <span className="kx-photo-thumbnail-placeholder" aria-hidden="true"
          title={unavailable ? "Thumbnail unavailable" : undefined}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="m3 16 5-5 4 4 3-3 6 6" />
            <circle cx="15.5" cy="8.5" r="1" />
          </svg>
        </span>
      )}
      {request && !unavailable && (
        <img key={url} src={url} alt={alt} className={className}
          loading={priority === "automatic" ? "lazy" : "eager"}
          fetchPriority={priority === "visible" ? "high" : priority === "nearby" ? "low" : "auto"}
          decoding="async" draggable={false} referrerPolicy={url !== fallback ? "no-referrer" : undefined}
          onLoad={() => {
            rememberThumbnail(photoId, thumbnailUrl || fallback, url);
            setResult({ photoId, url, loaded: true });
            onSettled?.(photoId);
          }}
          onError={() => {
            forgetThumbnail(photoId, url);
            if (url !== fallback) {
              setFailedDirect(failed => [...failed, url]);
              setResult(current => current?.url === url ? undefined : current);
            }
            else {
              setResult({ photoId, url, loaded: false });
              onSettled?.(photoId);
            }
          }} />
      )}
    </span>
  );
}
