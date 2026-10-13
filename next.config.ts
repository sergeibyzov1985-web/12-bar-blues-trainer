import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Папка out/ — готовый сайт для nginx, как статические файлы в /var/www.
  output: "export",
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
