import { BACKEND } from "./constants";

// Keep the in-browser archive and the current response within a predictable
// memory budget. Large videos can be downloaded individually.
const MAX_BYTES = 256 * 1024 * 1024;

function originalName(header: string | null, fallback: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "")?.[1];
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header ?? "");
  let name = plain?.[1] || plain?.[2]?.trim() || fallback;
  if (encoded) {
    try { name = decodeURIComponent(encoded); } catch { /* Malformed filename header. */ }
  }
  const safe = name.replace(/[/\\:\u0000-\u001f]/g, "_").trim();
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

export async function downloadSelection(ids: string[], signal: AbortSignal) {
  const { Zip, ZipPassThrough } = await import("fflate");
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  const names = new Set<string>();
  let archiveError: Error | null = null;
  const archive = new Zip((error, chunk) => {
    if (error) archiveError = error;
    else parts.push(Uint8Array.from(chunk));
  });
  try {
    for (const id of ids) {
      const response = await fetch(`${BACKEND}/photos/${encodeURIComponent(id)}/local?variant=original`, { signal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("An original could not be read from the NAS. Check the connection and try again.");
      }
      const name = originalName(response.headers.get("content-disposition"), `kindred-${id}`);
      let filename = name;
      for (let suffix = 2; names.has(filename); suffix += 1) {
        const dot = name.lastIndexOf(".");
        filename = dot > 0 ? `${name.slice(0, dot)} (${suffix})${name.slice(dot)}` : `${name} (${suffix})`;
      }
      names.add(filename);
      const file = new ZipPassThrough(filename);
      archive.add(file);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error("This selection exceeds 256 MB. Select fewer items or download large videos individually.");
          file.push(value);
        }
        file.push(new Uint8Array(0), true);
      } finally {
        await reader.cancel();
      }
    }
    archive.end();
    if (archiveError) throw archiveError;
  } catch (error) {
    archive.terminate();
    throw error;
  }

  const url = URL.createObjectURL(new Blob(parts, { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "Kindred selection.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
