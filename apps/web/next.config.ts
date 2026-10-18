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
const dev = process.env.NODE_ENV !== 'production';

/** Origin of a separately hosted live-editing WebSocket (NEXT_PUBLIC_COLLAB_URL), if any. */
function collabOrigin() {
  try {
    return process.env.NEXT_PUBLIC_COLLAB_URL ? new URL(process.env.NEXT_PUBLIC_COLLAB_URL).origin : '';
  } catch {
    return '';
  }
}

/**
 * Content-Security-Policy for every page. Scripts and connections stay on this origin; the only frames are
 * the allow-listed video players; nobody may frame Trigon (clickjacking). Next.js still needs inline
 * scripts for its bootstrap data — moving to per-request nonces would let 'unsafe-inline' go.
 * 'wasm-unsafe-eval' is for pdf.js image decoders; dev adds eval and the :4001 WebSocket for hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self'${dev ? ' ws: http://localhost:4000' : ''} ${collabOrigin().replace(/^http/, 'ws')}`.trim(),
  "worker-src 'self' blob:",
  'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

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
      // Pages only: /api/* responses come from the API with their own (stricter, per-file) headers.
      { source: '/', headers: securityHeaders },
      { source: '/:path((?!api/).*)', headers: securityHeaders },
      // HSTS only when the browser reached us over HTTPS (Cloudflare / reverse proxy): never pin plain-HTTP LAN installs.
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'header', key: 'x-forwarded-proto', value: 'https' }],
        headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }],
      },
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
