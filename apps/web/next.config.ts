import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { join } from 'node:path';

// Share the monorepo-root .env with the API (Next.js only reads apps/web/.env* by itself).
try {
  process.loadEnvFile(join(__dirname, '../../.env'));
} catch {
  /* no root .env — defaults apply */
}

const apiInternal = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace workspace packages (packages/shared) into the standalone server bundle.
  outputFileTracingRoot: join(__dirname, '../../'),
  reactStrictMode: true,
  transpilePackages: ['@trigon/shared'],
  poweredByHeader: false,
  // The browser only ever talks to this origin; /api/* is proxied to the NestJS backend so
  // auth cookies stay first-party and no CORS is needed in production.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternal}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  additionalPrecacheEntries: [{ url: '/~offline', revision: process.env.GIT_SHA ?? String(Date.now()) }],
});

// The service worker is only built for production (`next build --webpack`); dev runs on Turbopack without it.
export default function config(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? nextConfig : withSerwist(nextConfig);
}
