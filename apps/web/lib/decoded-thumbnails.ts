const MAX_BYTES = 64 * 1024 * 1024;
const MAX_EDGE = 512;
const decoded = new Map<string, ImageBitmap>();
const pending = new Set<string>();
let bytes = 0;

const byteSize = (bitmap: ImageBitmap) => bitmap.width * bitmap.height * 4;

export function decodedThumbnail(id: string) {
  return decoded.get(id);
}

export function touchDecodedThumbnail(id: string, bitmap: ImageBitmap) {
  if (decoded.get(id) !== bitmap) return;
  decoded.delete(id);
  decoded.set(id, bitmap);
}

/** Retain pixels in memory after the browser loads a gallery thumbnail. */
export async function retainDecodedThumbnail(id: string, image: HTMLImageElement) {
  const previous = decoded.get(id);
  if (previous) {
    touchDecodedThumbnail(id, previous);
    return;
  }
  if (pending.has(id) || !image.naturalWidth || !image.naturalHeight || typeof createImageBitmap !== "function") return;

  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  pending.add(id);
  try {
    const bitmap = await createImageBitmap(image, {
      resizeWidth: Math.max(1, Math.round(image.naturalWidth * scale)),
      resizeHeight: Math.max(1, Math.round(image.naturalHeight * scale)),
    });
    decoded.set(id, bitmap);
    bytes += byteSize(bitmap);
    while (bytes > MAX_BYTES) {
      const [oldId, oldBitmap] = decoded.entries().next().value!;
      decoded.delete(oldId);
      bytes -= byteSize(oldBitmap);
      oldBitmap.close();
    }
  } catch {
    // The normal image path remains available when the browser cannot make a bitmap.
  } finally {
    pending.delete(id);
  }
}
