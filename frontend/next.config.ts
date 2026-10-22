import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El paquete backend se publica como TypeScript sin compilar.
  transpilePackages: ["@lauburu/backend"],
};

export default nextConfig;
