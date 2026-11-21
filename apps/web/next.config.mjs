/** @type {import('next').NextConfig} */
const config = {
  cacheComponents: true,
  output: process.env.NITRO_PRESET === "vercel" ? undefined : "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "live.staticflickr.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
};

export default config;
