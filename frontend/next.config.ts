import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El paquete backend se publica como TypeScript sin compilar.
  transpilePackages: ["@lauburu/backend"],
  experimental: {
    // Documento de identidad del titular (hasta 4 MB, ver MAX_BYTES_DOCUMENTO).
    // Por debajo del límite de 6 MB por petición de las funciones de Netlify.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
