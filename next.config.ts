import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // LadybugDB is a native addon. It is only ever used by scripts, tests, and the
  // optional live side demo - never by the judged path, which runs in the
  // browser on the in-memory graph store (AGENTS.md section 9).
  serverExternalPackages: ["@ladybugdb/core", "exifr", "heic-convert"],
};

export default nextConfig;
