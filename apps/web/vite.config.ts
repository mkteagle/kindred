import { redact } from "@tanstack/redact/vinext";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import vinext from "vinext";
import * as sourceConfig from "./source.config.ts";

export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    await mdx(sourceConfig),
    vinext(),
    redact(),
    ...(process.env.NITRO_PRESET === "vercel"
      // Preserve status codes when Vinext passes a Response as ResponseInit.
      ? [nitro({ features: { fastResponse: false } })]
      : []),
  ],
  resolve: { tsconfigPaths: true },
}));
