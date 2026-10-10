import {
  AirtableImportError,
  type AirtableRecord,
  type AirtableSchema,
  type AirtableSource,
} from './types';
import { parseSchema } from './mapping';
import { secureRequest, type NetworkDependencies } from './network';

import { AIRTABLE_LIMITS, AIRTABLE_IMPORT_DEADLINE_MS } from '@/lib/airtable-import-limits';

export { AIRTABLE_LIMITS } from '@/lib/airtable-import-limits';

type ClientDependencies = NetworkDependencies & {
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};
const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AirtableImportError('cancelled', 'Import cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new AirtableImportError('cancelled', 'Import cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const offsetPattern = /^[\x21-\x7e]{1,1024}$/;
function invalid(message: string): never {
  throw new AirtableImportError('invalid_data', message);
}

function parsePage(raw: unknown): { records: AirtableRecord[]; offset?: string } {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('records' in raw) ||
    !Array.isArray(raw.records) ||
    raw.records.length > 100
  )
    invalid('Invalid Airtable records page');
  const offset = 'offset' in raw ? raw.offset : undefined;
  if (offset !== undefined && (typeof offset !== 'string' || !offsetPattern.test(offset)))
    invalid('Invalid Airtable offset');
  const records = raw.records.map((record: unknown) => {
    if (
      !record ||
      typeof record !== 'object' ||
      !('id' in record) ||
      typeof record.id !== 'string' ||
      !idPattern.test(record.id) ||
      !('fields' in record) ||
      !record.fields ||
      typeof record.fields !== 'object' ||
      Array.isArray(record.fields)
    )
      invalid('Invalid Airtable record');
    const fields = record.fields as Record<string, unknown>;
    if (Object.keys(fields).some((key) => !idPattern.test(key)))
      invalid('Record fields must use IDs');
    return { id: record.id, fields };
  });
  return { records, offset: offset as string | undefined };
}

