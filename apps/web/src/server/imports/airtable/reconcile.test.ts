import { describe, expect, it } from 'vitest';
import { assertIdSetEqual, sha256, sourceFingerprint, requireLiveEnvironment } from './reconcile';

describe('private Airtable reconciliation', () => {
  it('detects duplicate and missing IDs even when counts match', () => {
    expect(() => assertIdSetEqual(['a', 'b'], ['a', 'a'])).toThrow();
    expect(() => assertIdSetEqual(['a', 'b'], ['b', 'a'])).not.toThrow();
    expect(() => assertIdSetEqual(['a', 'a'], ['a'])).toThrow();
    expect(() => assertIdSetEqual([], [])).not.toThrow();
  });
  it('reports only counts, never source IDs', () => {
    expect(() => assertIdSetEqual(['secret-source'], ['private-extra', 'private-extra'])).toThrow(
      'Record reconciliation failed: missing=1, extra=1, expectedDuplicates=0, actualDuplicates=1',
    );
  });
  it('hashes exact bytes', () => {
    expect(sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
  it('detects field or ID drift but ignores order and expiring attachment URLs', () => {
    const table = {
      id: 'tbl',
      name: 'People',
      fields: [{ id: 'file', name: 'File', type: 'multipleAttachments' }],
    };
    const records = [
      {
        id: 'a',
        fields: {
          text: 'private',
          file: [{ id: 'att', filename: 'a.txt', url: 'https://example.test/old', size: 3 }],
        },
      },
      { id: 'b', fields: {} },
    ];
    const changedUrl = structuredClone(records);
    changedUrl[0]!.fields.file![0]!.url = 'https://example.test/new';
    expect(sourceFingerprint(table, records)).toBe(sourceFingerprint(table, changedUrl.reverse()));
    const changedValue = structuredClone(records);
    changedValue[0]!.fields.text = 'changed';
    expect(sourceFingerprint(table, records)).not.toBe(sourceFingerprint(table, changedValue));
    expect(sourceFingerprint(table, records)).not.toBe(sourceFingerprint(table, records.slice(1)));
  });
  it('requires credentials and explicit isolated PG opt-in without echoing environment', () => {
    expect(() => requireLiveEnvironment({})).toThrow('Live fixture credentials required');
    expect(() =>
      requireLiveEnvironment({ AIRTABLE_TEST_BASE_ID: 'sensitive', AIRTABLE_TEST_PAT: 'private' }),
    ).toThrow('Live fixture credentials required');
    const env = {
      AIRTABLE_TEST_BASE_ID: 'app12345678',
      AIRTABLE_TEST_PAT: 'private',
      P0_P2_PG_TEST: '1',
      DATABASE_URL: 'postgresql://user:secret@127.0.0.1:17460/markpocket_p0p2_test',
    };
    expect(() => requireLiveEnvironment(env)).not.toThrow();
    expect(() =>
      requireLiveEnvironment({
        ...env,
        DATABASE_URL: 'postgresql://user:secret@example.test/production',
      }),
    ).toThrow('Isolated local database required');
    expect(() => requireLiveEnvironment({ ...env, P0_P2_PG_TEST: '0' })).toThrow(
      'Isolated local database required',
    );
    expect(() => requireLiveEnvironment({ ...env, DATABASE_URL: 'not a URL secret' })).toThrow(
      'Isolated local database required',
    );
  });
});
