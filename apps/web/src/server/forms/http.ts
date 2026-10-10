import { createFixedWindowRateLimiter, originAllowed, readBodyWithCap } from '@/lib/http-guards';
import { errorResponse, jsonError, readJsonObject } from '../agent-access/http';
import { resolvePublication } from './publications';
import { getPublicForm, MAX_FORM_BODY_BYTES, submitForm } from './submission';

const getLimiter = createFixedWindowRateLimiter(() => 300, 60_000);
const postLimiter = createFixedWindowRateLimiter(() => 120, 60_000);
const publicationLimiter = createFixedWindowRateLimiter(() => 30, 60_000);
function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
function rateLimited() {
  return jsonError(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded — try again in a minute');
}

export async function handlePublicFormGet(_req: Request, token: string): Promise<Response> {
  try {
    if (!getLimiter.allow('global')) return privateResponse(rateLimited());
    return privateResponse(Response.json(await getPublicForm(token)));
  } catch (err) {
    return privateResponse(errorResponse(err));
  }
}

export async function handlePublicFormPost(req: Request, token: string): Promise<Response> {
  try {
    // Unknown tokens consume the same global budget. Never key by forwarded IP.
    if (!postLimiter.allow('global')) return privateResponse(rateLimited());
    if (!originAllowed(req))
      return privateResponse(jsonError(403, 'FORBIDDEN', 'Cross-origin request rejected'));
    // Always count actual streamed bytes, including a forged small Content-Length.
    const capped = await readBodyWithCap(req, MAX_FORM_BODY_BYTES);
    if (!capped) return privateResponse(jsonError(413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large'));
    const publication = await resolvePublication(token);
    if (!publication) return privateResponse(jsonError(404, 'NOT_FOUND', 'Form is unavailable'));
    if (!publicationLimiter.allow(publication.publicationId)) return privateResponse(rateLimited());
    const input = await readJsonObject(capped);
    // The service validates the complete unknown object and rechecks the
    // capability under its write transaction (the edge check is for limiting).
    return privateResponse(
      Response.json(await submitForm(token, input as Parameters<typeof submitForm>[1])),
    );
  } catch (err) {
    return privateResponse(errorResponse(err));
  }
}
