import type { MetadataRoute } from 'next';

// Tokenized URLs (/share, /invite) and the RSS surface (/feed) carry their
// credential in the path — defense in depth against indexing on top of the
// per-page robots metadata and x-robots-tag on feed responses. API routes
// are machine surfaces, not content.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/share/', '/invite/', '/feed/', '/api/'],
      },
    ],
  };
}
