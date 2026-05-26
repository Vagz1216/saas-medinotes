import type { NextConfig } from "next";

const localApiUrl =
  process.env.LOCAL_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8001" : undefined);

const nextConfig: NextConfig = {
  reactCompiler: true,
  reactStrictMode: true,
  async rewrites() {
    if (!localApiUrl) {
      return [];
    }

    return [
      {
        source: "/api",
        destination: `${localApiUrl}/api`,
      },
    ];
  },
};

export default nextConfig;
