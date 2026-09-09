"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND } from "@/lib/constants";
import { canPrefetch, imageWidth, photoImageUrl, prefetchImage, rememberThumbnail } from "@/lib/image-delivery";

/** CSS owns the tile aspect ratio. Measure its actual box for mosaic spans,
 * sidebars and DPR instead of assuming every grid tile has the same width. */
export function OptimizedPhoto({ photoId, video = false, alt = "", className }: {
  photoId: string; video?: boolean; alt?: string; className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [near, setNear] = useState(false);
  const [warmed, setWarmed] = useState("");
  const url = video ? `${BACKEND}/photos/${encodeURIComponent(photoId)}/local?variant=thumb` : photoImageUrl(photoId, width);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(imageWidth(node.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 3), 960));
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    window.addEventListener("resize", measure);
    const viewport = new IntersectionObserver(entries => {
      setVisible(entries[0].isIntersecting);
    });
    const ahead = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), {
      rootMargin: `${Math.round(window.innerHeight * 1.5)}px 0px`,
    });
    viewport.observe(node);
    ahead.observe(node);
    measure();
    return () => { resize.disconnect(); viewport.disconnect(); ahead.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (!width || !near || visible || warmed === url || !canPrefetch()) return;
    const controller = new AbortController();
    void prefetchImage(url, controller.signal).then((loaded) => {
      if (loaded && !controller.signal.aborted) setWarmed(url);
    });
    return () => controller.abort();
  }, [width, near, visible, url, warmed]);

  return <img ref={ref} src={width && (visible || warmed === url) ? url : undefined}
    alt={alt} className={className} loading="lazy" decoding="async" draggable={false}
    onLoad={(event) => { rememberThumbnail(photoId, url, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); setWarmed(url); }} />;
}
