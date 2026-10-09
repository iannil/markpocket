const withRspack = require('next-rspack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HSTS, conservative: 180 days, no includeSubDomains/preload yet —
          // the deployment may share the domain with non-TLS internal tooling.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=15552000',
          },
          // 'unsafe-inline' styles are required by Next's runtime style injection;
          // everything else is locked down. ws: allows the realtime gateway.
          // (A nonce-based CSP would need middleware-managed headers for every
          // injected script; deferred as too invasive for now.)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Rspack's development refresh runtime uses eval. Never allow
              // this in production (or when NODE_ENV is unset).
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data:",
              "connect-src 'self' ws: wss:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = withRspack(nextConfig);
