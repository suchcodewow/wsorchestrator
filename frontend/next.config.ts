import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run: emit a standalone server bundle for a small runtime image.
  output: "standalone",
  // Bootcamp History moved under Reporting; links to the old path still land.
  async redirects() {
    return [
      { source: "/bootcamp-history", destination: "/reporting/bootcamp-history", permanent: true },
      { source: "/bootcamp-history/:id", destination: "/reporting/bootcamp-history/:id", permanent: true },
    ];
  },
  experimental: {
    // next-auth v5 + server actions read these from the request.
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
