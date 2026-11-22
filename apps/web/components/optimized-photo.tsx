"use client";

import { useEffect, useRef, useState } from "react";
import { canPrefetch, prefetchImage, rememberThumbnail } from "@/lib/image-delivery";
import { thumbUrl } from "@/components/kx/photos";

/** Grid tiles use the same bounded URL as Search and the photo viewer. */
export function OptimizedPhoto({ photoId, video = false, alt = "", className, thumbnailUrl }: {
  photoId: string; video?: boolean; alt?: string; className?: string; thumbnailUrl?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const [near, setNear] = useState(false);
  const [warmed, setWarmed] = useState("");
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const directThumbnail = thumbnailUrl && thumbnailUrl !== failedThumbnail ? thumbnailUrl : undefined;
  const url = directThumbnail ?? thumbUrl({ photo_id: photoId, media_kind: video ? "video" : "photo" });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const viewport = new IntersectionObserver(entries => {
      setVisible(entries[0].isIntersecting);
    });
    const ahead = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), {
      rootMargin: `${Math.round(window.innerHeight * 1.5)}px 0px`,
    });
    viewport.observe(node);
    ahead.observe(node);
    return () => { viewport.disconnect(); ahead.disconnect(); };
  }, []);

  useEffect(() => {
    if (!near || visible || warmed === url || !canPrefetch()) return;
    const controller = new AbortController();
    void prefetchImage(url, controller.signal).then((loaded) => {
      if (loaded && !controller.signal.aborted) setWarmed(url);
    });
    return () => controller.abort();
  }, [near, visible, url, warmed]);

  return <img ref={ref} src={visible || warmed === url ? url : undefined}
    alt={alt} className={className} loading={visible ? "eager" : "lazy"} decoding="async" draggable={false}
    referrerPolicy={directThumbnail ? "no-referrer" : undefined}
    onError={directThumbnail ? () => setFailedThumbnail(directThumbnail) : undefined}
    onLoad={() => { rememberThumbnail(photoId, url); setWarmed(url); }} />;
}
