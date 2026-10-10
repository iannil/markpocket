import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { isPublicAddress, type Resolver } from '../imports/airtable/network';

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

export function parseWebhookUrl(value: string): URL {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (
      value.length > 2048 ||
      url.protocol !== 'https:' ||
      url.port !== '' ||
      url.username ||
      url.password ||
      value.includes('#') ||
      (isIP(hostname) && !isPublicAddress(hostname))
    )
      throw new Error();
    return url;
  } catch {
    throw new Error('Invalid webhook URL');
  }
}

const defaultResolve: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));

/** Dependencies are server-side test seams, never supplied by an API caller. */
export function createWebhookTransport(
  dependencies: { resolve?: Resolver; request?: typeof httpsRequest } = {},
) {
  return async function postWebhook(
    url: string,
    body: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ status: number }> {
    const target = parseWebhookUrl(url);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    timer.unref();
    const requestSignal = AbortSignal.any([signal, timeout.signal]);
    const cancelled = () => new Error('Webhook request cancelled');
    let removeDnsAbort = () => {};
    try {
      if (requestSignal.aborted) throw cancelled();
      const addresses = await new Promise<Awaited<ReturnType<Resolver>>>((resolve, reject) => {
        const abort = () => reject(cancelled());
        requestSignal.addEventListener('abort', abort, { once: true });
        removeDnsAbort = () => requestSignal.removeEventListener('abort', abort);
        (dependencies.resolve ?? defaultResolve)(host).then(resolve, () =>
          reject(new Error('Webhook DNS lookup failed')),
        );
      });
      removeDnsAbort();
      if (requestSignal.aborted) throw cancelled();
      if (
        !addresses.length ||
        addresses.some(
          ({ address, family }) => isIP(address) !== family || !isPublicAddress(address),
        )
      )
        throw new Error('Webhook address is not public');
      const pinned = addresses[0];
      // Do not allow caller headers to alter the destination or framing.
      const safeHeaders = Object.fromEntries(
        Object.entries(headers).filter(
          ([key]) =>
            !['host', 'content-length', 'transfer-encoding', 'connection'].includes(
              key.toLowerCase(),
            ),
        ),
      );
      return await new Promise<{ status: number }>((resolve, reject) => {
        let response: IncomingMessage | undefined;
        let settled = false;
        const finish = (error?: Error, status?: number) => {
          if (settled) return;
          settled = true;
          requestSignal.removeEventListener('abort', abort);
          if (error) {
            response?.destroy();
            req.destroy();
            reject(error);
          } else resolve({ status: status ?? 0 });
        };
        const abort = () => finish(cancelled());
        const req = (dependencies.request ?? httpsRequest)(
          target,
          {
            method: 'POST',
            agent: false,
            headers: {
              ...safeHeaders,
              Host: target.host,
              'Content-Length': String(Buffer.byteLength(body)),
            },
            signal: requestSignal,
            servername: isIP(host) ? undefined : host,
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
          (incoming) => {
            response = incoming;
            let bytes = 0;
            incoming.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > MAX_RESPONSE_BYTES)
                finish(new Error('Webhook response exceeds byte limit'));
            });
            incoming.on('end', () => finish(undefined, incoming.statusCode));
            incoming.on('error', () => finish(new Error('Webhook response failed')));
            incoming.on('aborted', () => finish(new Error('Webhook response failed')));
          },
        );
        req.on('error', () =>
          finish(requestSignal.aborted ? cancelled() : new Error('Webhook request failed')),
        );
        requestSignal.addEventListener('abort', abort, { once: true });
        if (requestSignal.aborted) abort();
        else req.end(body);
      }).catch((error: unknown) => {
        // Only our fixed errors may leave the transport (native errors may contain URLs).
        if (
          error instanceof Error &&
          [
            'Webhook request cancelled',
            'Webhook response exceeds byte limit',
            'Webhook response failed',
            'Webhook request failed',
          ].includes(error.message)
        )
          throw error;
        throw new Error('Webhook request failed');
      });
    } finally {
      removeDnsAbort();
      clearTimeout(timer);
    }
  };
}

export const postWebhook = createWebhookTransport();
