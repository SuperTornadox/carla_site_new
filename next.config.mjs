/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,

  // Enable image optimization for external images
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "carlagannis.com",
      },
    ],
    // Optimize image formats
    formats: ["image/avif", "image/webp"],
    // Cache optimized images for 1 year
    minimumCacheTTL: 31536000,
  },

  // Enable compression
  compress: true,

  // Optimize production builds
  productionBrowserSourceMaps: false,

  // Headers for caching static assets
  async headers() {
    return [
      {
        source: "/:all*(svg|jpg|jpeg|png|gif|ico|webp|avif|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/blog/wp-content/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

