import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run: emit a standalone server bundle for a small runtime image.
  output: "standalone",
  // Bootcamp History moved under Reporting, then became its Bootcamp tab; links to the old paths still land.
  async redirects() {
    return [
      { source: "/bootcamp-history", destination: "/reporting/bootcamp", permanent: true },
      { source: "/bootcamp-history/:id", destination: "/reporting/bootcamp/:id", permanent: true },
      { source: "/reporting/bootcamp-history", destination: "/reporting/bootcamp", permanent: true },
      { source: "/reporting/bootcamp-history/:id", destination: "/reporting/bootcamp/:id", permanent: true },
      // The history tab became the dots beside each rep on the Canary Wire.
      { source: "/reporting/canary-wire-history", destination: "/reporting/canary-wire", permanent: true },
      // Iris was renamed Diagnostic.
      { source: "/iris", destination: "/diagnostic", permanent: true },
      { source: "/iris/:path*", destination: "/diagnostic/:path*", permanent: true },
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
