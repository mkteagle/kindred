import { photoImageUrl } from "@/lib/image-delivery";

/** Resolve catalog photos through the bounded, authenticated transform path.
 * Legacy thumb/photo URL columns may be empty or point at an original. */
export function photoThumb(
  photo: { photo_id?: string | null; thumb_url?: string | null; photo_url?: string | null },
  size: string = "n",
): string {
  // Never trust a legacy photo_url to be a thumbnail: it may be Original.
  if (photo.photo_id) return photoImageUrl(photo.photo_id, size === "s" ? 160 : 320);
  return photo.thumb_url || "";
}

/**
 * The same, for a face: a detection's cropped `chip` is the best thing to show
 * where one exists, since it is the face rather than the whole frame.
 */
export function faceThumb(
  detection: {
    photo_id?: string | null; chip?: string | null;
    thumb_url?: string | null; photo_url?: string | null;
  },
): string {
  return detection.chip || photoThumb(detection);
}
