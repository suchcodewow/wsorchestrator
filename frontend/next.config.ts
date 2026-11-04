import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run: emit a standalone server bundle for a small runtime image.
  output: "standalone",
  experimental: {
    // next-auth v5 + server actions read these from the request.
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
