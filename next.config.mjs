// STATIC_EXPORT=1 builds the GitHub Pages edition: a static site that reads the scheduled
// market-data snapshot (public/data) and runs all analysis in the browser.
const isStatic = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStatic
    ? {
        output: "export",
        trailingSlash: true,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
