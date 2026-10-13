import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Папка out/ — готовый сайт для nginx, как статические файлы в /var/www.
  output: "export",
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
