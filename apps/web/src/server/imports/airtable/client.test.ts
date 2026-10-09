import { describe, expect, it, vi } from 'vitest';
import { AIRTABLE_LIMITS, createAirtableSource } from './client';
import type { NetworkRequest } from './network';

const baseId = 'appSource01';
const tableId = 'tblPeople01';
const signal = new AbortController().signal;
const resolve = async () => [{ address: '8.8.8.8', family: 4 as const }];
const page = (records: unknown[], offset?: string) => ({ records, ...(offset ? { offset } : {}) });
const record = (n: number) => ({ id: `rec${n}`, fields: { fldName: `Person ${n}` } });

function sourceFor(responses: Array<{ status: number; body: unknown }>) {
  const request = vi.fn<NetworkRequest>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('No fixture response');
    return { status: next.status, headers: {}, body: Buffer.from(JSON.stringify(next.body)) };
  });
  return { source: createAirtableSource({ resolve, request, sleep: async () => {} }), request };
}

describe('bounded Airtable client', () => {
  it('reads 101 records in two pages, asks for field ID keys and never leaks token in errors', async () => {
    const { source, request } = sourceFor([
      {
        status: 200,
        body: page(
          Array.from({ length: 100 }, (_, n) => record(n)),
          'nextOffset',
        ),
      },
      { status: 200, body: page([record(100)]) },
    ]);
    const pages = [];
    for await (const batch of source.records(baseId, tableId, 'secretPAT', signal))
      pages.push(batch);
    expect(pages.map((batch) => batch.length)).toEqual([100, 1]);
    expect(request.mock.calls[0][0].hostname).toBe('api.airtable.com');
    expect(request.mock.calls[0][0].searchParams.get('returnFieldsByFieldId')).toBe('true');
    expect(request.mock.calls[0][2].Authorization).toBe('Bearer secretPAT');

    const bad = sourceFor([{ status: 401, body: { error: 'secretPAT' } }]);
    await expect(bad.source.schema(baseId, 'secretPAT', signal)).rejects.toThrow(
      'Airtable request failed',
    );
  });

  it('accepts opaque Airtable offsets and URL encodes them', async () => {
    const opaque = 'itrSJ1l4jlPyxEG6c/recxxx+more=';
    const { source, request } = sourceFor([
      { status: 200, body: page([record(1)], opaque) },
      { status: 200, body: page([record(2)]) },
    ]);
    const batches = [];
    for await (const batch of source.records(baseId, tableId, 'pat', signal)) batches.push(batch);
    expect(batches).toHaveLength(2);
    expect(request.mock.calls[1][0].searchParams.get('offset')).toBe(opaque);
  });

  it('rejects repeated offsets and record IDs', async () => {
    const repeatedOffset = sourceFor([
      { status: 200, body: page([record(1)], 'again') },
      { status: 200, body: page([record(2)], 'again') },
    ]);
    await expect(
      (async () => {
        for await (const batch of repeatedOffset.source.records(baseId, tableId, 'pat', signal)) {
          expect(Array.isArray(batch)).toBe(true);
        }
      })(),
    ).rejects.toThrow('Duplicate Airtable offset');
    const repeatedRecord = sourceFor([
      { status: 200, body: page([record(1)], 'next') },
      { status: 200, body: page([record(1)]) },
    ]);
    await expect(
      (async () => {
        for await (const batch of repeatedRecord.source.records(baseId, tableId, 'pat', signal)) {
          expect(Array.isArray(batch)).toBe(true);
        }
      })(),
    ).rejects.toThrow('Duplicate Airtable record ID');
  });

  it('rejects metadata over its limit', async () => {
    const request = vi.fn<NetworkRequest>(async () => ({
      status: 200,
      headers: {},
      body: Buffer.alloc(AIRTABLE_LIMITS.metadataBytes + 1),
    }));
    const source = createAirtableSource({ resolve, request });
    await expect(source.schema(baseId, 'pat', signal)).rejects.toThrow('byte limit');
  });

  it('does not send PAT with attachment and enforces the aggregate byte limit', async () => {
    const mebibyte = 1024 * 1024;
    const sizes = [...Array.from({ length: 6 }, () => 10 * mebibyte), 4 * mebibyte, 1];
    const request = vi.fn<NetworkRequest>(async (_url, _address, headers) => {
      expect(headers.Authorization).toBeUndefined();
      return { status: 200, headers: {}, body: Buffer.alloc(sizes.shift()!) };
    });
    const source = createAirtableSource({ resolve, request });
    for (let n = 0; n < 7; n++) {
      await source.attachment(`https://v5.airtableusercontent.com/file${n}`, signal);
    }
    await expect(
      source.attachment('https://v5.airtableusercontent.com/file7', signal),
    ).rejects.toThrow('Attachment total exceeded');
    expect(request).toHaveBeenCalledTimes(8);
  });

  it('budgets actual JSON response bytes including whitespace across pages', async () => {
    const firstJson = JSON.stringify(
      page([{ id: 'rec1', fields: { fldName: 'line\nbreak' } }], 'next'),
    );
    const firstBody = Buffer.from(
      firstJson + ' '.repeat(AIRTABLE_LIMITS.recordsBytes - firstJson.length - 1),
    );
    const bodies = [firstBody, Buffer.from(JSON.stringify(page([record(2)])))];
    const request = vi.fn<NetworkRequest>(async () => ({
      status: 200,
      headers: {},
      body: bodies.shift()!,
    }));
    const source = createAirtableSource({ resolve, request, sleep: async () => {} });
    await expect(
      (async () => {
        for await (const batch of source.records(baseId, tableId, 'pat', signal))
          expect(batch.length).toBe(1);
      })(),
    ).rejects.toThrow('byte limit');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries 429 once then fails, and stops on cancellation', async () => {
    const retry = sourceFor([
      { status: 429, body: {} },
      { status: 429, body: {} },
    ]);
    await expect(retry.source.schema(baseId, 'pat', signal)).rejects.toThrow(
      'rate limit exhausted',
    );
    expect(retry.request).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    controller.abort();
    const source = sourceFor([]);
    await expect(source.source.schema(baseId, 'pat', controller.signal)).rejects.toThrow('cancel');
    expect(source.request).not.toHaveBeenCalled();
  });

  it('accepts the exact record cap and rejects one extra across pages', async () => {
    const fullPages = Array.from({ length: 100 }, (_, pageNo) => ({
      status: 200,
      body: page(
        Array.from({ length: 100 }, (_, row) => ({ id: `rec${pageNo * 100 + row}`, fields: {} })),
        pageNo < 99 ? `offset${pageNo}` : undefined,
      ),
    }));
    const exact = sourceFor([...fullPages]);
    let count = 0;
    for await (const batch of exact.source.records(baseId, tableId, 'pat', signal))
      count += batch.length;
    expect(count).toBe(AIRTABLE_LIMITS.records);

    const over = sourceFor([
      ...fullPages.slice(0, -1),
      {
        status: 200,
        body: page(
          Array.from({ length: 100 }, (_, row) => ({ id: `rec${9900 + row}`, fields: {} })),
          'last',
        ),
      },
      { status: 200, body: page([{ id: 'rec10000', fields: {} }]) },
    ]);
    await expect(
      (async () => {
        for await (const batch of over.source.records(baseId, tableId, 'pat', signal)) {
          expect(Array.isArray(batch)).toBe(true);
        }
      })(),
    ).rejects.toThrow('data limit');
  });

  it('counts source ID cells and nonempty values across pages', async () => {
    const fields = Object.fromEntries(Array.from({ length: 99 }, (_, n) => [`fld${n}`, n]));
    const pages = Array.from({ length: 10 }, (_, pageNo) => ({
      status: 200,
      body: page(
        Array.from({ length: 100 }, (_, row) => ({ id: `rec${pageNo * 100 + row}`, fields })),
        pageNo < 9 ? `offset${pageNo}` : undefined,
      ),
    }));
    const exact = sourceFor([...pages]);
    let count = 0;
    for await (const batch of exact.source.records(baseId, tableId, 'pat', signal))
      count += batch.length;
    expect(count).toBe(1000);
    const over = sourceFor([
      ...pages.slice(0, -1),
      {
        status: 200,
        body: page(
          Array.from({ length: 100 }, (_, row) => ({ id: `rec${900 + row}`, fields })),
          'last',
        ),
      },
      { status: 200, body: page([{ id: 'rec1000', fields: {} }]) },
    ]);
    await expect(
      (async () => {
        for await (const batch of over.source.records(baseId, tableId, 'pat', signal))
          expect(Array.isArray(batch)).toBe(true);
      })(),
    ).rejects.toThrow('data limit');
  });

  it('retries 5xx twice then gives a safe error and enforces the lifetime deadline', async () => {
    const failed = sourceFor([
      { status: 503, body: { token: 'secretPAT' } },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    await expect(failed.source.schema(baseId, 'secretPAT', signal)).rejects.toThrow(
      'Airtable request failed',
    );
    expect(failed.request).toHaveBeenCalledTimes(3);
    let time = 0;
    const request = vi.fn<NetworkRequest>(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"tables":[]}'),
    }));
    const expired = createAirtableSource({ resolve, request, now: () => time });
    time = 120_000;
    await expect(expired.schema(baseId, 'pat', signal)).rejects.toThrow('deadline');
    expect(request).not.toHaveBeenCalled();
  });
});
