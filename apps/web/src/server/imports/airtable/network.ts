import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { AirtableImportError } from './types';

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type NetworkResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer };
export type NetworkRequest = (
  url: URL,
  address: ResolvedAddress,
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<NetworkResponse>;
export type NetworkDependencies = { resolve?: Resolver; request?: NetworkRequest };

const defaultResolve: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));

async function resolveWithAbort(
  resolver: Resolver,
  hostname: string,
  signal: AbortSignal,
): Promise<ResolvedAddress[]> {
  if (signal.aborted) throw new AirtableImportError('cancelled', 'Import cancelled');
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AirtableImportError('cancelled', 'Import cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    resolver(hostname)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function ipv4Public(address: string): boolean {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p;
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || b === 168)) &&
    !(a === 198 && (b === 18 || b === 19)) &&
    !(a === 198 && b === 51 && c === 100) &&
    !(a === 203 && b === 0 && c === 113)
  );
}

function ipv6Public(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0];
  if (lower.includes('.')) {
    const embedded = lower.slice(lower.lastIndexOf(':') + 1);
    return !lower.startsWith('::ffff:') && ipv4Public(embedded) && !lower.startsWith('::');
  }
  const first = Number.parseInt(lower.replace(/^::/, '0:').split(':')[0] || '0', 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !lower.startsWith('2001:db8:') &&
    !lower.startsWith('2001:db8::')
  );
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? ipv4Public(address) : family === 6 ? ipv6Public(address) : false;
}

export async function validateAttachmentUrl(
  url: string,
  resolver: Resolver = defaultResolve,
): Promise<{ url: URL; address: ResolvedAddress }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AirtableImportError('invalid_url', 'Invalid attachment URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.username ||
    parsed.password ||
    isIP(host) !== 0 ||
    (host !== 'airtableusercontent.com' && !host.endsWith('.airtableusercontent.com'))
  ) {
    throw new AirtableImportError('invalid_url', 'Invalid attachment URL');
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new AirtableImportError('unsafe_address', 'Attachment DNS lookup failed');
  }
  if (
    !addresses.length ||
    addresses.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))
  ) {
    throw new AirtableImportError('unsafe_address', 'Attachment address is not public');
  }
  return { url: parsed, address: addresses[0] };
}

export async function collectBoundedStream(
  stream: Readable,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => stream.destroy(new AirtableImportError('cancelled', 'Import cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    for await (const chunk of stream) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) throw new AirtableImportError('limit', 'Response exceeds byte limit');
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export const nativeRequest: NetworkRequest = (url, address, headers, signal, maxBytes) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers,
        signal,
        timeout: 30_000,
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        collectBoundedStream(response, maxBytes, signal)
          .then((body) =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
          )
          .catch((error) => {
            req.destroy();
            reject(
              error instanceof AirtableImportError
                ? error
                : new AirtableImportError('upstream', 'Network response failed'),
            );
          });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () =>
      reject(
        signal.aborted
          ? new AirtableImportError('cancelled', 'Import cancelled')
          : new AirtableImportError('upstream', 'Network request failed'),
      ),
    );
    req.end();
  });

export async function secureRequest(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
  dependencies: NetworkDependencies = {},
): Promise<NetworkResponse> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  if (requestSignal.aborted) throw new AirtableImportError('cancelled', 'Import cancelled');
  const resolver = dependencies.resolve ?? defaultResolve;
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveWithAbort(resolver, url.hostname, requestSignal);
  } catch {
    if (requestSignal.aborted) throw new AirtableImportError('cancelled', 'Import cancelled');
    throw new AirtableImportError('unsafe_address', 'DNS lookup failed');
  }
  if (
    !addresses.length ||
    addresses.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))
  ) {
    throw new AirtableImportError('unsafe_address', 'Address is not public');
  }
  let response: NetworkResponse;
  try {
    response = await (dependencies.request ?? nativeRequest)(
      url,
      addresses[0],
      headers,
      requestSignal,
      maxBytes,
    );
  } catch (error) {
    if (error instanceof AirtableImportError) throw error;
    throw new AirtableImportError(
      requestSignal.aborted ? 'cancelled' : 'upstream',
      requestSignal.aborted ? 'Import cancelled' : 'Network request failed',
    );
  }
  if (response.body.length > maxBytes)
    throw new AirtableImportError('limit', 'Response exceeds byte limit');
  if (response.status >= 300 && response.status < 400)
    throw new AirtableImportError('upstream', 'Redirect rejected');
  return response;
}
