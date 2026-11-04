import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  output: 'export',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: {
    unoptimized: true
  },
  trailingSlash: true,
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react']
  }
};

export default nextConfig;
