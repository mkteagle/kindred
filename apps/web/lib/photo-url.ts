import { BACKEND } from "@/lib/constants";

/**
 * The URL to show for a photo the API described.
 *
 * `detections.thumb_url` and `photo_url` are Flickr-era columns that the NAS
 * pipeline never fills — every detection in a NAS-backed library has them
 * empty. Rendering them directly produces a broken image, which is why the
 * gallery (which builds its own URL from the id) looked fine while the person
 * pages did not.
 *
 * So prefer whatever the API actually supplied, and fall back to deriving one
 * from the photo id, which is always present.
 */
export function photoThumb(
  photo: { photo_id?: string | null; thumb_url?: string | null; photo_url?: string | null },
  size: string = "n",
): string {
  const supplied = photo.thumb_url || photo.photo_url;
  if (supplied) return supplied;
  return photo.photo_id ? `${BACKEND}/photos/${photo.photo_id}/image?size=${size}` : "";
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
