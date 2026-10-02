import { TRPCError } from '@trpc/server';
import type { z } from 'zod';

import { readJsonObject } from './http';

/**
 * Parse a JSON request body against a zod schema, mapping failures to the
 * agent error envelope (BAD_REQUEST). Zod issue messages are safe to surface:
 * they describe the expected shape, never stored data.
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  const raw = await readJsonObject(req);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? ` at ${first.path.join('.')}` : '';
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid request body${path}: ${first?.message ?? 'validation failed'}`,
    });
  }
  return result.data;
}

/** Same as parseBody, but against URL search params (GET collections). */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const url = new URL(req.url);
  const raw: Record<string, unknown> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? ` at ${first.path.join('.')}` : '';
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid query parameter${path}: ${first?.message ?? 'validation failed'}`,
    });
  }
  return result.data;
}
