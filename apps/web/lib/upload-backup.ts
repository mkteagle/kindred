import { BACKEND } from "./constants";

// Each body stays below Vercel's default 4.5 MB request limit.
const CHUNK_BYTES = 4 * 1024 * 1024;

type Receipt = {
  photo_id?: string | null;
  kindred_photo_id?: string | null;
  nas_status?: string;
  flickr_status?: string;
};

type Session = { upload_id: string; status: string; next_offset: number; receipt?: Receipt };

async function session(path: string, init: RequestInit): Promise<Session> {
  const response = await fetch(`${BACKEND}/uploads/resumable${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || `Upload failed (${response.status})`);
  if (!body || typeof body.upload_id !== "string" || !Number.isSafeInteger(body.next_offset)) {
    throw new Error("Kindred returned an unreadable upload position.");
  }
  return body;
}

export async function uploadBackup(
  file: File, id: string, title: string, album: string,
  reportProgress: (percent: number) => void, signal: AbortSignal,
) {
  const json = { "Content-Type": "application/json" };
  const start = () => session("", {
    method: "POST", headers: json, signal,
    body: JSON.stringify({ client_upload_id: id, filename: file.name, content_type: file.type || "application/octet-stream",
      byte_size: file.size, title, album_id: album || null }),
  });
  let state = await start();
  if (state.next_offset < 0 || state.next_offset > file.size) {
    throw new Error("Kindred returned an invalid upload position.");
  }
  while (!state.receipt && state.next_offset < file.size) {
    const end = Math.min(state.next_offset + CHUNK_BYTES, file.size);
    const path = `/${encodeURIComponent(state.upload_id)}?offset=${state.next_offset}`;
    state = await session(path, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(state.next_offset, end), signal,
    });
    if (state.next_offset !== end) throw new Error("Kindred did not confirm the uploaded bytes. Retry to resume.");
    reportProgress(Math.round(95 * end / file.size));
  }

  for (let checks = 0; !state.receipt && checks < 120; checks += 1) {
    if (state.status === "ready") {
      state = await session(`/${encodeURIComponent(state.upload_id)}/complete`, { method: "POST", headers: json, signal });
    }
    if (!state.receipt) {
      await new Promise<void>(resolve => setTimeout(resolve, 5_000));
      signal.throwIfAborted();
      state = await start();
    }
  }

  const receipt = state.receipt;
  if (receipt?.nas_status !== "available" || !receipt.kindred_photo_id) {
    throw new Error("Kindred has not confirmed the NAS copy. Retry to check or resume.");
  }
  return { kindredPhotoId: receipt.kindred_photo_id,
    flickrPhotoId: receipt.flickr_status === "available" ? receipt.photo_id || undefined : undefined };
}
