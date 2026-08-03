import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A stray lockfile in the home directory otherwise makes Next guess the
  // wrong workspace root for file tracing.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
