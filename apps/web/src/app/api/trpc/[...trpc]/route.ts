import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter } from '@/server/trpc/router';
import { createContext } from '@/server/trpc/init';
import {
  contentLengthExceeds,
  MAX_TRPC_BODY_BYTES,
  originAllowed,
  readBodyWithCap,
} from '@/lib/http-guards';

async function handler(req: Request) {
  // Defense-in-depth against cross-site requests: browsers always send Origin
  // on cross-site POSTs, and it must point back at the host serving this
  // route — the session cookie would ride along otherwise. Missing Origin
  // (curl, tests, same-process RSC calls) is allowed. Canonical copy:
  // http-guards.originAllowed (ADR-0010).
  if (!originAllowed(req)) {
    return new Response('Forbidden: cross-origin request', { status: 403 });
  }
  // Gate before the adapter parses the body: public procedures
  // (invite.resolve, publicShare.*) JSON.parse the raw payload before any
  // auth or zod limit applies, so an unauthenticated caller could otherwise
  // burn CPU/memory on a multi-megabyte blob. Limit rationale (kept above
  // plugin-csv's 5MB csvText cap): see MAX_TRPC_BODY_BYTES.
  if (contentLengthExceeds(req, MAX_TRPC_BODY_BYTES)) {
    return new Response('Payload Too Large', { status: 413 });
  }
  // No Content-Length (chunked transfer): the header fast path above is
  // blind, and the default deployment exposes this port directly — so count
  // the streamed bytes before fetchRequestHandler buffers them (see
  // readBodyWithCap). GET carries its input in the query string and has no
  // body, so body-carrying requests are the only ones that pay this.
  if (req.headers.get('content-length') === null && req.body !== null) {
    const capped = await readBodyWithCap(req, MAX_TRPC_BODY_BYTES);
    if (capped === null) {
      return new Response('Payload Too Large', { status: 413 });
    }
    req = capped;
  }
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });
}

export { handler as GET, handler as POST };
