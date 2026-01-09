/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    // Reduce client bundle size by optimizing common dependency imports.
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
};

module.exports = nextConfig;
