import { encode } from "modern-gif";
import type { GifFrames } from "./video-gif";

self.onmessage = async ({ data }: MessageEvent<GifFrames>) => {
  try {
    const blob = await encode({
      ...data,
      format: "blob",
      version: "89a",
      looped: true,
      loopCount: 0,
      maxColors: 255,
      dither: "floyd-steinberg",
    });
    self.postMessage(blob);
  } catch {
    self.postMessage(null);
  }
};