export function createAirtableSource(dependencies: ClientDependencies = {}): AirtableSource {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const started = now();
  const lifetime = AbortSignal.timeout(AIRTABLE_IMPORT_DEADLINE_MS);
  let lastApiAt = -Infinity;
  let apiGate: Promise<void> = Promise.resolve();
  let recordCount = 0;
  let cellCount = 0;
  let recordsBytes = 0;
  const recordIds = new Set<string>();
  let totalAttachmentBytes = 0;
  const attachmentUrls = new Set<string>();
  const deadlineSignal = (signal: AbortSignal) => AbortSignal.any([signal, lifetime]);
  const check = (signal: AbortSignal) => {
    if (signal.aborted || lifetime.aborted || now() - started >= AIRTABLE_IMPORT_DEADLINE_MS)
      throw new AirtableImportError('cancelled', 'Import deadline or cancellation reached');
  };

  async function waitApiTurn(signal: AbortSignal): Promise<void> {
    const previous = apiGate;
    let release!: () => void;
    apiGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      check(signal);
      const wait = Math.max(0, 250 - (now() - lastApiAt));
      if (wait) await sleep(wait, signal);
      check(signal);
      lastApiAt = now();
    } finally {
      release();
    }
  }

  async function api(
    path: string,
    token: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ data: unknown; bytes: number }> {
    if (!token || token.length > 1024)
      throw new AirtableImportError('invalid_input', 'Invalid Airtable token');
    const combined = deadlineSignal(signal);
    let rateRetries = 0;
    let serverRetries = 0;
    while (true) {
      check(combined);
      await waitApiTurn(combined);
      let response;
      try {
        response = await secureRequest(
          new URL(path, 'https://api.airtable.com'),
          { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          combined,
          maxBytes,
          dependencies,
        );
      } catch (error) {
        if (error instanceof AirtableImportError) throw error;
        throw new AirtableImportError('upstream', 'Airtable request failed');
      }
      if (response.status === 429 && rateRetries++ < 1) {
        await sleep(30_000, combined);
        continue;
      }
      if (response.status >= 500 && response.status <= 599 && serverRetries++ < 2) {
        await sleep(250 * 2 ** (serverRetries - 1), combined);
        continue;
      }
      if (response.status === 429)
        throw new AirtableImportError('rate_limited', 'Airtable rate limit exhausted');
      if (response.status !== 200)
        throw new AirtableImportError('upstream', 'Airtable request failed');
      try {
        return {
          data: JSON.parse(response.body.toString('utf8')) as unknown,
          bytes: response.body.length,
        };
      } catch {
        return invalid('Invalid Airtable JSON');
      }
    }
  }

  return {
    async schema(baseId: string, token: string, signal: AbortSignal): Promise<AirtableSchema> {
      if (!/^app[A-Za-z0-9]{8,61}$/.test(baseId))
        throw new AirtableImportError('invalid_input', 'Invalid Airtable base ID');
      const raw = await api(
        `/v0/meta/bases/${baseId}/tables`,
        token,
        signal,
        AIRTABLE_LIMITS.metadataBytes,
      );
      return parseSchema(raw.data);
    },
    async *records(
      baseId: string,
      tableId: string,
      token: string,
      signal: AbortSignal,
    ): AsyncIterable<AirtableRecord[]> {
      if (!/^app[A-Za-z0-9]{8,61}$/.test(baseId) || !/^tbl[A-Za-z0-9]{8,61}$/.test(tableId))
        throw new AirtableImportError('invalid_input', 'Invalid Airtable IDs');
      const offsets = new Set<string>();
      let offset: string | undefined;
      do {
        check(signal);
        const path = `/v0/${baseId}/${tableId}?pageSize=100&returnFieldsByFieldId=true${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
        const raw = await api(path, token, signal, AIRTABLE_LIMITS.recordsBytes - recordsBytes);
        const page = parsePage(raw.data);
        recordsBytes += raw.bytes;
        if (recordsBytes > AIRTABLE_LIMITS.recordsBytes)
          throw new AirtableImportError('limit', 'Record data limit exceeded');
        for (const record of page.records) {
          if (recordIds.has(record.id)) invalid('Duplicate Airtable record ID');
          recordIds.add(record.id);
          recordCount++;
          cellCount +=
            1 +
            Object.values(record.fields).filter(
              (value) => value !== null && value !== undefined && value !== '',
            ).length;
          if (recordCount > AIRTABLE_LIMITS.records || cellCount > AIRTABLE_LIMITS.cells)
            throw new AirtableImportError('limit', 'Airtable data limit exceeded');
        }
        if (page.offset) {
          if (offsets.has(page.offset)) invalid('Duplicate Airtable offset');
          offsets.add(page.offset);
        }
        offset = page.offset;
        yield page.records;
      } while (offset);
    },
    async attachment(url: string, signal: AbortSignal): Promise<Buffer> {
      check(signal);
      if (!attachmentUrls.has(url)) {
        if (attachmentUrls.size >= AIRTABLE_LIMITS.attachments)
          throw new AirtableImportError('limit', 'Attachment count exceeded');
        attachmentUrls.add(url);
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new AirtableImportError('invalid_url', 'Invalid attachment URL');
      }
      const host = parsed.hostname.toLowerCase();
      if (
        parsed.protocol !== 'https:' ||
        parsed.port ||
        parsed.username ||
        parsed.password ||
        (host !== 'airtableusercontent.com' && !host.endsWith('.airtableusercontent.com'))
      )
        throw new AirtableImportError('invalid_url', 'Invalid attachment URL');
      const response = await secureRequest(
        parsed,
        {},
        deadlineSignal(signal),
        AIRTABLE_LIMITS.attachmentBytes,
        dependencies,
      );
      if (response.status !== 200)
        throw new AirtableImportError('upstream', 'Attachment download failed');
      totalAttachmentBytes += response.body.length;
      if (totalAttachmentBytes > AIRTABLE_LIMITS.totalAttachmentBytes)
        throw new AirtableImportError('limit', 'Attachment total exceeded');
      return response.body;
    },
  };
}
