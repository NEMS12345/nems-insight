import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // C&I interval files (NEM12, and especially multi-meter xlsx exports) routinely exceed
    // the default 1 MB Server Action limit — allow larger uploads.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
