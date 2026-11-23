export const MAX_GIF_DURATION = 8;
const FRAME_INTERVAL = 0.1;
const MAX_DIMENSION = 480;

export function gifClip(duration: number, start: number, length: number) {
  const maxLength = Math.min(MAX_GIF_DURATION, duration);
  const clampedStart = Math.min(Math.max(0, duration - Math.min(0.1, duration)), Math.max(0, start));
  return {
    start: clampedStart,
    length: Math.min(maxLength, duration - clampedStart, Math.max(0.1, length)),
  };
}

export function seekVideo(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.001) {
    return Promise.resolve();
  }
  if (video.error) return Promise.reject(new Error("This video could not be loaded."));

  return new Promise((resolve, reject) => {
    const wait = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const cleanup = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("error", failed);
      wait.removeEventListener("abort", aborted);
    };
    function done() {
      cleanup();
      resolve();
    }
    function loaded() {
      if (!video.seeking && Math.abs(video.currentTime - time) < 0.001) done();
    }
    function failed() {
      cleanup();
      reject(new Error("This part of the video could not be loaded."));
    }
    function aborted() {
      cleanup();
      reject(signal.aborted ? signal.reason : new Error("The video took too long to seek. Try a shorter clip."));
    }
    video.addEventListener("seeked", done);
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("error", failed);
    wait.addEventListener("abort", aborted, { once: true });
    try {
      video.currentTime = time;
    } catch {
      failed();
    }
  });
}

export type GifFrame = { data: ArrayBuffer; delay: number };
export type GifFrames = { width: number; height: number; frames: GifFrame[] };
export type GifProgress = { captured: number; total: number };

export async function captureGifFrames(
  video: HTMLVideoElement,
  start: number,
  length: number,
  signal: AbortSignal,
  progress: (progress: GifProgress) => void,
): Promise<GifFrames> {
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
    throw new Error("Wait for the video to load before creating a GIF.");
  }
  const clip = gifClip(video.duration, start, length);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("This browser can’t capture video frames.");

  const count = Math.max(1, Math.round(clip.length / FRAME_INTERVAL));
  const duration = Math.max(20, Math.round(clip.length * 100) * 10);
  const frames: GifFrame[] = [];
  video.pause();
  progress({ captured: 0, total: count });
  for (let index = 0; index < count; index++) {
    await seekVideo(video, clip.start + index * clip.length / count, signal);
    signal.throwIfAborted();
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const elapsed = Math.round((duration / 10) * index / count);
    const next = Math.round((duration / 10) * (index + 1) / count);
    frames.push({ data: pixels.data.buffer as ArrayBuffer, delay: 10 * (next - elapsed) });
    progress({ captured: index + 1, total: count });
  }

  return { width: canvas.width, height: canvas.height, frames };
}

export async function encodeGif(frames: GifFrames, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./video-gif.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const wait = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
      worker.onmessage = ({ data }) => {
        wait.removeEventListener("abort", abort);
        if (data instanceof Blob && data.size) resolve(data);
        else reject(new Error("The GIF could not be encoded. Try a shorter clip."));
      };
      worker.onerror = () => {
        wait.removeEventListener("abort", abort);
        reject(new Error("The GIF encoder couldn’t start."));
      };
      function abort() {
        reject(signal.aborted ? signal.reason : new Error("The GIF took too long to encode. Try a shorter clip."));
      }
      wait.addEventListener("abort", abort, { once: true });
      worker.postMessage(frames, frames.frames.map(({ data }) => data));
    });
  } finally {
    worker.terminate();
  }
}
