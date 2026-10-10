import { createHash } from 'node:crypto';
import type { AirtableRecord, AirtableTable } from './types';

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Error text deliberately contains counts only, never source identifiers. */
export function assertIdSetEqual(expected: string[], actual: string[]): void {
  const e = new Set(expected),
    a = new Set(actual);
  const missing = [...e].filter((id) => !a.has(id)).length;
  const extra = [...a].filter((id) => !e.has(id)).length;
  const expectedDuplicates = expected.length - e.size;
  const actualDuplicates = actual.length - a.size;
  if (missing || extra || expectedDuplicates || actualDuplicates)
    throw new Error(
      `Record reconciliation failed: missing=${missing}, extra=${extra}, expectedDuplicates=${expectedDuplicates}, actualDuplicates=${actualDuplicates}`,
    );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Airtable regenerates signed URLs/thumbnails; retain stable attachment identity/metadata. */
export function sourceFingerprint(table: AirtableTable, records: AirtableRecord[]): string {
  const attachments = new Set(
    table.fields.filter((field) => field.type === 'multipleAttachments').map((field) => field.id),
  );
  const normalized = records
    .map((record) => ({
      id: record.id,
      fields: Object.fromEntries(
        Object.entries(record.fields).map(([id, value]) => [
          id,
          attachments.has(id) && Array.isArray(value)
            ? value.map((item: Record<string, unknown>) => ({
                id: item.id,
                filename: item.filename,
                size: item.size,
                type: item.type,
              }))
            : value,
        ]),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256(Buffer.from(JSON.stringify(canonical(normalized))));
}

/** Validate before importing the DB module or making network requests. Never echo inputs. */
export function requireLiveEnvironment(env: Record<string, string | undefined>): {
  baseId: string;
  token: string;
} {
  const baseId = env.AIRTABLE_TEST_BASE_ID,
    token = env.AIRTABLE_TEST_PAT;
  if (!baseId || !/^app[A-Za-z0-9]{8,61}$/.test(baseId) || !token || token.length > 1024)
    throw new Error('Live fixture credentials required');
  let isolated = false;
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    isolated =
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      /^\/markpocket_p0p2_[A-Za-z0-9_]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash;
  } catch {
    /* invalid URL remains a sanitized guard failure */
  }
  if (env.P0_P2_PG_TEST !== '1' || !isolated) throw new Error('Isolated local database required');
  return { baseId, token };
}
